import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@b2b/contracts';
import { Setting } from '../../../kernel/settings/setting.entity.js';

/**
 * Operator activation — the second presence axis (feature 073, Constitution
 * XVII, research R-5).
 *
 * Platform availability answers "is this module installed and wired in this
 * deployment?" and lives in `module_registrations`. This file answers "does
 * this client want this capability?", which lives in an ordinary `Setting`
 * row the module declares in its manifest.
 *
 * Two properties of this read are load-bearing:
 *
 *  - **It does not go through `SettingsService`.** Every read path there is
 *    `async` behind a two-layer cache, while the hot-path gate must stay a
 *    synchronous in-memory lookup (FR-004). Reading the rows keeps the
 *    dependency on the settings *schema* — an edge the orchestrator already
 *    has — rather than on the settings *service graph*, which is the edge
 *    that would create a bootstrap cycle (FR-070).
 *  - **It stops at two tiers.** Settings normally resolve per-channel
 *    (`setting_values`) → `global_value` → `default_value`. Activation is
 *    platform-wide (FR-009), so the per-channel tier is never joined;
 *    including it would reintroduce channel dependence through the back door
 *    (Constitution XII).
 */

/**
 * A module's activation declaration, distilled from its manifest. Keeping it
 * as plain data rather than passing manifests around means the registry cache
 * — which lives on the hot path — never imports the manifest graph.
 */
export interface ModuleActivationDeclaration {
  readonly moduleId: string;
  /** `null` for a module that declared itself non-deactivatable. */
  readonly settingCode: string | null;
  /** Applies when the Setting row does not exist yet, or carries no override. */
  readonly default: boolean;
  /** Operator-facing reason; non-null exactly when `settingCode` is null. */
  readonly nonDeactivatableReason: string | null;
}

/**
 * Distil the activation declarations from a manifest list. A module that
 * declares nothing is omitted: it owns no operator control, so only the
 * platform axis governs it until its batch converts it.
 */
export function activationDeclarationsFrom(
  manifests: readonly ModuleManifest[],
): ModuleActivationDeclaration[] {
  const declarations: ModuleActivationDeclaration[] = [];
  for (const manifest of manifests) {
    const activation = manifest.activation;
    if (!activation) continue;
    if ('nonDeactivatable' in activation) {
      declarations.push({
        moduleId: manifest.id,
        settingCode: null,
        default: true,
        nonDeactivatableReason: activation.reason,
      });
      continue;
    }
    declarations.push({
      moduleId: manifest.id,
      settingCode: activation.settingCode,
      default: activation.default,
      nonDeactivatableReason: null,
    });
  }
  return declarations;
}

/**
 * Resolve each declared module's activation.
 *
 * One query, keyed by an explicit code list built from the declarations —
 * never a `LIKE` scan, because `Setting.code`'s only index is its unique
 * constraint and the adopted codes make the suffix non-uniform anyway.
 *
 * Fail-closed reading (FR-005): a value that is not a JSON boolean resolves
 * to **off**, because `global_value` is jsonb and its `null` is ambiguous
 * between "no override" and a literal JSON null. A missing row resolves to
 * the manifest-declared default — an explicit state, not a fall-open.
 *
 * A non-deactivatable module resolves to `true` without being queried at all,
 * which is what removes the recursion that would otherwise arise from gating
 * `settings` on a value stored in `settings` (FR-071).
 */
export async function resolveActivation(
  em: EntityManager,
  declarations: readonly ModuleActivationDeclaration[],
): Promise<Map<string, boolean>> {
  const resolved = new Map<string, boolean>();
  const byCode = new Map<string, ModuleActivationDeclaration>();

  for (const declaration of declarations) {
    if (declaration.settingCode === null) {
      resolved.set(declaration.moduleId, true);
      continue;
    }
    byCode.set(declaration.settingCode, declaration);
    resolved.set(declaration.moduleId, declaration.default);
  }

  if (byCode.size === 0) return resolved;

  const rows = await em.find(Setting, { code: { $in: [...byCode.keys()] } });
  for (const row of rows) {
    const declaration = byCode.get(row.code);
    if (!declaration) continue;
    const value = row.globalValue ?? row.defaultValue;
    resolved.set(declaration.moduleId, typeof value === 'boolean' ? value : false);
  }
  return resolved;
}

/**
 * `ModuleScaffoldSpec` — the author's answers, normalised once, before anything
 * is written (`specs/089-endora-cli-module-scaffold/data-model.md` §1).
 *
 * Every emitted file is a function of this one record, which is what stops two
 * emitted files disagreeing about what the module is: the permission code in
 * `routes.admin.ts`, in `src/manifest.ts` and in both i18n bundles is one value
 * read three times rather than three values written three times. That
 * disagreement is the failure mode a hand-written module has, and it is silent —
 * `check:action-route-permissions` exists because two shipped modules declared a
 * real permission code against a route that enforced a different real one.
 *
 * **It deliberately carries nothing that appears in `package.json`.** The layer
 * decisions are expressed as *directories that exist*, and the platform's
 * manifest generator reads the directories; a field here for `exports` or
 * `peerDependencies` would be the second author `module-scaffold-output.md` §2
 * exists to prevent.
 */
import {
  KnownIconNameSchema,
  PERMISSION_CATALOGUE,
  defineModuleManifest,
  moduleIdRe,
  settingCodeRe,
  type KnownIconName,
} from '@endora-commerce/contracts';

/** A refusal the author can act on: exit 1, and nothing is written. */
export class ScaffoldInputError extends Error {
  override readonly name = 'ScaffoldInputError';
}

/** An input the command could not read: exit 2. */
export class ScaffoldHostError extends Error {
  override readonly name = 'ScaffoldHostError';
}

export interface ScaffoldPermission {
  readonly code: string;
  readonly label: string;
}

export interface ScaffoldAction {
  readonly id: string;
  /** The admin SPA route the palette entry opens. */
  readonly route: string;
}

export type ScaffoldActivation =
  | { readonly kind: 'setting'; readonly settingCode: string }
  | { readonly kind: 'non-deactivatable'; readonly reason: string };

/** Which tenant-scope decorator the emitted entity carries (Principle XI). */
export type TenantScope = 'org-scoped' | 'customer-scoped' | 'global';

export const TENANT_SCOPES: readonly TenantScope[] = ['org-scoped', 'customer-scoped', 'global'];

/** The decorator each scope spells, as `@endora-commerce/platform/tenancy` exports it. */
export const TENANT_SCOPE_DECORATORS: Readonly<Record<TenantScope, string>> = {
  'org-scoped': 'OrgScoped',
  'customer-scoped': 'CustomerScoped',
  global: 'GlobalEntity',
};

export interface ScaffoldLayers {
  readonly entities: boolean;
  readonly ports: boolean;
  readonly worker: boolean;
  readonly subscriber: boolean;
}

export interface ModuleScaffoldSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly permissions: readonly ScaffoldPermission[];
  readonly actions: readonly ScaffoldAction[];
  readonly icon: KnownIconName;
  readonly layers: ScaffoldLayers;
  readonly tenantScope: TenantScope;
  readonly activation: ScaffoldActivation;
  /**
   * `YYYYMMDDTHHmmss`, UTC — computed once for the whole run, so the migration
   * file name, its class name and `src/migrations/index.ts` cannot disagree.
   */
  readonly migrationStamp: string;
}

/**
 * The frozen historical prefix's watermark
 * (`backend/src/db/migration-order.ts`'s `BASELINE_THROUGH`).
 *
 * A migration stamped at or below it is ordered by history rather than by its
 * module's manifest `dependencies`, so `migration:new` clamps above it and so
 * does this. The constant is this package's copy of a fact that repository owns,
 * and it is a copy because the owner is an application this package may not
 * import — `backend/test/unit/packages/cli-migration-identity.test.ts` holds the
 * two to each other in both directions, so the copy cannot go stale in silence.
 */
export const BASELINE_THROUGH = '20260801T000000';

/** `YYYYMMDDTHHmmss`, UTC, fixed width, literal `T` at index 8. */
export function formatStamp(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** The stamp a migration scaffolded now takes: never at or below the watermark. */
export function migrationStampFor(now: Date): string {
  const stamp = formatStamp(now);
  return stamp > BASELINE_THROUGH ? stamp : `${BASELINE_THROUGH.slice(0, 8)}T000001`;
}

/** `_lifecycle` → `lifecycle`; the segment every derived name is built from. */
export function segmentOf(moduleId: string): string {
  return moduleId.replace(/^_+/, '');
}

/** `quote_requests` → `quote-requests`. */
export function slugOf(moduleId: string): string {
  return segmentOf(moduleId).replace(/_/g, '-');
}

/** `quote_requests` → `QuoteRequests`. */
export function pascalOf(moduleId: string): string {
  return segmentOf(moduleId)
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** `quote_requests` → `quoteRequests`. */
export function camelOf(moduleId: string): string {
  const pascal = pascalOf(moduleId);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `open-widgets` → `openWidgets`, the module-relative i18n key segment. */
export function camelOfActionId(actionId: string): string {
  return actionId
    .split('-')
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** `@endora-commerce/` + `quote_requests` → `@endora-commerce/mod-quote-requests`. */
export function npmNameFor(scope: string, moduleId: string): string {
  return `${scope}mod-${slugOf(moduleId)}`;
}

/**
 * The admin API path an emitted screen is served at.
 *
 * `check:action-route-permissions` reconstructs the *entry route* of a palette
 * action in three levels and takes the first that answers; level 1 is an exact
 * registration at `/api/v1/admin` + the target. Emitting the route at exactly
 * that path is what makes the action's declared permission the code the check
 * finds, without the emitted module depending on a fallback level.
 */
export function adminApiPathFor(route: string): string {
  return `/api/v1/admin${route}`;
}

/** Every admin route the emitted module registers, deduplicated, in input order. */
export function adminRoutesOf(spec: ModuleScaffoldSpec): readonly string[] {
  if (spec.permissions.length === 0) return [];
  const routes = spec.actions.map((action) => action.route);
  if (routes.length === 0) return [`/${slugOf(spec.id)}`];
  return [...new Set(routes)];
}

/**
 * The permission every emitted admin route is gated by.
 *
 * The first one declared, and the scaffold says so rather than inventing a
 * mapping the flags cannot express: `--permission` is repeatable and `--action`
 * carries no permission of its own, so any other choice would be the tool
 * deciding which of the author's codes gates which of the author's screens.
 * `check:action-route-permissions` compares the action's `requiredPermission`
 * against the gate on that action's own route, so the two must be this one
 * value.
 */
export function gatingPermissionOf(spec: ModuleScaffoldSpec): ScaffoldPermission | null {
  return spec.permissions[0] ?? null;
}

/** The raw answers, before validation. Every field is optional exactly as argv is. */
export interface ScaffoldInput {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly actions?: readonly string[] | undefined;
  readonly icon?: string | undefined;
  readonly entities?: boolean | undefined;
  readonly ports?: boolean | undefined;
  readonly worker?: boolean | undefined;
  readonly subscriber?: boolean | undefined;
  readonly tenantScope?: string | undefined;
  readonly activationSetting?: string | undefined;
  readonly nonDeactivatable?: string | undefined;
  readonly now?: Date | undefined;
}

const DEFAULT_ICON: KnownIconName = 'Boxes';

/**
 * Normalise and refuse. Every refusal here happens before the command writes its
 * first byte (`cli-surface.md` §3.3): a partially written module type-checks
 * against nothing, is in no registry, and makes the author's next command a
 * manual clean-up.
 */
export function buildScaffoldSpec(input: ScaffoldInput): ModuleScaffoldSpec {
  const id = (input.id ?? '').trim();
  if (id.length === 0) {
    throw new ScaffoldInputError(
      'a module id is required: `endora new module <id> --name … --description …`.',
    );
  }
  if (!moduleIdRe.test(id)) {
    throw new ScaffoldInputError(
      `"${id}" is not a legal module id. It must match ${String(moduleIdRe)} — the id is the ` +
        `directory name, the \`endora.id\` in package.json and the \`id\` in src/manifest.ts, ` +
        `and those three have to agree.`,
    );
  }

  const name = (input.name ?? '').trim();
  if (name.length === 0) {
    throw new ScaffoldInputError(
      '--name is required. A module\'s human-readable name is a human judgement and this ' +
        'command does not invent one.',
    );
  }
  const description = (input.description ?? '').trim();
  if (description.length === 0) {
    throw new ScaffoldInputError(
      '--description is required. It is the one field of package.json the platform\'s ' +
        'manifest generator refuses to invent, and it is seeded from src/manifest.ts, so a ' +
        'module without one cannot get a package.json at all.',
    );
  }

  const dependencies = (input.dependencies ?? []).map((entry) => entry.trim()).filter(Boolean);
  for (const dependency of dependencies) {
    if (!moduleIdRe.test(dependency)) {
      throw new ScaffoldInputError(
        `--depends "${dependency}" is not a legal module id (${String(moduleIdRe)}).`,
      );
    }
    if (dependency === id) {
      throw new ScaffoldInputError(`--depends "${dependency}" is this module itself.`);
    }
  }

  const permissions = (input.permissions ?? []).map((entry) => parsePermission(entry, id));
  const seenPermissions = new Set<string>();
  for (const permission of permissions) {
    if (seenPermissions.has(permission.code)) {
      throw new ScaffoldInputError(
        `--permission "${permission.code}" is declared twice; one code has one label.`,
      );
    }
    seenPermissions.add(permission.code);
  }

  const actions = (input.actions ?? []).map((entry) => parseAction(entry));
  const seenActions = new Set<string>();
  for (const action of actions) {
    if (seenActions.has(action.id)) {
      throw new ScaffoldInputError(`--action "${action.id}" is declared twice.`);
    }
    seenActions.add(action.id);
  }
  if (actions.length > 0 && permissions.length === 0) {
    throw new ScaffoldInputError(
      'an --action needs a --permission: `check:action-route-permissions` compares the ' +
        'action\'s `requiredPermission` against the code enforced on that action\'s own route, ' +
        'and a module with no permission emits no gated route for it to find.',
    );
  }

  const icon = parseIcon(input.icon);
  const tenantScope = parseTenantScope(input.tenantScope);
  const activation = parseActivation(input.activationSetting, input.nonDeactivatable, id);

  const spec: ModuleScaffoldSpec = {
    id,
    name,
    description,
    dependencies: [...dependencies].sort(),
    permissions,
    actions,
    icon,
    layers: {
      entities: input.entities === true,
      ports: input.ports === true,
      worker: input.worker === true,
      subscriber: input.subscriber === true,
    },
    tenantScope,
    activation,
    migrationStamp: migrationStampFor(input.now ?? new Date()),
  };

  // The last refusal, and the one that costs nothing to keep honest: build the
  // manifest this run is about to emit and hand it to the contract's own
  // validator. Every rule about an id, a permission code, an action id, a
  // translation key, an icon, a target route, a setting code and the
  // activation union is enforced by the schema that will enforce it at boot,
  // rather than by a second copy of those regexes here.
  try {
    defineModuleManifest(manifestObjectFor(spec));
  } catch (error: unknown) {
    throw new ScaffoldInputError(
      `the manifest these inputs describe is not valid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return spec;
}

/**
 * The manifest object the emitted `src/manifest.ts` describes.
 *
 * Built here so `buildScaffoldSpec` can validate it through
 * `defineModuleManifest`, and used by the emitter to render the source text —
 * one shape, validated and rendered from the same value.
 */
export function manifestObjectFor(spec: ModuleScaffoldSpec): Parameters<typeof defineModuleManifest>[0] {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    version: '1.0.0',
    dependencies: [...spec.dependencies],
    activation:
      spec.activation.kind === 'setting'
        ? { settingCode: spec.activation.settingCode, default: true }
        : { nonDeactivatable: true as const, reason: spec.activation.reason },
    i18n: { bundlesDir: 'i18n' },
    ...(spec.permissions.length === 0
      ? {}
      : {
          permissions: spec.permissions.map((permission) => ({
            code: permission.code,
            module: spec.id,
            label: permission.label,
          })),
        }),
    ...(spec.actions.length === 0
      ? {}
      : {
          actions: spec.actions.map((action, index) => ({
            id: action.id,
            labelKey: `actions.${camelOfActionId(action.id)}.label`,
            descriptionKey: `actions.${camelOfActionId(action.id)}.description`,
            icon: spec.icon,
            targetRoute: action.route,
            requiredPermission: gatingPermissionOf(spec)?.code ?? '',
            keywords: [spec.name.toLowerCase()],
            weight: 100 + index,
          })),
        }),
  };
}

function parsePermission(entry: string, moduleId: string): ScaffoldPermission {
  const separator = entry.indexOf('=');
  if (separator <= 0) {
    throw new ScaffoldInputError(
      `--permission "${entry}" must be written <code>=<label>, e.g. ` +
        `--permission ${segmentOf(moduleId)}:read="View ${segmentOf(moduleId)}".`,
    );
  }
  const code = entry.slice(0, separator).trim();
  const label = entry.slice(separator + 1).trim();
  if (code.length === 0 || label.length === 0) {
    throw new ScaffoldInputError(
      `--permission "${entry}" needs both a code and a label; the label is what an operator ` +
        `reads on /admin-roles.`,
    );
  }
  if (PERMISSION_CATALOGUE.some((existing) => existing.code === code)) {
    throw new ScaffoldInputError(
      `--permission "${code}" is already in the core PERMISSION_CATALOGUE. A shared code has ` +
        `one owner; enforce it from your routes instead of declaring it a second time.`,
    );
  }
  return { code, label };
}

function parseAction(entry: string): ScaffoldAction {
  const separator = entry.indexOf('=');
  if (separator <= 0) {
    throw new ScaffoldInputError(
      `--action "${entry}" must be written <action-id>=<admin-route>, e.g. ` +
        `--action open-widgets=/widgets.`,
    );
  }
  const id = entry.slice(0, separator).trim();
  const route = entry.slice(separator + 1).trim();
  if (route.includes('?')) {
    throw new ScaffoldInputError(
      `--action "${id}" targets "${route}", which carries a query string. A palette action ` +
        `names a route, and the manifest's route pattern rejects one.`,
    );
  }
  if (!route.startsWith('/')) {
    throw new ScaffoldInputError(
      `--action "${id}" targets "${route}", which is not an admin route; it must start with "/".`,
    );
  }
  return { id, route };
}

function parseIcon(icon: string | undefined): KnownIconName {
  if (icon === undefined) return DEFAULT_ICON;
  const parsed = KnownIconNameSchema.safeParse(icon);
  if (!parsed.success) {
    throw new ScaffoldInputError(
      `--icon "${icon}" is not in KnownIconNameSchema. The admin maps those names to ` +
        `components in admin/src/lib/admin-actions/icon-map.ts, so a name outside the schema ` +
        `renders nothing.`,
    );
  }
  return parsed.data;
}

function parseTenantScope(value: string | undefined): TenantScope {
  if (value === undefined) return 'org-scoped';
  if ((TENANT_SCOPES as readonly string[]).includes(value)) return value as TenantScope;
  throw new ScaffoldInputError(
    `--tenant-scope "${value}" is not one of ${TENANT_SCOPES.join(', ')}. Every persisted ` +
      `entity carries exactly one tenant-scope decorator (Principle XI).`,
  );
}

function parseActivation(
  settingCode: string | undefined,
  reason: string | undefined,
  moduleId: string,
): ScaffoldActivation {
  if (settingCode !== undefined && reason !== undefined) {
    throw new ScaffoldInputError(
      '--activation-setting and --non-deactivatable are the two forms of one declaration; ' +
        'exactly one of them is valid.',
    );
  }
  if (reason !== undefined) {
    if (reason.trim().length === 0) {
      throw new ScaffoldInputError(
        '--non-deactivatable needs a reason: it is the sentence an operator reads beside the ' +
          'locked control, and it is why the platform refuses to disable or uninstall the ' +
          'module at all.',
      );
    }
    return { kind: 'non-deactivatable', reason: reason.trim() };
  }
  if (moduleId.startsWith('_')) {
    throw new ScaffoldInputError(
      `"${moduleId}" is an \`_\`-prefixed id, which the platform reserves for its own ` +
        `internals, and \`defineModuleManifest\` refuses every activation form for one except ` +
        `\`nonDeactivatable\`. Pass --non-deactivatable "<reason>" — the reason is the sentence ` +
        `an operator reads beside the locked control — or choose an id without the underscore.`,
    );
  }
  const code = (settingCode ?? `${moduleId}.enabled`).trim();
  if (!settingCodeRe.test(code)) {
    throw new ScaffoldInputError(
      `--activation-setting "${code}" is not a legal setting code (${String(settingCodeRe)}).`,
    );
  }
  return { kind: 'setting', settingCode: code };
}

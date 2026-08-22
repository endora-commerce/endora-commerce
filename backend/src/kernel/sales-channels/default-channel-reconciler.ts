import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '../ports/audit.js';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@b2b/contracts';
import { SalesChannel } from './sales-channel.entity.js';

/**
 * DefaultChannelReconciler — feature 005 / T013.
 *
 * Boot-time idempotent guarantee that the platform has exactly one
 * `system_default = true` Sales Channel (FR-002, research R-4). The
 * partial unique index on `system_default` (migration 025) prevents two
 * winners; this service handles the "zero winners" case across all
 * possible startup states.
 *
 * Decision tree (run on every backend boot):
 *
 *   1. Zero rows in `sales_channels`
 *      → INSERT a fresh `Default` row with `system_default = true`,
 *        sourced from env var `DEFAULT_SALES_CHANNEL_CODE` (default
 *        `default`). Audit `lifecycle.changed{op:'system-default-promoted'}`.
 *
 *   2. ≥1 rows AND none has `system_default = true`
 *      → Promote the lexically-first row by `code` (with a tie-break
 *        toward `code = 'default'`). This handles the upgrade-from-002
 *        case where the seed inserted a channel before this feature
 *        existed. Audit the promotion.
 *
 *   3. Exactly one row has `system_default = true`
 *      → No-op. Idempotent re-runs land here.
 *
 * The reconciler NEVER DEMOTES an already-promoted row, never deletes,
 * and never edits identity. A platform that finds itself with multiple
 * system-default rows (only possible if the partial unique index is
 * missing, e.g. on a partially-migrated DB) leaves the rows alone and
 * emits a critical warning so the operator can intervene — see
 * {@link DefaultChannelReconciliationResult.warning}.
 */

export interface DefaultChannelReconciliationResult {
  /** Action taken in this run. */
  action: 'inserted' | 'promoted' | 'no_change' | 'warning';
  /** The system-default channel after reconciliation, when known. */
  systemDefault?: SalesChannel;
  /** Operator-actionable warning text when the partial unique index is missing or multiple defaults are observed. */
  warning?: string;
}

const DEFAULT_CODE_FALLBACK = 'default';
const DEFAULT_LANGUAGE_FALLBACK = 'en';
const DEFAULT_CURRENCY_FALLBACK = 'EUR';

export interface DefaultChannelReconcilerOptions {
  /**
   * Used by tests whose `languages` / `currencies` seed differs from the
   * `en` / `EUR` fallbacks. Production always uses the env-driven
   * fallbacks (research R-4); these overrides are not exposed in
   * `composition.ts`.
   */
  bootstrapDefaults?: {
    code?: string;
    language?: string;
    currency?: string;
  };
}

export class DefaultChannelReconciler {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLogService?: AuditPort,
    private readonly options: DefaultChannelReconcilerOptions = {},
  ) {}

  async run(): Promise<DefaultChannelReconciliationResult> {
    const em = this.emFactory();
    const all = await em.find(SalesChannel, {});

    // Branch 1 — empty table. Insert Default.
    if (all.length === 0) {
      const inserted = await this.insertDefault(em);
      return { action: 'inserted', systemDefault: inserted };
    }

    const defaults = all.filter((c) => c.systemDefault);

    // Branch 3 — exactly one already promoted: no-op.
    if (defaults.length === 1) {
      return { action: 'no_change', systemDefault: defaults[0]! };
    }

    // Branch warning — multiple defaults observed (only possible if the
    // partial unique index is missing). Leave them alone, emit a warning.
    if (defaults.length > 1) {
      return {
        action: 'warning',
        warning:
          `[sales_channels] expected at most one row with system_default = true, ` +
          `observed ${defaults.length}. The partial unique index ` +
          `"sales_channels_one_system_default" is likely missing or migration 025 ` +
          `has not been applied. Manual intervention is required.`,
      };
    }

    // Branch 2 — no defaults. Promote the lexically-first row, tie-breaking
    // toward `code = 'default'`.
    const candidates = [...all].sort((a, b) => {
      const aIsDefault = a.code === DEFAULT_CODE_FALLBACK ? 0 : 1;
      const bIsDefault = b.code === DEFAULT_CODE_FALLBACK ? 0 : 1;
      if (aIsDefault !== bIsDefault) return aIsDefault - bIsDefault;
      return a.code.localeCompare(b.code);
    });
    const winner = candidates[0]!;
    winner.systemDefault = true;
    winner.version += 1;
    await em.persistAndFlush(winner);

    await this.audit(
      winner.id,
      'system-default-promoted',
      `boot-time reconciler promoted "${winner.code}" to system default`,
    );

    return { action: 'promoted', systemDefault: winner };
  }

  private async insertDefault(em: EntityManager): Promise<SalesChannel> {
    const code =
      this.options.bootstrapDefaults?.code ??
      process.env['DEFAULT_SALES_CHANNEL_CODE'] ??
      DEFAULT_CODE_FALLBACK;
    const language =
      this.options.bootstrapDefaults?.language ?? DEFAULT_LANGUAGE_FALLBACK;
    const currency =
      this.options.bootstrapDefaults?.currency ?? DEFAULT_CURRENCY_FALLBACK;

    const channel = em.create(SalesChannel, {
      code,
      name: { en: 'Default' },
      languages: [language],
      defaultLanguage: language,
      currencies: [currency],
      defaultCurrency: currency,
      active: true,
      systemDefault: true,
      version: 1,
      // Legacy columns preserved for one release (research R-12).
      isPublic: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);

    await this.audit(
      channel.id,
      'system-default-promoted',
      `boot-time reconciler inserted fresh "${code}" as system default`,
    );

    return channel;
  }

  private async audit(channelId: string, op: string, reason: string): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.record({
      actorAdminUserId: null,
      action: SALES_CHANNEL_AUDIT_ACTIONS.LIFECYCLE_CHANGED,
      objectType: 'sales_channel',
      objectId: channelId,
      stateAfter: { op, reason },
    });
  }
}

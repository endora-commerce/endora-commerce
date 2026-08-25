import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  NumberPatternCollision,
  NumberingSeries,
  SettingsAdminPort,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import { INVOICES_SETTING_CODES } from '../../manifest.js';
import { findNumberPatternCollisions } from './invoice-number-collisions.js';
import {
  PRE_CHANNEL_DEFAULT_PATTERNS,
  effectivePattern,
  type InvoiceKind,
} from './invoice-number-generator.js';

/** The three numbering settings, in the order an operator meets them. */
const PATTERN_SETTING_CODE: Record<InvoiceKind, string> = {
  invoice: INVOICES_SETTING_CODES.NUMBERING_INVOICE_PATTERN,
  proforma: INVOICES_SETTING_CODES.NUMBERING_PROFORMA_PATTERN,
  correction: INVOICES_SETTING_CODES.NUMBERING_CORRECTION_PATTERN,
};

const KINDS: readonly InvoiceKind[] = ['invoice', 'proforma', 'correction'];

/** What this service writes to. `warn` is the report; nothing here blocks boot. */
export interface NumberingConfigurationLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * The numbering configuration a deployment boots with — feature 078, D-95.3
 * and D-95.4.
 *
 * Two jobs, in this order and for a stated reason:
 *
 *  1. **Grandfather the system-default channel.** The shipped defaults now
 *     carry `{channel}`, so a fresh deployment numbers `FV 1/DEFAULT/2026`
 *     unless something says otherwise. An accountant expects `FV 1/2026`, and
 *     an existing deployment's series must not change shape mid-year, so the
 *     system-default channel is pinned to the pre-D-95 pattern as an explicit
 *     per-channel value — **only** while the setting is otherwise untouched.
 *     The platform picks a default for you and never rewrites your choice.
 *  2. **Report what is left.** Every `(kind, channel)` pair goes through the
 *     collision predicate and each colliding pair is logged as a `warn`. It
 *     runs *after* step 1 so it never names a pair the same boot has just
 *     repaired — a report full of noise is a report nobody reads within a week.
 *     It does not block boot: what survives step 1 is a pattern the operator
 *     configured themselves, and refusing to start would take down the
 *     storefront, the catalogue and the checkout to protect an invoice the
 *     issuance refusal already protects.
 */
export class NumberingConfigurationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * The audited settings write (Constitution XIII), read per call rather than
     * captured: `settings` is non-deactivatable, so the gate has no "no" to
     * give, but the accessor keeps this service from freezing a registration.
     */
    private readonly settingsAdmin: () => SettingsAdminPort,
    private readonly log: NumberingConfigurationLogger,
  ) {}

  /** Both jobs, in order. Called once per boot. */
  async reconcile(): Promise<void> {
    await this.pinSystemDefaultChannel();
    await this.reportCollisions();
  }

  /**
   * D-95.3 move 3 — pin the system-default channel to the pre-D-95 pattern,
   * once, and only while nobody has configured the setting.
   *
   * "Untouched" is `globalValue === null` **and** no `SettingValue` row for the
   * system-default channel. An operator who wrote a pattern — even one that now
   * collides — keeps it; that case belongs to the report and to the two
   * refusals, never to a silent rewrite.
   */
  private async pinSystemDefaultChannel(): Promise<void> {
    const em = this.emFactory();
    const systemDefault = await em.findOne(SalesChannel, { systemDefault: true });
    if (!systemDefault) {
      // A system-default channel always exists (the boot reconciler owns that
      // invariant). Reporting rather than inventing one: a fabricated channel
      // here would pin a series to a row that is not the platform's default.
      this.log.warn(
        { module: 'invoices' },
        'invoices: no system-default sales channel, so the pre-D-95 numbering pattern was not pinned',
      );
      return;
    }

    for (const kind of KINDS) {
      const code = PATTERN_SETTING_CODE[kind];
      const setting = await em.findOne(Setting, { code });
      if (!setting) continue;
      if (setting.globalValue !== null && setting.globalValue !== undefined) continue;
      const existing = await em.findOne(SettingValue, {
        setting,
        salesChannel: systemDefault.id,
      });
      if (existing) continue;

      try {
        await this.settingsAdmin().setValueForSubset(
          code,
          [systemDefault.code],
          PRE_CHANNEL_DEFAULT_PATTERNS[kind],
          null,
          { actorAdminUserId: null },
        );
      } catch (err) {
        // A switched-off `settings` is not a tolerable outcome here — the write
        // is the whole point of the hook — so the gate's answer goes straight
        // back out, before any other test. `ModuleDisabledError` is an
        // `HttpError`, so an `instanceof` or status test would let it through
        // by accident rather than by decision.
        rethrowIfModuleDisabled(err);
        // The narrow tolerance, and it is D-95.4 written as code: another
        // channel already carries the historical pattern as an explicit value,
        // so pinning it here would duplicate it and the module's own write
        // validator refuses. That is a configuration the operator made, and
        // refusing to boot over it would take down the storefront, the
        // catalogue and the checkout to protect an invoice the issuance refusal
        // already protects. The report below names the pair; nothing is
        // silently absorbed.
        this.log.warn(
          {
            module: 'invoices',
            settingCode: code,
            salesChannelCode: systemDefault.code,
            reason: err instanceof Error ? err.message : String(err),
          },
          'invoices: could not pin the system-default channel to its historical numbering pattern',
        );
        continue;
      }
      this.log.info(
        { module: 'invoices', settingCode: code, salesChannelCode: systemDefault.code },
        'invoices: pinned the system-default channel to its historical numbering pattern',
      );
    }
  }

  /** Every `(kind, channel)` series the platform currently resolves. */
  async seriesFor(kind: InvoiceKind): Promise<NumberingSeries[]> {
    const em = this.emFactory();
    const channels = await em.find(SalesChannel, {});
    const setting = await em.findOne(Setting, { code: PATTERN_SETTING_CODE[kind] });
    const values = setting
      ? await em.find(SettingValue, { setting }, { populate: ['salesChannel'] })
      : [];
    const byChannelId = new Map(values.map((value) => [value.salesChannel.id, value.value]));
    const globalValue = setting?.globalValue;

    return channels.map((channel) => {
      const stored = byChannelId.has(channel.id) ? byChannelId.get(channel.id) : globalValue;
      return {
        salesChannelId: channel.id,
        salesChannelCode: channel.code,
        salesChannelName: channelName(channel),
        pattern: effectivePattern(kind, typeof stored === 'string' ? stored : null),
      };
    });
  }

  /**
   * D-95.4 — name every surviving collision, loudly, and do not block boot.
   *
   * The count line is emitted even when the count is zero, so its absence means
   * the report did not run rather than that it found nothing.
   */
  async reportCollisions(): Promise<number> {
    let total = 0;
    for (const kind of KINDS) {
      const collisions = findNumberPatternCollisions(await this.seriesFor(kind));
      total += collisions.length;
      for (const collision of collisions) {
        this.log.warn(describeCollision(kind, collision), 'invoices: two sales channels can produce the same document number');
      }
    }
    this.log.info(
      { module: 'invoices', collidingPairs: total },
      'invoices: numbering pattern collision report',
    );
    return total;
  }
}

/** The `warn` payload — both channel codes, both patterns and the proof. */
function describeCollision(kind: InvoiceKind, collision: NumberPatternCollision): object {
  return {
    module: 'invoices',
    kind,
    salesChannelCodes: [collision.a.salesChannelCode, collision.b.salesChannelCode],
    patterns: [collision.a.pattern, collision.b.pattern],
    example: collision.example,
  };
}

/**
 * A channel's display name. `SalesChannel.name` is a per-language map, so a
 * caller that needs one string picks English, then whatever is there, then the
 * code — which is never empty.
 */
export function channelName(channel: SalesChannel): string {
  const names = channel.name ?? {};
  return names['en'] ?? Object.values(names)[0] ?? channel.code;
}

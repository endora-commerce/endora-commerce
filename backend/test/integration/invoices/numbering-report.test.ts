import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import type { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { NumberingConfigurationService } from '../../../src/modules/invoices/services/numbering-configuration.js';
import {
  ensureSalesChannel,
  systemDefaultSalesChannel,
} from '../../helpers/sales-channel-fixtures.js';

/**
 * Feature 078, D-95.4 — a deployment already in the colliding state is
 * reported, loudly, and is **not** blocked.
 *
 * Blocking the boot would convert a fixable invoicing misconfiguration into a
 * storefront outage: what survives the grandfather write is a pattern the
 * operator configured themselves, and the issuance refusal already protects the
 * invoice. The report runs *after* the repair so it never names a pair the same
 * boot has just fixed.
 */

interface LogLine {
  readonly level: 'info' | 'warn';
  readonly payload: Record<string, unknown>;
  readonly message: string;
}

describe('invoices — the numbering collision report', () => {
  let h: BackendServerHandle;
  let lines: LogLine[];
  let numbering: NumberingConfigurationService;

  beforeAll(async () => {
    h = await setupBackendServer();
    lines = [];
    numbering = new NumberingConfigurationService(h.em, () => h.settings.adminService, {
      info: (payload, message) =>
        lines.push({ level: 'info', payload: payload as Record<string, unknown>, message }),
      warn: (payload, message) =>
        lines.push({ level: 'warn', payload: payload as Record<string, unknown>, message }),
    });
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Write a pattern straight into the store, bypassing the write refusal. */
  async function forcePattern(channel: SalesChannel, pattern: string): Promise<void> {
    const em = h.em();
    const setting = await em.findOne(Setting, { code: 'invoices.numbering.invoice.pattern' });
    const existing = await em.findOne(SettingValue, { setting, salesChannel: channel.id });
    if (existing) existing.value = pattern;
    else em.create(SettingValue, { setting: setting!, salesChannel: channel, value: pattern });
    await em.flush();
  }

  it('finds nothing on an untouched two-channel deployment', async () => {
    await ensureSalesChannel(h.em(), 'report-clean');
    lines.length = 0;
    const collisions = await numbering.reportCollisions();
    expect(collisions).toBe(0);
    // The count line is emitted even at zero, so its absence means the report
    // did not run rather than that it found nothing.
    expect(lines.filter((line) => line.level === 'info')).toHaveLength(1);
    expect(lines[0]!.payload['collidingPairs']).toBe(0);
    expect(lines.some((line) => line.level === 'warn')).toBe(false);
  });

  it('names both channels, the kind and an example, and does not throw', async () => {
    const first = await systemDefaultSalesChannel(h.em());
    const second = await ensureSalesChannel(h.em(), 'report-collides');
    await forcePattern(first, 'FVRPT {seq}/{YYYY}');
    await forcePattern(second, 'FVRPT {seq}/{YYYY}');

    lines.length = 0;
    const collisions = await numbering.reportCollisions();

    expect(collisions).toBeGreaterThanOrEqual(1);
    const warned = lines.find((line) => line.level === 'warn');
    expect(warned).toBeDefined();
    expect(warned!.payload['kind']).toBe('invoice');
    expect(warned!.payload['salesChannelCodes']).toEqual(
      expect.arrayContaining([first.code, second.code]),
    );
    expect(String(warned!.payload['example'])).toMatch(/^FVRPT \d+\/\d{4}$/);
    // Non-blocking: the count line is still emitted after the warnings.
    expect(
      lines.filter(
        (line) => line.level === 'info' && line.message.includes('collision report'),
      ),
    ).toHaveLength(1);
  });
});

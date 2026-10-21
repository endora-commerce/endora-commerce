import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';
import {
  presetConfig,
  type PrecedenceConfig,
  type PresetName,
} from '../../../../../packages/modules/price_lists/src/backend/services/precedence.js';

/**
 * Feature 160 (FR-022, D-287 §5.6) — the cases where the presets differ, under
 * **all four**: the N11 evidence table, F1–F5, C1 under both toggles, H1–H2
 * (`specs/pricing/worked-examples.md` §10.10). Each preset is installed as a
 * test-only active precedence version and removed again; version 1 = HY is
 * restored after every case.
 */
const PRESETS: PresetName[] = ['AF', 'SF', 'HY', 'AF-N'];

describe('worked examples — the configurable precedence (§10.10)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);

  async function usePrecedence(config: PrecedenceConfig): Promise<void> {
    await sql(`delete from "price_list_precedence" where "version" = 2`);
    await sql(`update "price_list_precedence" set "state" = 'superseded' where "version" = 1`);
    await sql(
      `insert into "price_list_precedence" ("version", "cells", "category_before_attribute", "depth_mode", "state", "created_at", "activated_at")
       values (2, ?::jsonb, ?, ?, 'active', now(), now())`,
      [JSON.stringify(config.cells), config.categoryBeforeAttribute, config.depthMode],
    );
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
    await sql(`delete from "price_list_precedence" where "version" = 2`);
    await sql(`update "price_list_precedence" set "state" = 'active' where "version" = 1`);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const acme = () => ({ organization: f.orgs.Acme });

  async function forEachPreset(expected: Record<PresetName, string>, measure: () => Promise<string | null>) {
    const seen: Record<string, string | null> = {};
    for (const preset of PRESETS) {
      await usePrecedence(presetConfig(preset));
      seen[preset] = await measure();
    }
    expect(seen).toEqual(expected);
  }

  it('N11 evidence — E1, E2, E3.1–E3.3 agree under every preset', async () => {
    await f.book({ name: 'L1', audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
    const all = (v: string) => ({ AF: v, SF: v, HY: v, 'AF-N': v });
    await forEachPreset(all('120.0000'), () => f.amount('guest', f.products.P1));
    await forEachPreset(all('50.0000'), () => f.amount('guest', f.products.P2));
    await forEachPreset(all('30.0000'), () => f.amount('guest', f.products.P3));
    await f.clearBooks();

    await f.book({
      name: 'L2',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { category: f.categories.screws, percent: '-10' },
        { product: f.products.P1, percent: '-20' },
      ],
    });
    await forEachPreset(all('80.0000'), () => f.amount(acme(), f.products.P1));
    await forEachPreset(all('45.0000'), () => f.amount(acme(), f.products.P2));
    await f.clearBooks();

    await f.book({ name: 'L3', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] });
    await f.book({
      name: 'L4',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
      ],
    });
    await forEachPreset(all('95.0000'), () => f.amount(acme(), f.products.P1));
    await forEachPreset(all('90.0000'), () => f.amount({ organization: f.orgs.Beta }, f.products.P1));
    await forEachPreset(all('42.5000'), () => f.amount(acme(), f.products.P2));
  });

  it('E3.4 = F3 — SF is out', async () => {
    await f.book({
      name: 'L3',
      audience: { groups: [f.groups.VIP] },
      rows: [
        { product: f.products.P1, percent: '-10' },
        { product: f.products.P2, percent: '-10' },
      ],
    });
    await f.book({
      name: 'L4',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
      ],
    });
    await forEachPreset({ AF: '42.5000', SF: '45.0000', HY: '42.5000', 'AF-N': '42.5000' }, () =>
      f.amount(acme(), f.products.P2),
    );
  });

  it('F1 — an organization blanket against a group product row', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-2' }] });
    await f.book({ audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-30' }] });
    await forEachPreset({ AF: '98.0000', SF: '70.0000', HY: '70.0000', 'AF-N': '98.0000' }, () =>
      f.amount(acme(), f.products.P1),
    );
  });

  it('F2 — an organization blanket is off the channel’s catalogue price', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '90' }] });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-3' }] });
    await forEachPreset({ AF: '87.3000', SF: '87.3000', HY: '87.3000', 'AF-N': '87.3000' }, () =>
      f.amount(acme(), f.products.P1),
    );
  });

  it('F4 — an organization category percentage is off the catalogue price', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P2, fixed: '48' }] });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ category: f.categories.screws, percent: '-15' }] });
    await forEachPreset({ AF: '40.8000', SF: '40.8000', HY: '40.8000', 'AF-N': '40.8000' }, () =>
      f.amount(acme(), f.products.P2),
    );
  });

  it('F5 — an organization blanket against a group category row', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-2' }] });
    await f.book({ audience: { groups: [f.groups.VIP] }, rows: [{ category: f.categories.screws, percent: '-5' }] });
    await forEachPreset({ AF: '49.0000', SF: '47.5000', HY: '47.5000', 'AF-N': '49.0000' }, () =>
      f.amount(acme(), f.products.P2),
    );
  });

  it('C1 — category before attribute, and the attribute-first toggle', async () => {
    await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { category: f.categories.screws, percent: '-10' },
        { attribute: ['color', 'red'], percent: '-20' },
      ],
    });
    await forEachPreset({ AF: '90.0000', SF: '90.0000', HY: '90.0000', 'AF-N': '90.0000' }, () =>
      f.amount(acme(), f.products.P1),
    );
    const seen: Record<string, string | null> = {};
    for (const preset of PRESETS) {
      await usePrecedence(presetConfig(preset, false));
      seen[preset] = await f.amount(acme(), f.products.P1);
    }
    expect(seen).toEqual({ AF: '80.0000', SF: '80.0000', HY: '80.0000', 'AF-N': '80.0000' });
  });

  it('H1 — chain depth inside the cell, except under AF-N', async () => {
    await f.book({ audience: { organizations: [f.orgs.AcmeW] }, rows: [{ category: f.categories.screws, percent: '-7' }] });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-5' }] });
    await forEachPreset({ AF: '95.0000', SF: '95.0000', HY: '95.0000', 'AF-N': '93.0000' }, () =>
      f.amount({ organization: f.orgs.AcmeW }, f.products.P1),
    );
  });

  it('H2 — the nearer organization wins inside one cell', async () => {
    await f.book({ audience: { organizations: [f.orgs.AcmeW] }, rows: [{ product: f.products.P1, percent: '-7' }] });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-5' }] });
    await forEachPreset({ AF: '93.0000', SF: '93.0000', HY: '93.0000', 'AF-N': '93.0000' }, () =>
      f.amount({ organization: f.orgs.AcmeW }, f.products.P1),
    );
  });
});

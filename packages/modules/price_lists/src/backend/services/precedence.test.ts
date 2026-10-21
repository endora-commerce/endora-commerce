import { describe, expect, it } from 'vitest';
import {
  PRECEDENCE_PRESETS,
  buildRankTable,
  presetConfig,
  presetName,
  selectionOrder,
  validatePrecedence,
  type CellCode,
  type PrecedenceConfig,
  type SelectionKind,
} from './precedence.js';

/**
 * Feature 160 (D-287 §5.6) — the configurable precedence of the twelve buyer
 * cells, exhaustively (FR-021, FR-022).
 *
 * The valid orders are the interleavings of the two six-cell chains in which
 * every `org.k` precedes `group.k` (I1–I3): the 132 ballot sequences, times two
 * for the category/attribute toggle, plus the AF order with
 * nearest-organization-first depth under each toggle (I5) — 266 configurations
 * out of the 924 × 2 × 2 the generator below produces.
 */

function chain(categoryBeforeAttribute: boolean): SelectionKind[] {
  return categoryBeforeAttribute
    ? ['variant', 'product', 'category_attribute', 'category', 'attribute', 'all']
    : ['variant', 'product', 'category_attribute', 'attribute', 'category', 'all'];
}

/** Every interleaving of the org chain and the group chain: C(12, 6) = 924. */
function interleavings(categoryBeforeAttribute: boolean): CellCode[][] {
  const kinds = chain(categoryBeforeAttribute);
  const out: CellCode[][] = [];
  const walk = (org: number, group: number, acc: CellCode[]) => {
    if (org === 6 && group === 6) {
      out.push([...acc]);
      return;
    }
    if (org < 6) walk(org + 1, group, [...acc, `org.${kinds[org]!}` as CellCode]);
    if (group < 6) walk(org, group + 1, [...acc, `group.${kinds[group]!}` as CellCode]);
  };
  walk(0, 0, []);
  return out;
}

/** A small deterministic generator, so a failing permutation reproduces. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('precedence — the configuration space (exhaustive)', () => {
  const all: PrecedenceConfig[] = [];
  for (const categoryBeforeAttribute of [true, false]) {
    for (const cells of interleavings(categoryBeforeAttribute)) {
      for (const depthMode of ['within_cell', 'nearest_organization_first'] as const) {
        all.push({ cells, categoryBeforeAttribute, depthMode });
      }
    }
  }

  it('generates 924 interleavings × 2 toggles × 2 depth modes', () => {
    expect(interleavings(true)).toHaveLength(924);
    expect(all).toHaveLength(924 * 2 * 2);
  });

  it('accepts exactly 266 of them', () => {
    const accepted = all.filter((config) => validatePrecedence(config).valid);
    expect(accepted).toHaveLength(266);
    expect(accepted.filter((c) => c.depthMode === 'nearest_organization_first')).toHaveLength(2);
  });

  it('names the offending pair of every I2 violation', () => {
    for (const config of all.filter((c) => c.depthMode === 'within_cell')) {
      const result = validatePrecedence(config);
      const violations = chain(config.categoryBeforeAttribute).filter(
        (kind) => config.cells.indexOf(`group.${kind}`) < config.cells.indexOf(`org.${kind}`),
      );
      if (violations.length === 0) {
        expect(result.valid).toBe(true);
        continue;
      }
      expect(result.valid).toBe(false);
      if (result.valid) continue;
      const pairs = result.issues.filter((i) => i.invariant === 'I2').map((i) => i.pair);
      expect(pairs).toEqual(violations.map((kind) => [`org.${kind}`, `group.${kind}`]));
    }
  });

  it('refuses nearest-organization-first with any order but AF (I5)', () => {
    for (const config of all.filter((c) => c.depthMode === 'nearest_organization_first')) {
      const af = presetConfig('AF', config.categoryBeforeAttribute);
      const isAf = config.cells.every((cell, i) => cell === af.cells[i]);
      const result = validatePrecedence(config);
      expect(result.valid).toBe(isAf);
      if (!isAf && !result.valid) {
        expect(result.issues.some((i) => i.invariant === 'I5')).toBe(true);
      }
    }
  });

  it('refuses H3 — HY with nearest-organization-first', () => {
    const result = validatePrecedence({ ...presetConfig('HY'), depthMode: 'nearest_organization_first' });
    expect(result.valid).toBe(false);
  });

  it('refuses seeded permutations that break the specificity chain of one audience (I1)', () => {
    const random = seeded(160);
    let refused = 0;
    for (let n = 0; n < 500; n += 1) {
      const cells = [...presetConfig('HY').cells];
      for (let i = cells.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [cells[i], cells[j]] = [cells[j]!, cells[i]!];
      }
      const perAudienceOrder = (audience: 'org' | 'group') =>
        cells.filter((c) => c.startsWith(`${audience}.`)).map((c) => c.split('.')[1]);
      const breaksI1 = (['org', 'group'] as const).some((audience) => {
        const order = perAudienceOrder(audience);
        return (
          order.join() !== chain(true).join() && order.join() !== chain(false).join()
        );
      });
      if (!breaksI1) continue;
      const result = validatePrecedence({ cells, categoryBeforeAttribute: true, depthMode: 'within_cell' });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.issues.some((i) => i.invariant === 'I1')).toBe(true);
      refused += 1;
    }
    expect(refused).toBeGreaterThan(400);
  });

  it('refuses an order whose category/attribute order disagrees with the toggle (I3)', () => {
    const result = validatePrecedence({ ...presetConfig('HY', false), categoryBeforeAttribute: true });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues.some((i) => i.invariant === 'I3')).toBe(true);
  });

  it('refuses a configuration that does not name each of the twelve cells once', () => {
    const cells = [...presetConfig('AF').cells];
    cells[11] = cells[0]!;
    const result = validatePrecedence({ cells, categoryBeforeAttribute: true, depthMode: 'within_cell' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues[0]!.invariant).toBe('shape');
  });
});

describe('precedence — the four presets (decision-record §5.6)', () => {
  it('AF — audience first', () => {
    expect(PRECEDENCE_PRESETS.AF).toEqual({
      cells: [
        'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute', 'org.all',
        'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute', 'group.all',
      ],
      categoryBeforeAttribute: true,
      depthMode: 'within_cell',
    });
  });

  it('SF — specificity first', () => {
    expect(PRECEDENCE_PRESETS.SF.cells).toEqual([
      'org.variant', 'group.variant', 'org.product', 'group.product',
      'org.category_attribute', 'group.category_attribute', 'org.category', 'group.category',
      'org.attribute', 'group.attribute', 'org.all', 'group.all',
    ]);
    expect(PRECEDENCE_PRESETS.SF.depthMode).toBe('within_cell');
  });

  it('HY — contract first, blanket last (the default)', () => {
    expect(PRECEDENCE_PRESETS.HY.cells).toEqual([
      'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
      'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
      'org.all', 'group.all',
    ]);
    expect(PRECEDENCE_PRESETS.HY.depthMode).toBe('within_cell');
  });

  it('AF-N — the AF order with nearest-organization-first depth', () => {
    expect(PRECEDENCE_PRESETS['AF-N'].cells).toEqual(PRECEDENCE_PRESETS.AF.cells);
    expect(PRECEDENCE_PRESETS['AF-N'].depthMode).toBe('nearest_organization_first');
  });

  it('every preset is valid under both toggles, and is recognised by name', () => {
    for (const name of ['AF', 'SF', 'HY', 'AF-N'] as const) {
      for (const toggle of [true, false]) {
        const config = presetConfig(name, toggle);
        expect(validatePrecedence(config).valid).toBe(true);
        expect(presetName(config)).toBe(name);
      }
    }
  });

  it('the attribute-first toggle swaps category and attribute in every audience', () => {
    const cells = presetConfig('HY', false).cells;
    expect(cells.indexOf('org.attribute')).toBeLessThan(cells.indexOf('org.category'));
    expect(cells.indexOf('group.attribute')).toBeLessThan(cells.indexOf('group.category'));
  });

  it('the rank table is each cell’s position in the active order', () => {
    const ranks = buildRankTable(PRECEDENCE_PRESETS.HY);
    expect(ranks.get('org.variant')).toBe(0);
    expect(ranks.get('org.all')).toBe(10);
    expect(ranks.get('group.all')).toBe(11);
    expect(ranks.size).toBe(12);
  });

  it('the selection order for the everyone tiers follows the toggle', () => {
    expect(selectionOrder(true)).toEqual(chain(true));
    expect(selectionOrder(false)).toEqual(chain(false));
  });
});

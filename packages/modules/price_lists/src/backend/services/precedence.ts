import type {
  PrecedenceDepthMode,
  PrecedencePresetName,
  PriceBookCellCode,
  PriceBookSelectionKind,
} from '@endora-commerce/contracts';
import { PRICE_BOOK_CELL_CODES } from '@endora-commerce/contracts';

/**
 * The configurable precedence of the twelve buyer cells — feature 160,
 * `specs/pricing/decision-record.md` §5.6 (D-287, owner ruling Q11).
 *
 * A **cell** is audience kind × selection kind (`org.product`,
 * `group.category`, …). The precedence orders the twelve buyer cells; the
 * resolver reads it as a rank table, the first component of its order key, and
 * nothing else about the buyer tier is configurable. What is fixed, and why, is
 * the invariants:
 *
 * - **I1** within one audience the selection kinds keep the specificity order
 *   variant > product > category ∩ attribute > {category, attribute} > all;
 * - **I2** for each selection kind, `org.<kind>` before `group.<kind>`;
 * - **I3** the category/attribute order is the toggle's, the same in every
 *   audience (and in the catalogue and sale tiers);
 * - **I5** `nearest_organization_first` only with the AF order.
 *
 * (I4 — the three tiers and priority after rank — is the resolver's structure,
 * not a property of a stored order.) Under I1–I3 the valid orders are the 132
 * ballot interleavings of the two six-cell chains, × 2 for the toggle, plus AF
 * with nearest-first depth under each toggle: **266** configurations, which
 * `precedence.test.ts` enumerates exhaustively.
 *
 * Pure: the active version is read by the pricing service (one statement per
 * pricing generation); P1 has no write path (FR-023), and P3's change flow will
 * validate with this same function.
 */

export type SelectionKind = PriceBookSelectionKind;
export type CellCode = PriceBookCellCode;
export type DepthMode = PrecedenceDepthMode;
export type PresetName = PrecedencePresetName;

export interface PrecedenceConfig {
  readonly cells: readonly CellCode[];
  readonly categoryBeforeAttribute: boolean;
  readonly depthMode: DepthMode;
}

export interface PrecedenceIssue {
  readonly invariant: 'shape' | 'I1' | 'I2' | 'I3' | 'I5';
  readonly message: string;
  /** For I2: the `[org.k, group.k]` pair whose order is reversed. */
  readonly pair?: readonly [CellCode, CellCode];
}

export type PrecedenceValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly PrecedenceIssue[] };

/** The specificity chain of one audience, under the toggle (I1, I3). */
export function selectionOrder(categoryBeforeAttribute: boolean): readonly SelectionKind[] {
  return categoryBeforeAttribute
    ? ['variant', 'product', 'category_attribute', 'category', 'attribute', 'all']
    : ['variant', 'product', 'category_attribute', 'attribute', 'category', 'all'];
}

const cell = (audience: 'org' | 'group', kind: SelectionKind): CellCode =>
  `${audience}.${kind}` as CellCode;

/** The four shipped orders, under category-before-attribute (decision-record §5.6). */
function presetCells(name: PresetName, categoryBeforeAttribute: boolean): CellCode[] {
  const kinds = selectionOrder(categoryBeforeAttribute);
  const org = kinds.map((k) => cell('org', k));
  const group = kinds.map((k) => cell('group', k));
  switch (name) {
    case 'AF':
    case 'AF-N':
      return [...org, ...group];
    case 'SF':
      return kinds.flatMap((k) => [cell('org', k), cell('group', k)]);
    case 'HY':
      // AF, except the organization's blanket rule comes after every group rule
      // but the group's own blanket — the last place I2 allows (fixes F1, F5).
      return [...org.slice(0, 5), ...group.slice(0, 5), cell('org', 'all'), cell('group', 'all')];
  }
}

/** A preset under either toggle. */
export function presetConfig(name: PresetName, categoryBeforeAttribute = true): PrecedenceConfig {
  return {
    cells: presetCells(name, categoryBeforeAttribute),
    categoryBeforeAttribute,
    depthMode: name === 'AF-N' ? 'nearest_organization_first' : 'within_cell',
  };
}

export const PRECEDENCE_PRESETS: Readonly<Record<PresetName, PrecedenceConfig>> = {
  AF: presetConfig('AF'),
  SF: presetConfig('SF'),
  HY: presetConfig('HY'),
  'AF-N': presetConfig('AF-N'),
};

/** The default, installed as version 1 (owner ruling N11). */
export const DEFAULT_PRECEDENCE: PrecedenceConfig = PRECEDENCE_PRESETS.HY;

/** The preset a configuration equals, if any. */
export function presetName(config: PrecedenceConfig): PresetName | null {
  for (const name of ['AF', 'SF', 'HY', 'AF-N'] as const) {
    const preset = presetConfig(name, config.categoryBeforeAttribute);
    if (
      preset.depthMode === config.depthMode &&
      preset.cells.length === config.cells.length &&
      preset.cells.every((c, i) => c === config.cells[i])
    ) {
      return name;
    }
  }
  return null;
}

/** I1–I5 (decision-record §5.6). Every issue found is reported, not only the first. */
export function validatePrecedence(config: PrecedenceConfig): PrecedenceValidation {
  const cells = config.cells;
  const known = new Set<string>(PRICE_BOOK_CELL_CODES);
  if (
    cells.length !== PRICE_BOOK_CELL_CODES.length ||
    new Set(cells).size !== cells.length ||
    cells.some((c) => !known.has(c))
  ) {
    return {
      valid: false,
      issues: [{ invariant: 'shape', message: 'The order must name each of the twelve buyer cells exactly once.' }],
    };
  }
  const issues: PrecedenceIssue[] = [];
  const expected = selectionOrder(config.categoryBeforeAttribute);
  const swapped = selectionOrder(!config.categoryBeforeAttribute);
  for (const audience of ['org', 'group'] as const) {
    const order = cells.filter((c) => c.startsWith(`${audience}.`)).map((c) => c.slice(audience.length + 1));
    if (order.every((k, i) => k === expected[i])) continue;
    if (order.every((k, i) => k === swapped[i])) {
      issues.push({
        invariant: 'I3',
        message: `The ${audience} cells order category and attribute against the category-before-attribute toggle.`,
      });
      continue;
    }
    issues.push({
      invariant: 'I1',
      message: `The ${audience} cells break the specificity order ${expected.join(' > ')}.`,
    });
  }
  for (const kind of expected) {
    const orgCell = cell('org', kind);
    const groupCell = cell('group', kind);
    if (cells.indexOf(groupCell) < cells.indexOf(orgCell)) {
      issues.push({
        invariant: 'I2',
        message: `${orgCell} must come before ${groupCell}: an organization is a member of its group.`,
        pair: [orgCell, groupCell],
      });
    }
  }
  if (config.depthMode === 'nearest_organization_first') {
    const af = presetCells('AF', config.categoryBeforeAttribute);
    if (!af.every((c, i) => c === cells[i])) {
      issues.push({
        invariant: 'I5',
        message: 'Nearest-organization-first depth is consistent only with the audience-first (AF) order.',
      });
    }
  }
  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

/** `cellRank`: each cell's position in the order — the first component of the order key. */
export function buildRankTable(config: PrecedenceConfig): ReadonlyMap<CellCode, number> {
  return new Map(config.cells.map((c, i) => [c, i]));
}

/** An active precedence version, as the resolver reads it. */
export interface ActivePrecedence {
  readonly version: number;
  readonly config: PrecedenceConfig;
}

/** What the store reads the active version through — `price_list_precedence`, one statement. */
export type ActivePrecedenceLoader = () => Promise<ActivePrecedence | null>;

/**
 * The active version, memoised per pricing generation: a precedence flip (P3)
 * bumps the generation after commit, so the memo and the price cache move at
 * the same instant (decision-record §5.6, step 5).
 *
 * A missing or invalid active row is refused rather than replaced by HY: the
 * migration installs version 1, and a database without it is one the resolver
 * must not price from silently.
 */
export class PrecedenceStore {
  #memo: { generation: number; value: ActivePrecedence } | null = null;

  constructor(
    private readonly load: ActivePrecedenceLoader,
    private readonly generation: () => number = () => 0,
  ) {}

  async active(): Promise<ActivePrecedence> {
    const generation = this.generation();
    if (this.#memo && this.#memo.generation === generation) return this.#memo.value;
    const value = await this.load();
    if (!value) {
      throw new Error('price_lists: no active precedence version — `price_list_precedence` has no active row.');
    }
    const validation = validatePrecedence(value.config);
    if (!validation.valid) {
      throw new Error(
        `price_lists: the active precedence version ${value.version} is invalid: ` +
          validation.issues.map((i) => i.message).join(' '),
      );
    }
    this.#memo = { generation, value };
    return value;
  }

  /** Drop the memo (the pricing generation's local layer calls this). */
  invalidateAll(): void {
    this.#memo = null;
  }
}

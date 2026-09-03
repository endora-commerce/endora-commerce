// Feature 096, T310 — B15, B16 and B17 of `contracts/block-definition.md` §6.
//
// **The invariant these assert was unasserted in both regimes while it changed
// hands**, which is why it was filed in `specs/deferred-defects.md` rather than
// left to a task. Before Phase 3 the newsletter palette inherited its sections
// by accident of a data structure: `filterConfigByContext` filtered a Puck
// config whose `categories` map was context-free, so Content / Order / Layout /
// Embeds came through untouched. After Phase 3 the sections are declared per
// `(key, context)` and that accident is gone — §4.1.1's admission is the only
// thing that replaces it.

import { describe, expect, it } from 'vitest';
import {
  buildPaletteCategories,
  type ServedPaletteBlock,
  type ServedPaletteSection,
} from './palette.js';

const EMAIL_SECTIONS: ServedPaletteSection[] = [
  { key: 'content', titleKey: 'content', contexts: ['email'], weight: 10, ownerModule: 'te' },
  { key: 'order', titleKey: 'order', contexts: ['email'], weight: 20, ownerModule: 'orders' },
  { key: 'layout', titleKey: 'layout', contexts: ['email'], weight: 30, ownerModule: 'te' },
  { key: 'embeds', titleKey: 'embeds', contexts: ['email'], weight: 40, ownerModule: 'te' },
];

const CMS_SECTIONS: ServedPaletteSection[] = [
  { key: 'layout', titleKey: 'cmsLayout', contexts: ['cms'], weight: 10, ownerModule: 'cms' },
  {
    key: 'internal',
    titleKey: 'cmsInternal',
    contexts: ['cms'],
    weight: 60,
    visible: false,
    ownerModule: 'cms',
  },
];

const INVOICE_SECTIONS: ServedPaletteSection[] = [
  { key: 'invoice', titleKey: 'invoice', contexts: ['invoice'], weight: 10, ownerModule: 'invoices' },
];

/** 28 e-mail blocks, none of which declares `newsletter`. */
const EMAIL_BLOCKS: ServedPaletteBlock[] = Array.from({ length: 28 }, (_, i) => ({
  name: `te.Email${String(i).padStart(2, '0')}`,
  ownerModule: 'te',
  category: (['content', 'order', 'layout', 'embeds'] as const)[i % 4]!,
  contexts: ['email'] as const,
  weight: i,
}));

const CMS_BLOCKS: ServedPaletteBlock[] = [
  { name: 'cms.Row', ownerModule: 'cms', category: 'layout', contexts: ['cms'], weight: 10 },
  { name: 'cms.Column', ownerModule: 'cms', category: 'internal', contexts: ['cms'], weight: 10 },
];

const INVOICE_BLOCKS: ServedPaletteBlock[] = [
  {
    name: 'invoices.InvoiceHeader',
    ownerModule: 'invoices',
    category: 'invoice',
    contexts: ['invoice'],
    weight: 10,
  },
];

const ALL_BLOCKS = [...EMAIL_BLOCKS, ...CMS_BLOCKS, ...INVOICE_BLOCKS];
const ALL_SECTIONS = [...EMAIL_SECTIONS, ...CMS_SECTIONS, ...INVOICE_SECTIONS];
const RENDERABLE = new Set(ALL_BLOCKS.map((b) => b.name));
const OPTIONS = { title: (s: ServedPaletteSection) => s.titleKey, renderable: RENDERABLE };

function membersOf(categories: NonNullable<ReturnType<typeof buildPaletteCategories>>): string[] {
  return Object.values(categories).flatMap((c) => c.components ?? []);
}

describe('the derived palette', () => {
  it('B15 — newsletter contains every block declared for email, and no block declares newsletter', () => {
    expect(ALL_BLOCKS.some((b) => (b.contexts ?? []).includes('newsletter'))).toBe(false);
    const newsletter = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'newsletter', OPTIONS);
    expect(membersOf(newsletter).sort()).toEqual(EMAIL_BLOCKS.map((b) => b.name).sort());
    expect(membersOf(newsletter)).toHaveLength(28);
  });

  it('B16 — the newsletter sections are the email sections, same titles, order and membership', () => {
    const email = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'email', OPTIONS);
    const newsletter = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'newsletter', OPTIONS);
    // Asserted separately from B15 because the two fail apart: a palette that
    // admits the blocks and not the sections renders 28 entries in Puck's
    // *Other* drawer.
    expect(Object.keys(newsletter)).toEqual(Object.keys(email));
    expect(Object.keys(newsletter)).toEqual(['content', 'order', 'layout', 'embeds']);
    expect(newsletter).toEqual(email);
  });

  it('B17 — cms, email and invoice each admit only their own', () => {
    const cms = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'cms', OPTIONS);
    expect(membersOf(cms).sort()).toEqual(CMS_BLOCKS.map((b) => b.name).sort());

    const email = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'email', OPTIONS);
    expect(membersOf(email).sort()).toEqual(EMAIL_BLOCKS.map((b) => b.name).sort());

    const invoice = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'invoice', OPTIONS);
    expect(membersOf(invoice)).toEqual(['invoices.InvoiceHeader']);
  });

  it('keeps the hidden drawer hidden and its members in it', () => {
    const cms = buildPaletteCategories(ALL_BLOCKS, ALL_SECTIONS, 'cms', OPTIONS);
    expect(cms['internal']?.visible).toBe(false);
    expect(cms['internal']?.components).toEqual(['cms.Column']);
    expect(cms['layout']?.visible).toBeUndefined();
  });

  it('does not render a declared section nothing populates', () => {
    const empty: ServedPaletteSection = {
      key: 'ghost',
      titleKey: 'ghost',
      contexts: ['cms'],
      weight: 1,
    };
    const cms = buildPaletteCategories(ALL_BLOCKS, [...ALL_SECTIONS, empty], 'cms', OPTIONS);
    expect(cms['ghost']).toBeUndefined();
  });

  it('leaves out a declared block this bundle has no renderer for', () => {
    const ghost: ServedPaletteBlock = {
      name: 'cms.Ghost',
      ownerModule: 'cms',
      category: 'layout',
      contexts: ['cms'],
      weight: 1,
    };
    const cms = buildPaletteCategories([...ALL_BLOCKS, ghost], ALL_SECTIONS, 'cms', OPTIONS);
    expect(cms['layout']?.components).toEqual(['cms.Row']);
  });

  it('orders sections and members by weight, absent last, ties by key and by name', () => {
    const sections: ServedPaletteSection[] = [
      { key: 'zulu', titleKey: 'z', contexts: ['cms'] },
      { key: 'alpha', titleKey: 'a', contexts: ['cms'] },
      { key: 'first', titleKey: 'f', contexts: ['cms'], weight: 1 },
    ];
    const blocks: ServedPaletteBlock[] = [
      { name: 'cms.B', ownerModule: 'cms', category: 'zulu', contexts: ['cms'] },
      { name: 'cms.A', ownerModule: 'cms', category: 'zulu', contexts: ['cms'] },
      { name: 'cms.C', ownerModule: 'cms', category: 'alpha', contexts: ['cms'] },
      { name: 'cms.D', ownerModule: 'cms', category: 'first', contexts: ['cms'], weight: 5 },
    ];
    const palette = buildPaletteCategories(blocks, sections, 'cms', {
      title: (s) => s.titleKey,
      renderable: new Set(blocks.map((b) => b.name)),
    });
    expect(Object.keys(palette)).toEqual(['first', 'alpha', 'zulu']);
    expect(palette['zulu']?.components).toEqual(['cms.A', 'cms.B']);
  });
});

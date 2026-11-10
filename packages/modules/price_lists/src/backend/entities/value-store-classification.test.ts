import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The composition's own array: an entity left out of it is a table the ORM
// cannot read, with no error anywhere.
import { entities } from '../index.js';

/**
 * Issue #470, Stage 1 (owner ruling O-3, 2026-11-10) — the two entities of the
 * `price_lists`-owned price-change history are registered and classified like
 * the book they record: `@RuleScoped()`.
 *
 * `@TransitivelyScoped('PriceList', …)` is not available, because a chain
 * ending at a rule-scoped parent is refused, so the store has no global filter
 * and is read only by the id of a book already loaded under the caller's
 * price-book scope. That makes a tenant key column on it a classification
 * that lies, so the source is also read for one.
 *
 * *Exactly one classification survived into the artefact the platform loads*
 * is `check-entity-tenant-classification`'s claim over the emitted output
 * (D-257), not this file's.
 */

/** This file sits in the directory it reads (`module-test-ownership.md` §3). */
const ENTITY_DIR = dirname(fileURLToPath(import.meta.url));

const STORE: ReadonlyArray<[className: string, fileName: string]> = [
  ['PriceListValueChange', 'price-list-value-change.entity.ts'],
  ['PriceListRowValueChange', 'price-list-row-value-change.entity.ts'],
];

const CLASSIFICATIONS = ['OrgScoped', 'CustomerScoped', 'GlobalEntity', 'TransitivelyScoped', 'RuleScoped'];

function decoratorsOf(source: string): string[] {
  return CLASSIFICATIONS.filter((name) => new RegExp(`@${name}\\(`).test(source));
}

describe('price_lists — price-change history entities (#470)', () => {
  it.each(STORE)('%s is in the package entities array', (className) => {
    expect(entities.map((entity) => entity.name)).toContain(className);
  });

  it.each(STORE)('%s carries exactly one classification, @RuleScoped(), as the book does', (_className, fileName) => {
    const source = readFileSync(join(ENTITY_DIR, fileName), 'utf8');
    const book = readFileSync(join(ENTITY_DIR, 'price-list.entity.ts'), 'utf8');
    expect(decoratorsOf(book)).toEqual(['RuleScoped']);
    expect(decoratorsOf(source)).toEqual(decoratorsOf(book));
  });

  it.each(STORE)('%s holds no tenant key column', (_className, fileName) => {
    const source = readFileSync(join(ENTITY_DIR, fileName), 'utf8');
    expect(source).not.toMatch(/\borganizationId\b|\borganization_id\b|\bcustomerAccountId\b/);
  });
});

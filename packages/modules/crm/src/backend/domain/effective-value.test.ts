import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { effectiveOpportunityValue, effectiveOpportunityValueSql } from './effective-value.js';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the effective value of an Opportunity', () => {
  it('is the manual figure in manual mode, and nothing when none was entered', () => {
    expect(effectiveOpportunityValue({ valueMode: 'manual', manualValue: '150.00', computedValue: '99.00' })).toBe(
      '150.00',
    );
    expect(effectiveOpportunityValue({ valueMode: 'manual', manualValue: null, computedValue: '99.00' })).toBeNull();
    expect(effectiveOpportunityValue({ valueMode: 'manual', computedValue: '99.00' })).toBeNull();
  });

  it('is the stored computed figure in computed mode, whatever was entered by hand', () => {
    expect(effectiveOpportunityValue({ valueMode: 'computed', manualValue: '150.00', computedValue: '99.00' })).toBe(
      '99.00',
    );
    // A computed Opportunity with nothing counting is worth zero, not nothing.
    expect(effectiveOpportunityValue({ valueMode: 'computed', manualValue: null, computedValue: '0.00' })).toBe(
      '0.00',
    );
  });

  it('is the same rule as one SQL expression over the given alias', () => {
    expect(effectiveOpportunityValueSql('o')).toBe(
      `case when o."value_mode" = 'manual' then o."manual_value" else o."computed_value" end`,
    );
    expect(effectiveOpportunityValueSql('c0')).toContain('c0."computed_value"');
    expect(effectiveOpportunityValueSql('c0')).not.toContain('o.');
  });

  it('refuses an alias that could end the identifier — the fragment is spliced into statements', () => {
    expect(() => effectiveOpportunityValueSql('o"; drop table x; --')).toThrow();
    expect(() => effectiveOpportunityValueSql('o o')).toThrow();
    expect(() => effectiveOpportunityValueSql('')).toThrow();
  });

  it('takes the placeholder the ORM hands a raw() callback — the list sorts through it', () => {
    expect(effectiveOpportunityValueSql('[::alias::]')).toContain('[::alias::]."value_mode"');
  });

  it('is stated once: no other file of the module spells the rule out again', () => {
    // The list's sort, the board's totals and every analytics figure read the
    // value through the fragment above. A second copy is how they would come
    // to disagree about a computed Opportunity.
    const restated = sources(BACKEND)
      .filter((path) => /"value_mode"\s*=|valueMode\s*===\s*'manual'\s*\?/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(BACKEND, path));
    expect(restated).toEqual(['domain/effective-value.ts']);
  });
});

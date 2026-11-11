import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineColumnExtension } from './define.js';
import { SchemaExtensionInvalidError, type SchemaExtensionRule } from './errors.js';
import { validateDeclarationContext } from './validate.js';
import type { ExtensibleHostSet } from './extensible-hosts.js';

/**
 * `specs/178-extensible-columns/contracts/column-extension-declaration.md` §3 —
 * one refusal per rule. V1, V3 – V8 and V12 are the shape rules
 * `defineColumnExtension` applies at import; V2 and V9 – V11 need the platform's
 * extensible host set and the declaring package, and are applied at discovery.
 */

function refusal(fn: () => unknown): SchemaExtensionInvalidError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaExtensionInvalidError);
    return error as SchemaExtensionInvalidError;
  }
  throw new Error('expected a SchemaExtensionInvalidError, nothing was thrown');
}

function define(decl: unknown): unknown {
  return defineColumnExtension(decl as Parameters<typeof defineColumnExtension>[0]);
}

const base = { host: 'organizations', module: 'acme_erp' } as const;

const shapeCases: ReadonlyArray<[SchemaExtensionRule, string, unknown]> = [
  ['module-id', 'upper-case module id', { ...base, module: 'AcmeErp', columns: { a: { type: 'text', nullable: true } } }],
  ['module-id', 'leading underscore', { ...base, module: '_acme', columns: { a: { type: 'text', nullable: true } } }],
  ['host-not-extensible', 'not a custom-field host table', { ...base, host: 'invoices', columns: { a: { type: 'text', nullable: true } } }],
  ['key', 'snake-case key', { ...base, columns: { erp_code: { type: 'text', nullable: true } } }],
  ['key', 'leading capital', { ...base, columns: { ErpCode: { type: 'text', nullable: true } } }],
  ['not-null-without-default', 'NOT NULL, no default', { ...base, columns: { tier: { type: 'smallint' } } }],
  ['not-null-without-default', 'timestamptz not nullable', { ...base, columns: { at: { type: 'timestamptz' } } }],
  ['not-null-without-default', 'jsonb not nullable', { ...base, columns: { meta: { type: 'jsonb', schema: z.object({}) } } }],
  ['default-type', 'a default on timestamptz', { ...base, columns: { at: { type: 'timestamptz', nullable: true, default: '2026-01-01' } } }],
  ['type', 'unknown type', { ...base, columns: { a: { type: 'money', nullable: true } } }],
  ['type-params', 'varchar length 0', { ...base, columns: { a: { type: 'varchar', length: 0, nullable: true } } }],
  ['type-params', 'varchar length 1025', { ...base, columns: { a: { type: 'varchar', length: 1025, nullable: true } } }],
  ['type-params', 'numeric precision 39', { ...base, columns: { a: { type: 'numeric', precision: 39, scale: 0, nullable: true } } }],
  ['type-params', 'numeric scale > precision', { ...base, columns: { a: { type: 'numeric', precision: 4, scale: 5, nullable: true } } }],
  ['type-params', 'jsonb without schema', { ...base, columns: { a: { type: 'jsonb', nullable: true } } }],
  ['default-type', 'string default on smallint', { ...base, columns: { a: { type: 'smallint', default: '0' } } }],
  ['default-type', 'out-of-range smallint default', { ...base, columns: { a: { type: 'smallint', default: 40000 } } }],
  ['default-type', 'number default on bigint', { ...base, columns: { a: { type: 'bigint', default: 0 } } }],
  ['default-type', 'too long varchar default', { ...base, columns: { a: { type: 'varchar', length: 2, default: 'abc' } } }],
  ['default-type', 'bad date default', { ...base, columns: { a: { type: 'date', default: 'today' } } }],
  ['index', 'unique on NOT NULL', { ...base, columns: { a: { type: 'text', default: '', index: 'unique' } } }],
  ['index', 'index on jsonb', { ...base, columns: { a: { type: 'jsonb', nullable: true, schema: z.object({}), index: true } } }],
  ['name-length', 'physical name over 63 bytes', { ...base, columns: { [`a${'b'.repeat(60)}`]: { type: 'text', nullable: true } } }],
  ['name-length', 'more than 32 columns', { ...base, columns: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`c${i}`, { type: 'text', nullable: true }])) }],
  ['not-offered-yet', 'filterable', { ...base, columns: { a: { type: 'text', nullable: true, filterable: true } } }],
  ['not-offered-yet', 'sortable', { ...base, columns: { a: { type: 'text', nullable: true, sortable: true } } }],
  ['not-offered-yet', 'references', { ...base, columns: { a: { type: 'uuid', nullable: true, references: 'organizations' } } }],
  ['not-offered-yet', 'indexes', { ...base, indexes: [['a', 'b']], columns: { a: { type: 'text', nullable: true } } }],
  ['not-offered-yet', 'expression default', { ...base, columns: { a: { type: 'text', default: { sql: 'now()' } } } }],
];

describe('shape rules, applied by defineColumnExtension', () => {
  for (const [rule, label, decl] of shapeCases) {
    it(`${rule}: ${label}`, () => {
      const error = refusal(() => define(decl));
      expect(error.rule).toBe(rule);
      expect(error.code).toBe('schema_extension_invalid');
      expect(error.message).toContain(String((decl as { module: string }).module));
    });
  }

  it('names the module, the key and the rule (US1 scenario 2)', () => {
    const error = refusal(() => define({ ...base, columns: { creditTier: { type: 'smallint' } } }));
    expect(error.moduleId).toBe('acme_erp');
    expect(error.key).toBe('creditTier');
    expect(error.message).toContain('creditTier');
    expect(error.message).toContain('not-null-without-default');
  });

  it('accepts the worked example', () => {
    expect(() =>
      define({
        ...base,
        adminReads: true,
        columns: {
          erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
          creditTier: { type: 'smallint', default: 0 },
          onboardedVia: { type: 'text', nullable: true },
        },
      }),
    ).not.toThrow();
  });
});

describe('context rules, applied at discovery', () => {
  const hosts: ExtensibleHostSet = new Map([
    ['organizations', { table: 'organizations', ownerModuleId: 'organizations' }],
  ]);
  const decl = defineColumnExtension({
    ...base,
    columns: { note: { type: 'text', nullable: true } },
  });
  const context = {
    hosts,
    packageModuleId: 'acme_erp',
    dependencyClosure: new Set(['organizations']),
  };

  it('accepts a declaration on a rolled-out host its module depends on', () => {
    expect(() => validateDeclarationContext([decl], context)).not.toThrow();
  });

  it('V2 host-not-extensible, listing the extensible hosts (US1 scenario 3)', () => {
    const error = refusal(() =>
      validateDeclarationContext([decl], { ...context, hosts: new Map() }),
    );
    expect(error.rule).toBe('host-not-extensible');
    expect(error.message).toContain('extensible hosts: (none)');
  });

  it('V9 module-mismatch', () => {
    const error = refusal(() =>
      validateDeclarationContext([decl], { ...context, packageModuleId: 'other' }),
    );
    expect(error.rule).toBe('module-mismatch');
  });

  it('V10 host-not-a-dependency (US1 scenario 4)', () => {
    const error = refusal(() =>
      validateDeclarationContext([decl], { ...context, dependencyClosure: new Set() }),
    );
    expect(error.rule).toBe('host-not-a-dependency');
  });

  it('V11 duplicate-declaration', () => {
    const twin = defineColumnExtension({ ...base, columns: { other: { type: 'text', nullable: true } } });
    const error = refusal(() => validateDeclarationContext([decl, twin], context));
    expect(error.rule).toBe('duplicate-declaration');
  });

  it('refuses a value that is not a branded declaration', () => {
    const error = refusal(() =>
      validateDeclarationContext([{ ...decl } as never], context),
    );
    expect(error.rule).toBe('not-a-declaration');
  });
});

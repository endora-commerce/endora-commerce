import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SCOPED_WRITE_CASES, SCOPED_WRITE_CASE_FIELDS, type ScopedWriteCase } from './scoped-write-encoding.cases.js';
import {
  EMPTY_TOKEN,
  INHERIT_TOKEN,
  decodeCsvScopedCell,
  encodeCsvScopedCell,
  scopedWrite,
  toScopedWriteOp,
  validateScopedWrite,
  type CsvCell,
  type ScopedWriteOp,
} from './scoped-write-encoding.js';

/**
 * Feature 168 — the one write encoding of scoped product values (`contracts/write-encoding.md`,
 * FR-110…FR-113, FR-118, SC-014). Runs the shared case table purely, plus the codec's own
 * properties.
 */

function decodeJson(c: ScopedWriteCase): ScopedWriteOp<unknown> | undefined {
  const schema = z.object({ v: scopedWrite(z.unknown().refine((x) => x !== null)) }).strict();
  const body = 'json' in c ? { v: c.json } : {};
  return toScopedWriteOp(schema.parse(body).v);
}

function decodeCsv(c: ScopedWriteCase): ScopedWriteOp<unknown> | undefined {
  const cell = decodeCsvScopedCell(c.csv!, { column: SCOPED_WRITE_CASE_FIELDS[c.field].column });
  if (cell.kind === 'no_change') return undefined;
  if (cell.kind === 'text') return { op: 'set', value: cell.text };
  return { op: cell.kind };
}

describe('SCOPED_WRITE_CASES (shared table)', () => {
  it('covers JSON and CSV inputs, every refusal and the formula guard', () => {
    expect(SCOPED_WRITE_CASES.some((c) => 'csv' in c)).toBe(true);
    expect(SCOPED_WRITE_CASES.some((c) => 'json' in c)).toBe(true);
    for (const refusal of ['required_empty', 'not_emptyable', 'inherit_at_global'] as const) {
      expect(SCOPED_WRITE_CASES.some((c) => c.expect === refusal)).toBe(true);
    }
    expect(SCOPED_WRITE_CASES.filter((c) => c.csv?.startsWith("'")).length).toBeGreaterThanOrEqual(4);
  });

  for (const c of SCOPED_WRITE_CASES) {
    it(c.name, () => {
      const op = c.csv !== undefined ? decodeCsv(c) : decodeJson(c);
      if (op === undefined) {
        expect(c.expect).toBe('no_change');
        return;
      }
      const refusal = validateScopedWrite(SCOPED_WRITE_CASE_FIELDS[c.field], op, c.level);
      if (typeof c.expect === 'string') {
        expect(refusal).toBe(c.expect);
      } else {
        expect(refusal).toBeNull();
        expect(op).toEqual(c.expect);
      }
    });
  }
});

describe('scopedWrite (JSON)', () => {
  const body = z.object({ name: scopedWrite(z.string().min(1).max(10)) }).strict();

  it('decodes absent, "", null, {inherit:true} and a value', () => {
    expect(toScopedWriteOp(body.parse({}).name)).toBeUndefined();
    expect(toScopedWriteOp(body.parse({ name: '' }).name)).toBeUndefined();
    expect(toScopedWriteOp(body.parse({ name: null }).name)).toEqual({ op: 'empty' });
    expect(toScopedWriteOp(body.parse({ name: { inherit: true } }).name)).toEqual({ op: 'inherit' });
    expect(toScopedWriteOp(body.parse({ name: 'Drill' }).name)).toEqual({ op: 'set', value: 'Drill' });
  });

  it('refuses {inherit:false}, extra keys beside inherit and a value outside the value schema', () => {
    expect(body.safeParse({ name: { inherit: false } }).success).toBe(false);
    expect(body.safeParse({ name: { inherit: true, x: 1 } }).success).toBe(false);
    expect(body.safeParse({ name: 'x'.repeat(11) }).success).toBe(false);
    expect(body.safeParse({ name: 5 }).success).toBe(false);
  });

  it('a numeric field: null and a number', () => {
    const moq = z.object({ moq: scopedWrite(z.number().int().min(1)) });
    expect(toScopedWriteOp(moq.parse({ moq: null }).moq)).toEqual({ op: 'empty' });
    expect(toScopedWriteOp(moq.parse({ moq: 3 }).moq)).toEqual({ op: 'set', value: 3 });
  });
});

describe('CSV codec', () => {
  it('names its tokens', () => {
    expect(EMPTY_TOKEN).toBe('NULL');
    expect(INHERIT_TOKEN).toBe('INHERIT');
  });

  it('encodes empty, inherit and token-shaped text', () => {
    expect(encodeCsvScopedCell({ kind: 'empty' })).toBe('NULL');
    expect(encodeCsvScopedCell({ kind: 'inherit' })).toBe('INHERIT');
    expect(encodeCsvScopedCell({ kind: 'text', text: 'NULL' })).toBe('\\NULL');
    expect(encodeCsvScopedCell({ kind: 'text', text: '\\INHERIT' })).toBe('\\\\INHERIT');
    expect(encodeCsvScopedCell({ kind: 'text', text: 'plain' })).toBe('plain');
  });

  it('guards formulas on text columns (§3a)', () => {
    expect(encodeCsvScopedCell({ kind: 'text', text: '=1+1' })).toBe("'=1+1");
    expect(encodeCsvScopedCell({ kind: 'text', text: "'quoted" })).toBe("''quoted");
    expect(encodeCsvScopedCell({ kind: 'text', text: '-5' })).toBe("'-5");
    for (const lead of ['+', '@', '\t', '\r']) {
      expect(encodeCsvScopedCell({ kind: 'text', text: `${lead}x` })).toBe(`'${lead}x`);
    }
  });

  it('leaves value columns unguarded both ways', () => {
    expect(encodeCsvScopedCell({ kind: 'text', text: '-5' }, { column: 'value' })).toBe('-5');
    expect(decodeCsvScopedCell("'5", { column: 'value' })).toEqual({ kind: 'text', text: "'5" });
  });

  it('defaults to the text-column rule', () => {
    expect(decodeCsvScopedCell("'=SUM(A1)")).toEqual({ kind: 'text', text: '=SUM(A1)' });
  });

  it('refuses to encode an empty text (empty means no change)', () => {
    expect(() => encodeCsvScopedCell({ kind: 'text', text: '' })).toThrow();
  });

  it('round-trips every text: decode(encode(x)) = x (property, text and value columns)', () => {
    const alphabet = ['N', 'U', 'L', 'I', 'H', 'E', 'R', 'T', '\\', "'", '=', '+', '-', '@', '\t', '\r', ' ', 'a', 'ż', '"', ','];
    const fixed = ['NULL', 'INHERIT', '\\NULL', '\\\\INHERIT', "'NULL", "''", "'", '=', '-5', '\\', 'NULL ', ' INHERIT'];
    let seed = 168;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const samples = [...fixed];
    for (let i = 0; i < 2000; i += 1) {
      const length = 1 + (next() % 9);
      let text = '';
      for (let j = 0; j < length; j += 1) text += alphabet[next() % alphabet.length];
      samples.push(text);
    }
    for (const text of samples) {
      for (const column of ['text', 'value'] as const) {
        const encoded = encodeCsvScopedCell({ kind: 'text', text }, { column });
        const decoded: CsvCell = decodeCsvScopedCell(encoded, { column });
        expect(decoded, `${column}: ${JSON.stringify(text)} → ${JSON.stringify(encoded)}`).toEqual({ kind: 'text', text });
      }
    }
  });
});

describe('validateScopedWrite', () => {
  const name = { required: true, emptyable: false };
  const status = { required: false, emptyable: false };
  const description = { required: false, emptyable: true };

  it('accepts a set anywhere and inherit below Global', () => {
    expect(validateScopedWrite(name, { op: 'set', value: 'x' }, 'G')).toBeNull();
    expect(validateScopedWrite(description, { op: 'inherit' }, 'C')).toBeNull();
    expect(validateScopedWrite(description, { op: 'inherit' }, 'CL')).toBeNull();
  });

  it('refuses inherit at Global for every field', () => {
    for (const field of [name, status, description]) {
      expect(validateScopedWrite(field, { op: 'inherit' }, 'G')).toBe('inherit_at_global');
    }
  });

  it('refuses empty on a required field before the emptyable check', () => {
    expect(validateScopedWrite(name, { op: 'empty' }, 'CL')).toBe('required_empty');
    expect(validateScopedWrite(status, { op: 'empty' }, 'C')).toBe('not_emptyable');
    expect(validateScopedWrite(description, { op: 'empty' }, 'G')).toBeNull();
  });
});

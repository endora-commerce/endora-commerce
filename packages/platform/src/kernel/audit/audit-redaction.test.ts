import { describe, expect, it } from 'vitest';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import { redactAuditState } from './audit-redaction.js';

/**
 * Issue #844 — the shape-based allowlist an anonymised subject's audit
 * snapshots are rewritten with.
 *
 * Keys are always kept, so a diff still shows *which* fields changed; a value is
 * kept only when a rule keeps it, and everything else becomes the marker. The
 * cases below walk the rules R0–R11 of the design in order, then pin the three
 * properties a later edit must not lose: fail closed, idempotent, and
 * structure-preserving.
 */

const ERASED = AUDIT_ERASED_MARKER;
const ORG_ID = '0b9f6c1e-2f43-4c7a-9a55-0e7f1d2c3b4a';
const OTHER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NO_KEYS = { keepKeys: [] as readonly string[] };

function redact(value: Record<string, unknown> | null, keepKeys: readonly string[] = []): unknown {
  return redactAuditState(value, { keepKeys });
}

describe('redactAuditState — the rules', () => {
  it('uses the literal marker the admin viewer translates', () => {
    expect(ERASED).toBe('[erased]');
  });

  it('R0: erases every custom-field value, booleans and numbers included, and keeps the keys', () => {
    expect(redact({ customFieldValues: { vip: true, note: 'x', n: 3, empty: null } })).toEqual({
      customFieldValues: { vip: ERASED, note: ERASED, n: ERASED, empty: ERASED },
    });
    // At any depth, and a non-map value under the key is erased whole.
    expect(redact({ nested: { customFieldValues: { tier: 'gold' } } })).toEqual({
      nested: { customFieldValues: { tier: ERASED } },
    });
    expect(redact({ customFieldValues: 'opaque' })).toEqual({ customFieldValues: ERASED });
    expect(redact({ customFieldValues: null })).toEqual({ customFieldValues: null });
  });

  it('R1–R3: keeps null, the marker and booleans', () => {
    expect(redact({ blockReason: null, legalName: ERASED, hadBlockReason: true, isDefault: false })).toEqual({
      blockReason: null,
      legalName: ERASED,
      hadBlockReason: true,
      isDefault: false,
    });
  });

  it('R4: keeps a UUID-shaped id and erases an id of any other shape', () => {
    expect(redact({ id: ORG_ID, organizationId: ORG_ID, taxId: 'PL1234567890', externalId: 'C-77' })).toEqual({
      id: ORG_ID,
      organizationId: ORG_ID,
      taxId: ERASED,
      externalId: ERASED,
    });
  });

  it('R5: keeps a list of ids only when every element is UUID-shaped', () => {
    expect(redact({ warehouseIds: [ORG_ID, OTHER_ID] })).toEqual({ warehouseIds: [ORG_ID, OTHER_ID] });
    expect(redact({ warehouseIds: [ORG_ID, 'not-an-id'] })).toEqual({ warehouseIds: [ERASED, ERASED] });
    expect(redact({ warehouseIds: [] })).toEqual({ warehouseIds: [] });
  });

  it('R6: keeps a parsable ISO-8601 date-time under an *At key, and erases anything else there', () => {
    expect(redact({ blockedAt: '2026-11-07T10:15:30.000Z', approvedAt: '2026-11-07T10:15:30+01:00' })).toEqual({
      blockedAt: '2026-11-07T10:15:30.000Z',
      approvedAt: '2026-11-07T10:15:30+01:00',
    });
    expect(redact({ blockedAt: 'yesterday', rejectedAt: '2026-13-45T99:00:00Z' })).toEqual({
      blockedAt: ERASED,
      rejectedAt: ERASED,
    });
    // A date-time under a key that is not an *At key is not a timestamp rule.
    expect(redact({ note: '2026-11-07T10:15:30.000Z' })).toEqual({ note: ERASED });
  });

  it('R7: keeps a code under a global code key, and erases free text there', () => {
    expect(redact({ status: 'blocked', kind: 'delivery', type: 'b2c', source: 'storefront', action: 'x.y', version: 3, statusCode: 409 })).toEqual({
      status: 'blocked',
      kind: 'delivery',
      type: 'b2c',
      source: 'storefront',
      action: 'x.y',
      version: 3,
      statusCode: 409,
    });
    expect(redact({ status: 'Blocked by ops after a phone call' })).toEqual({ status: ERASED });
    expect(redact({ status: 'x'.repeat(65) })).toEqual({ status: ERASED });
    expect(redact({ version: Number.NaN })).toEqual({ version: ERASED });
  });

  it('R7: keeps a code under one of the caller\'s keep keys, and only there', () => {
    expect(redact({ blockSource: 'org_owner', lineCount: 2 }, ['blockSource'])).toEqual({
      blockSource: 'org_owner',
      lineCount: ERASED,
    });
    expect(redact({ blockSource: 'org_owner' })).toEqual({ blockSource: ERASED });
    expect(redact({ lineCount: 2 }, ['lineCount'])).toEqual({ lineCount: 2 });
    expect(redact({ blockSource: 'typed by an operator' }, ['blockSource'])).toEqual({ blockSource: ERASED });
  });

  it('R8: keeps a list of key tokens under a *Keys key', () => {
    expect(redact({ customFieldKeys: ['vip', 'tier_2'] })).toEqual({ customFieldKeys: ['vip', 'tier_2'] });
    expect(redact({ customFieldKeys: ['vip', 'a sentence'] })).toEqual({ customFieldKeys: [ERASED, ERASED] });
  });

  it('R9–R10: recurses into objects and arrays, keeping keys and structure', () => {
    expect(
      redact({
        role: { id: ORG_ID, name: 'Purchaser', kind: 'custom' },
        lines: [{ productId: ORG_ID, note: 'leave at the door' }],
      }),
    ).toEqual({
      role: { id: ORG_ID, name: ERASED, kind: 'custom' },
      lines: [{ productId: ORG_ID, note: ERASED }],
    });
  });

  it('R11: erases personal values and everything not otherwise kept', () => {
    expect(
      redact({
        email: 'jan@example.com',
        firstName: 'Jan',
        lastName: 'Kowalski',
        legalName: 'Jan Kowalski JDG',
        blockReason: 'Chargeback',
        phone: '+48 600 000 000',
        street: 'Marszałkowska 1',
        orderConfirmationEmails: ['a@b.c'],
        affected: 3,
      }),
    ).toEqual({
      email: ERASED,
      firstName: ERASED,
      lastName: ERASED,
      legalName: ERASED,
      blockReason: ERASED,
      phone: ERASED,
      street: ERASED,
      orderConfirmationEmails: [ERASED],
      affected: ERASED,
    });
  });

  it('answers null for a null snapshot', () => {
    expect(redactAuditState(null, NO_KEYS)).toBeNull();
  });

  it('leaves the anonymisation rows the scrub owners write byte-identical', () => {
    // `customer_account.anonymized`, `organization.anonymized`, `address.anonymized`:
    // timestamps, key lists, ids and codes only, so redacting after them loses nothing.
    const rows = [
      { anonymizedAt: null, customFieldKeys: ['vip'] },
      { anonymizedAt: '2026-11-07T10:15:30.000Z' },
      { organizationId: ORG_ID, kind: 'billing' },
    ];
    for (const row of rows) expect(redact(row)).toEqual(row);
  });

  it('does not touch the input', () => {
    const input = { email: 'jan@example.com', nested: { name: 'x' } };
    const copy = structuredClone(input);
    redact(input);
    expect(input).toEqual(copy);
  });
});

describe('redactAuditState — properties', () => {
  /** A small seeded generator, so a failure names a reproducible case. */
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  const KEYS = [
    'id', 'organizationId', 'warehouseIds', 'blockedAt', 'status', 'version', 'kind', 'customFieldValues',
    'customFieldKeys', 'email', 'name', 'blockSource', 'lines', 'note', 'count',
  ];
  const LEAVES: unknown[] = [
    null, true, false, 0, 7, -1.5, '', 'x', 'blocked', 'Some free text', ORG_ID, 'PL123',
    '2026-11-07T10:15:30.000Z', 'yesterday', ERASED, '[erased] by hand',
  ];
  function value(next: () => number, depth: number): unknown {
    const pick = next();
    if (depth > 3 || pick < 0.5) return LEAVES[Math.floor(next() * LEAVES.length)];
    if (pick < 0.75) {
      return Array.from({ length: Math.floor(next() * 4) }, () => value(next, depth + 1));
    }
    return object(next, depth + 1);
  }
  function object(next: () => number, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const n = Math.floor(next() * 5);
    for (let i = 0; i < n; i += 1) out[KEYS[Math.floor(next() * KEYS.length)]!] = value(next, depth);
    return out;
  }

  it('is idempotent: f(f(x)) = f(x)', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const input = object(rng(seed), 0);
      const once = redactAuditState(input, { keepKeys: ['blockSource'] });
      const twice = redactAuditState(once as Record<string, unknown>, { keepKeys: ['blockSource'] });
      expect(twice, `seed ${seed}`).toEqual(once);
    }
  });

  it('preserves structure: every key of the input is a key of the output', () => {
    const keysOf = (v: unknown, path = ''): string[] => {
      if (Array.isArray(v)) return v.flatMap((e, i) => keysOf(e, `${path}[${i}]`));
      if (v !== null && typeof v === 'object') {
        return Object.entries(v).flatMap(([k, e]) => [`${path}.${k}`, ...keysOf(e, `${path}.${k}`)]);
      }
      return [];
    };
    for (let seed = 1; seed <= 200; seed += 1) {
      const input = object(rng(seed), 0);
      const out = redactAuditState(input, NO_KEYS);
      // A custom-field map's values are erased whole, so its nested keys go;
      // every key above it, and every key elsewhere, stays.
      const expected = keysOf(input).filter((k) => !/customFieldValues(\[|\.[^.]+[.[])/.test(k));
      expect(keysOf(out), `seed ${seed}`).toEqual(expect.arrayContaining(expected));
    }
  });

  it('fails closed: no free-text leaf of the input survives, under any key', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const out = JSON.stringify(redactAuditState(object(rng(seed), 0), NO_KEYS));
      expect(out, `seed ${seed}`).not.toContain('Some free text');
      expect(out, `seed ${seed}`).not.toContain('[erased] by hand');
    }
  });
});

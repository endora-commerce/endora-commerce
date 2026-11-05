import { describe, expect, it, vi } from 'vitest';
import type { ProductGlobalScopeFields, ScopeChannel, ScopeSnapshot } from '@endora-commerce/contracts';
import {
  ScopeCompletenessGate,
  checkCompleteness,
  composeCompletenessGate,
  completenessFailures,
  completenessOutcome,
  type CompletenessFacts,
} from './scope-completeness.js';

/**
 * Feature 163, Phase 11 (T077, US6, FR-060, FR-061, FR-041) — what the completeness
 * gate reports missing at a (channel, language), and which pairs a status write asks
 * it about. The database half is `backend/test/contract/catalog/scope-completeness-gate.test.ts` [PG].
 */

const B2C = '11111111-2222-4333-8444-555555555555';
const B2B = '21111111-2222-4333-8444-555555555555';
const P = '31111111-2222-4333-8444-555555555555';

function facts(over: Partial<CompletenessFacts> = {}): CompletenessFacts {
  return {
    name: 'Wiertarka',
    slug: 'wiertarka',
    attributeValues: {},
    requiredAttributes: [],
    attributeLevels: new Map(),
    valueOverrides: [],
    urlKeys: [],
    ...over,
  };
}

// Feature 174 (T033; R16, FR-095, FR-096): complete at (C, L) along C×L → C → G — a Global
// value satisfies every (C, L); an empty override at C×L or C does not.
describe('checkCompleteness', () => {
  it('a Global name satisfies every (C, L) (FR-096)', () => {
    expect(checkCompleteness(facts(), B2C, 'pl-PL')).toEqual([]);
    expect(checkCompleteness(facts(), B2C, 'de-DE')).toEqual([]);
  });

  it('an empty or blank Global name does not', () => {
    expect(checkCompleteness(facts({ name: '' }), B2C, 'de-DE')).toEqual(['name']);
    expect(checkCompleteness(facts({ name: '   ' }), B2C, 'de-DE')).toEqual(['name']);
  });

  it('a C×L or C name counts at that channel only', () => {
    const cl = facts({ name: '', valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: 'de-DE', value: { v: 'Bohrer' } }] });
    expect(checkCompleteness(cl, B2C, 'de-DE')).toEqual([]);
    expect(checkCompleteness(cl, B2B, 'de-DE')).toEqual(['name']);
    expect(checkCompleteness(cl, B2C, 'en-US')).toEqual(['name']);
    const c = facts({ name: '', valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: null, value: { v: 'Bohrer' } }] });
    expect(checkCompleteness(c, B2C, 'de-DE')).toEqual([]);
    expect(checkCompleteness(c, B2B, 'de-DE')).toEqual(['name']);
  });

  it('an empty override at C×L stops the fallback to a Global value (FR-013)', () => {
    const f = facts({ valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: 'de-DE', value: { v: null } }] });
    expect(checkCompleteness(f, B2C, 'de-DE')).toEqual(['name']);
    expect(checkCompleteness(f, B2C, 'pl-PL')).toEqual([]);
  });

  describe('URL key', () => {
    it('the Global key satisfies it everywhere', () => {
      expect(checkCompleteness(facts(), B2C, 'de-DE')).toEqual([]);
    });

    it('without a Global key, a C×L or a C key of that channel satisfies it', () => {
      const none = facts({ slug: '' });
      expect(checkCompleteness(none, B2C, 'de-DE')).toEqual(['urlKey']);
      const clKey = { ...none, urlKeys: [{ languageCode: 'de-DE', salesChannelId: B2C }] };
      expect(checkCompleteness(clKey, B2C, 'de-DE')).toEqual([]);
      expect(checkCompleteness(clKey, B2B, 'de-DE')).toEqual(['urlKey']);
      const cKey = { ...none, urlKeys: [{ languageCode: null, salesChannelId: B2C }] };
      expect(checkCompleteness(cKey, B2C, 'pl-PL')).toEqual([]);
    });
  });

  describe('required attributes', () => {
    const levels = new Map([
      ['material', ['G', 'C', 'CL'] as const],
      ['grade', ['G', 'C'] as const],
    ]);

    it('a Global value satisfies; a C×L or C override fills a missing one at that scope', () => {
      const base = facts({ requiredAttributes: ['material'], attributeLevels: levels });
      expect(checkCompleteness(base, B2C, 'de-DE')).toEqual(['attribute:material']);
      expect(checkCompleteness({ ...base, attributeValues: { material: 'stal' } }, B2C, 'de-DE')).toEqual([]);
      const overridden = {
        ...base,
        valueOverrides: [{ attributeKey: 'material', channelId: B2C, languageCode: 'de-DE', value: { v: 'Stahl' } }],
      };
      expect(checkCompleteness(overridden, B2C, 'de-DE')).toEqual([]);
      expect(checkCompleteness(overridden, B2C, 'pl-PL')).toEqual(['attribute:material']);
    });

    it('ignores a C×L row a {G,C} attribute does not read (an orphan)', () => {
      const f = facts({
        requiredAttributes: ['grade'],
        attributeLevels: levels,
        valueOverrides: [{ attributeKey: 'grade', channelId: B2C, languageCode: 'de-DE', value: { v: 'A' } }],
      });
      expect(checkCompleteness(f, B2C, 'de-DE')).toEqual(['attribute:grade']);
    });

    it('names every missing value, name first, then the URL key, then attributes by key', () => {
      const f = facts({ name: '', slug: '', requiredAttributes: ['material', 'grade'], attributeLevels: levels });
      expect(checkCompleteness(f, B2C, 'de-DE')).toEqual(['name', 'urlKey', 'attribute:grade', 'attribute:material']);
    });
  });
});

describe('completenessFailures — the gate over pairsTurningOn (M3 → A)', () => {
  const b2c: ScopeChannel = { id: B2C, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
  const b2b: ScopeChannel = { id: B2B, languages: ['pl-PL'], defaultLanguage: 'pl-PL' };
  const global = (over: Partial<ProductGlobalScopeFields> = {}): ProductGlobalScopeFields => ({
    status: 'inactive',
    deletedAt: null,
    archivedAt: null,
    window: { from: null, until: null },
    visibility: 'public',
    allowedOrganizationIds: [],
    minOrderQuantity: null,
    returnable: true,
    ...over,
  });
  const snap = (over: Partial<ScopeSnapshot> = {}): ScopeSnapshot => ({
    global: global(),
    channelRows: [],
    languageRows: [],
    ...over,
  });
  // Feature 174: a Global name satisfies every pair, so "lacks German" is an empty override there.
  const lacksGerman = facts({
    valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: 'de-DE', value: { v: null } }],
  });

  it('a global switch on fails only the pair lacking its name, naming it (US6 #3)', () => {
    const failures = completenessFailures(snap(), snap({ global: global({ status: 'active' }) }), [b2c, b2b], lacksGerman);
    expect(failures).toEqual([{ channelId: B2C, languageCode: 'de-DE', missing: ['name'] }]);
  });

  it('a complete product fails nothing (US6 #2)', () => {
    const complete = facts({ name: 'Wiertarka' });
    expect(completenessFailures(snap(), snap({ global: global({ status: 'active' }) }), [b2c, b2b], complete)).toEqual([]);
  });

  it('a C × L row turning on checks that pair alone', () => {
    const after = snap({ languageRows: [{ productId: P, channelId: B2C, languageCode: 'de-DE', status: 'active' }] });
    expect(completenessFailures(snap(), after, [b2c, b2b], lacksGerman)).toEqual([
      { channelId: B2C, languageCode: 'de-DE', missing: ['name'] },
    ]);
  });

  describe('M3 → A non-triggers on a product lacking name[de]', () => {
    const on = global({ status: 'active' });

    it('a window-only change, even one opening the window now, checks nothing', () => {
      const before = snap({ global: { ...on, window: { from: new Date(Date.now() + 86_400_000), until: null } } });
      const after = snap({ global: { ...on, window: { from: null, until: null } } });
      expect(completenessFailures(before, after, [b2c], lacksGerman)).toEqual([]);
    });

    it('an audience-only change checks nothing (US6 #6)', () => {
      const before = snap({ global: { ...on, visibility: 'organization_restricted', allowedOrganizationIds: [] } });
      const after = snap({ global: on });
      expect(completenessFailures(before, after, [b2c], lacksGerman)).toEqual([]);
    });

    it('Restore — archivedAt alone moving — checks nothing (FR-019)', () => {
      const before = snap({ global: { ...on, archivedAt: new Date() } });
      expect(completenessFailures(before, snap({ global: on }), [b2c], lacksGerman)).toEqual([]);
    });
  });

  it('an archived product set active fires the gate although it stays archived (FR-060)', () => {
    const archivedAt = new Date();
    const before = snap({ global: global({ archivedAt }) });
    const after = snap({ global: global({ status: 'active', archivedAt }) });
    expect(completenessFailures(before, after, [b2c], lacksGerman)).toEqual([
      { channelId: B2C, languageCode: 'de-DE', missing: ['name'] },
    ]);
  });
});

describe('completenessOutcome — the mode decides (FR-060, N3)', () => {
  const failures = [
    { channelId: B2C, languageCode: 'de-DE', missing: ['name' as const] },
    { channelId: B2B, languageCode: 'de-DE', missing: ['name' as const, 'urlKey' as const] },
  ];

  it('warn saves and carries one completeness warning per failing pair', () => {
    expect(completenessOutcome('warn', failures)).toEqual([
      { kind: 'completeness', channelId: B2C, languageCode: 'de-DE', missing: ['name'] },
      { kind: 'completeness', channelId: B2B, languageCode: 'de-DE', missing: ['name', 'urlKey'] },
    ]);
  });

  it('refuse refuses the whole write with 422 SCOPE_INCOMPLETE naming every pair', () => {
    try {
      completenessOutcome('refuse', failures);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 422, code: 'SCOPE_INCOMPLETE', details: { pairs: failures } });
    }
  });

  it('no failure is no warning and no refusal in either mode', () => {
    expect(completenessOutcome('warn', [])).toEqual([]);
    expect(completenessOutcome('refuse', [])).toEqual([]);
  });
});

describe('composeCompletenessGate — never silently off (checkpoint C security review, I7)', () => {
  const deps = {
    membership: { listChannelsForEntity: async () => [] },
    attributeRead: { listAll: async () => [] },
    settings: { get: async () => 'warn' as never },
  };

  it('composes the gate when every collaborator is wired, and logs nothing', () => {
    const log = { warn: vi.fn() };
    expect(composeCompletenessGate(deps, log)).toBeInstanceOf(ScopeCompletenessGate);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each(['membership', 'attributeRead', 'settings'] as const)(
    'without %s it answers undefined and warns once, naming what is missing',
    (missing) => {
      const log = { warn: vi.fn() };
      expect(composeCompletenessGate({ ...deps, [missing]: undefined }, log)).toBeUndefined();
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.warn.mock.calls[0])).toContain(missing);
    },
  );
});

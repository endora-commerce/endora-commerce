import { describe, it, expect } from 'vitest';
import { analyzeSource } from '../../../scripts/check-channel-resolution.js';

/**
 * Self-test for the FR-011 channel-resolution CI check (feature 053).
 * Pure static analysis — no DB. Guards the guard: the detectors must flag the
 * two forbidden signals and must NOT flag legitimate property reads.
 */
describe('check-channel-resolution / analyzeSource', () => {
  const SURFACE = 'modules/catalog/routes.public.ts';
  const NON_SURFACE = 'modules/catalog/services/some-other.service.ts';
  const RESOLVER = 'modules/sales_channels/services/sales-channels.service.ts';
  const KERNEL_RESOLVER = 'kernel/sales-channels/sales-channel-resolver.middleware.ts';

  it('flags a raw x-sales-channel header read (global scope)', () => {
    const v = analyzeSource(
      `const code = request.headers['x-sales-channel'];`,
      NON_SURFACE,
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('raw-channel-header');
  });

  it('flags the x-sales-channel-id UUID alias header read', () => {
    const v = analyzeSource(`const id = headers['x-sales-channel-id'];`, SURFACE);
    expect(v.some((x) => x.kind === 'raw-channel-header')).toBe(true);
  });

  it('flags findOne(SalesChannel, …) re-resolution inside a storefront surface', () => {
    const v = analyzeSource(
      `const ch = await em.findOne(SalesChannel, { code });`,
      SURFACE,
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('request-channel-reresolution');
  });

  it('flags a raw `from sales_channels` SQL string inside a storefront surface', () => {
    const v = analyzeSource(
      "const rows = await conn.execute(`select id from sales_channels where code = ? and active = true`, [code]);",
      'modules/cms/services/storefront-resolver.ts',
    );
    expect(v.some((x) => x.kind === 'request-channel-reresolution')).toBe(true);
  });

  it('does NOT flag reading channel.isPublic off an already-resolved channel', () => {
    const v = analyzeSource(
      `const showPrice = channel?.isPublic ?? true; const c = request.salesChannel;`,
      SURFACE,
    );
    expect(v).toHaveLength(0);
  });

  it('does NOT flag a SalesChannel query outside a storefront surface (admin CRUD ok)', () => {
    const v = analyzeSource(
      `const ch = await em.findOne(SalesChannel, { id });`,
      NON_SURFACE,
    );
    expect(v).toHaveLength(0);
  });

  it('never flags anything inside the sales_channels module (resolver owns resolution)', () => {
    const v = analyzeSource(
      `const h = request.headers['x-sales-channel']; const ch = await em.findOne(SalesChannel, { code });`,
      RESOLVER,
    );
    expect(v).toHaveLength(0);
  });

  it('never flags the relocated kernel resolver (feature 072 T019)', () => {
    const v = analyzeSource(
      `const h = request.headers['x-sales-channel']; const ch = await em.findOne(SalesChannel, { code });`,
      KERNEL_RESOLVER,
    );
    expect(v).toHaveLength(0);
  });

  it('still flags a raw channel-header read elsewhere in the kernel', () => {
    // The exemption is the resolver's directory, not the kernel as a whole:
    // moving the resolver in must not turn the kernel into a blind spot.
    const v = analyzeSource(
      `const h = request.headers['x-sales-channel'];`,
      'kernel/scope.ts',
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('raw-channel-header');
  });

  it('does NOT flag the CORS policy naming the header it must let through', () => {
    // Feature 072 (D-42) widened the scan to all of `src/**`, which brought the
    // server bootstrap into range. Declaring the header is not reading it —
    // omitting it there is what would break the resolver.
    const v = analyzeSource(
      `await app.register(cors, { allowedHeaders: ['Content-Type', 'X-Sales-Channel'] });`,
      'http/server.ts',
    );
    expect(v).toHaveLength(0);
  });

  it('still flags a real header read in the same file', () => {
    const v = analyzeSource(
      `const code = request.headers['x-sales-channel'];`,
      'http/server.ts',
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('raw-channel-header');
  });

  /**
   * Signal 3 (feature 072, D-42) — a settings read whose channel argument is a
   * string literal that is not a channel id. "No channel" is spelled `null`.
   */
  describe('settings-channel-literal', () => {
    const ANY = 'modules/carts/backend.ts';
    const REAL_UUID = '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34';

    it('flags a channel code passed where a channel id is wanted', () => {
      const v = analyzeSource(
        `const n = await settingsReadPort.get(CODE, 'default', schema);`,
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('settings-channel-literal');
      expect(v[0]!.detail).toContain("'default'");
    });

    it('flags the nil UUID, which must now be spelled null', () => {
      const v = analyzeSource(
        `const n = await this.settings.get(CODE, '00000000-0000-0000-0000-000000000000', schema);`,
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('settings-channel-literal');
    });

    it('flags an identifier whose same-file initializer is such a literal', () => {
      const v = analyzeSource(
        [
          `const GLOBAL_SETTINGS_SCOPE = '00000000-0000-0000-0000-000000000000';`,
          `const n = await options.settings.get(code, GLOBAL_SETTINGS_SCOPE, schema);`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('settings-channel-literal');
    });

    it('flags the empty string', () => {
      const v = analyzeSource(`await settings.get(code, '', schema);`, ANY);
      expect(v).toHaveLength(1);
    });

    it('does NOT flag a null channel — that is the sanctioned platform-wide read', () => {
      const v = analyzeSource(`await settings.get(code, null, schema);`, ANY);
      expect(v).toHaveLength(0);
    });

    it('does NOT flag a real channel uuid literal (a fixture, a seed)', () => {
      const v = analyzeSource(
        `await settings.get(code, '${REAL_UUID}', schema);`,
        ANY,
      );
      expect(v).toHaveLength(0);
    });

    it('does NOT flag a channel id held in a variable or a parameter', () => {
      const v = analyzeSource(
        [
          `const channelId = await resolver();`,
          `await settings.get(code, channelId, schema);`,
          `await settings.get(code, ctx.resolvedChannel.id, schema);`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(0);
    });

    it('does NOT flag a string literal passed to something that is not a settings read', () => {
      const v = analyzeSource(
        [
          `await cache.get(code, 'default');`,
          `await dictionaries.get(code, 'default', schema);`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(0);
    });

    it('flags getMany as well as get', () => {
      const v = analyzeSource(
        `await this.settingsService.getMany(codes, 'default');`,
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('settings-channel-literal');
    });

    it('scans the composition root and the scripts, not just modules/**', () => {
      const source = `await settings.settingsService.get('x', 'default', schema);`;
      expect(analyzeSource(source, 'composition.ts')).toHaveLength(1);
      expect(
        analyzeSource(source, 'modules/carts/scripts/abandonment-sweep.ts'),
      ).toHaveLength(1);
    });

    /**
     * D-48 widened the argument resolution from "a literal, or a same-file
     * `const` holding one" to the set of values the argument can actually take.
     * `branding.service.ts` escaped D-42's check on exactly one hop more than it
     * could see: `const scopeId = salesChannelId ?? GLOBAL_SENTINEL`.
     */
    it('flags a `??` fallback reaching the channel argument through a local', () => {
      const v = analyzeSource(
        [
          `const GLOBAL_SENTINEL = '00000000-0000-0000-0000-000000000000';`,
          `function read(salesChannelId) {`,
          `  const scopeId = salesChannelId ?? GLOBAL_SENTINEL;`,
          `  return this.settings.get(code, scopeId, schema);`,
          `}`,
        ].join('\n'),
        ANY,
      );
      expect(v.some((x) => x.kind === 'settings-channel-literal')).toBe(true);
    });

    it('flags a `??` fallback written inline in the channel argument', () => {
      const v = analyzeSource(
        `await settings.get(code, resolved ?? 'default', schema);`,
        ANY,
      );
      expect(v.some((x) => x.kind === 'settings-channel-literal')).toBe(true);
    });

    it('flags a ternary where one branch is not a channel id', () => {
      const v = analyzeSource(
        `await settings.get(code, hasChannel ? channelId : 'default', schema);`,
        ANY,
      );
      expect(v.some((x) => x.kind === 'settings-channel-literal')).toBe(true);
    });

    it('does NOT flag `x ?? null` — that is the sanctioned platform-wide read', () => {
      const v = analyzeSource(
        [
          `const scopeId = resolved ?? null;`,
          `await settings.get(code, scopeId, schema);`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(0);
    });

    it('does NOT flag a fallback between two real channel uuids', () => {
      const v = analyzeSource(
        `await settings.get(code, resolved ?? '${REAL_UUID}', schema);`,
        ANY,
      );
      expect(v).toHaveLength(0);
    });
  });

  /**
   * Signal 4 (D-48) — the two positions that hid L1-L4 from signal 3, which
   * only ever looked at the channel argument of a settings read.
   */
  describe('invented-channel-identifier', () => {
    const ANY = 'modules/carts/backend.ts';
    const REAL_UUID = '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34';

    it('flags a default parameter value standing in for a channel id (L2)', () => {
      const v = analyzeSource(
        [
          `class OneClickService {`,
          `  constructor(private readonly salesChannelId: string = 'default') {}`,
          `}`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('invented-channel-identifier');
      expect(v[0]!.detail).toContain('default parameter');
    });

    it('flags a default parameter holding the nil uuid through a same-file const', () => {
      const v = analyzeSource(
        [
          `const GLOBAL_SENTINEL = '00000000-0000-0000-0000-000000000000';`,
          `function f(channelId = GLOBAL_SENTINEL) { return channelId; }`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('invented-channel-identifier');
    });

    it('does NOT flag a default parameter that is a real channel uuid (a fixture)', () => {
      const v = analyzeSource(`function f(salesChannelId = '${REAL_UUID}') {}`, ANY);
      expect(v).toHaveLength(0);
    });

    it('does NOT flag a default parameter on something that is not a channel', () => {
      const v = analyzeSource(`function f(templateCode = 'default') {}`, ANY);
      expect(v).toHaveLength(0);
    });

    /**
     * L1's shape — `(await getSystemDefault())?.id ?? 'default'` — is guarded by
     * the **type**, not by this check: D-48 made `getSystemDefault()`
     * non-nullable, so there is no `?.` to hang a `??` off and `tsc` refuses the
     * rewrite. Flagging every string fallback beside a channel id here instead
     * would bury the signal: the tree holds twenty ordinary
     * `channel?.defaultCurrency ?? 'PLN'` defaults, and a check that reports
     * those is a check nobody reads.
     */
    it('does NOT flag an ordinary default read off an already-resolved channel', () => {
      const v = analyzeSource(
        [
          `const currency = channel?.defaultCurrency ?? 'PLN';`,
          `const language = channel?.defaultLanguage ?? 'en-US';`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(0);
    });

    it('flags a resolved channel falling back to randomUUID() (L4, issue #85)', () => {
      const v = analyzeSource(
        `const order = tx.create(Order, { salesChannelId: channel?.id ?? randomUUID() });`,
        ANY,
      );
      expect(v).toHaveLength(1);
      expect(v[0]!.kind).toBe('invented-channel-identifier');
      expect(v[0]!.detail).toContain('randomUUID');
    });

    it('does NOT flag a channel resolution falling back to null', () => {
      const v = analyzeSource(`const id = channel?.id ?? null;`, ANY);
      expect(v).toHaveLength(0);
    });

    it('does NOT flag a randomUUID() that has nothing to do with a channel', () => {
      const v = analyzeSource(`const eventId = payload.eventId ?? randomUUID();`, ANY);
      expect(v).toHaveLength(0);
    });

    it('never flags the resolver’s own directory, which owns the seed value', () => {
      const v = analyzeSource(
        `const code = process.env['DEFAULT_SALES_CHANNEL_CODE'] ?? 'default';`,
        'kernel/sales-channels/default-channel-reconciler.ts',
      );
      expect(v).toHaveLength(0);
    });

    /**
     * `__global__` is the reserved platform-wide key segment (D-41), chosen
     * precisely because a uuid can never spell it. Deriving a cache key that way
     * is the *correct* shape, and both the settings cache and the dictionary
     * cache do it.
     */
    it('does NOT flag a cache key derived with the reserved global segment', () => {
      const v = analyzeSource(
        [
          `const GLOBAL_KEY_SEGMENT = '__global__';`,
          `const segment = salesChannelId ?? GLOBAL_KEY_SEGMENT;`,
        ].join('\n'),
        ANY,
      );
      expect(v).toHaveLength(0);
    });
  });
});

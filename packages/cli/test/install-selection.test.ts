/**
 * The selection `endora install --only` names, and the origins it is told the
 * other machines by (`specs/138-separate-components/spec.md` FR-001…FR-003,
 * FR-011; `plan.md`'s selection table; contract `instance-tree.md` §7.2).
 *
 * Both are pure: a selection is decided from three values the command line
 * already carries, an origin from one string. Nothing here touches a disk.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPONENT_VOCABULARY,
  parseOrigin,
  questionIdsFor,
  resolveSelection,
  type Selection,
} from '../src/install/selection.js';

function selected(
  only: readonly string[] | undefined,
  without: readonly string[] = [],
  storefront?: boolean,
): Selection {
  const result = resolveSelection(only, without, storefront);
  if ('refusals' in result) throw new Error(`refused: ${result.refusals.join(' | ')}`);
  return result;
}

function refused(
  only: readonly string[] | undefined,
  without: readonly string[] = [],
  storefront?: boolean,
): string {
  const result = resolveSelection(only, without, storefront);
  if (!('refusals' in result)) throw new Error('not refused');
  return result.refusals.join('\n');
}

describe('FR-001 — the vocabulary, and what its absence means', () => {
  it('is api, admin, storefront, in that order', () => {
    expect([...COMPONENT_VOCABULARY]).toEqual(['api', 'admin', 'storefront']);
  });

  it('absent ≡ all three, and neither is a strict subset', () => {
    const absent = selected(undefined);
    expect(absent).toEqual(selected(['api', 'admin', 'storefront']));
    expect(absent).toEqual({
      components: ['api', 'admin', 'storefront'],
      without: [],
      storefront: true,
      writesTree: true,
      subset: false,
    });
    // An empty list is a flag nobody typed, which is absence too.
    expect(selected([])).toEqual(absent);
  });

  it('absent passes `--without` and `--no-storefront` through unread, as before', () => {
    expect(selected(undefined, ['admin', 'docs'], false)).toEqual({
      components: ['api'],
      without: ['admin', 'docs'],
      storefront: false,
      writesTree: true,
      subset: false,
    });
  });

  it('the order typed and a repeated name do not matter', () => {
    expect(selected(['storefront', 'api', 'api']).components).toEqual(['api', 'storefront']);
  });
});

describe("plan.md's selection table, one case per row", () => {
  it('`api` — the tree without its admin member, no storefront', () => {
    expect(selected(['api'])).toEqual({
      components: ['api'],
      without: ['admin'],
      storefront: false,
      writesTree: true,
      subset: true,
    });
  });

  it('`api,admin` — the whole tree, no storefront', () => {
    expect(selected(['api', 'admin'])).toEqual({
      components: ['api', 'admin'],
      without: [],
      storefront: false,
      writesTree: true,
      subset: true,
    });
  });

  it('`api,storefront` — the tree without its admin member, the storefront beside it', () => {
    expect(selected(['api', 'storefront'])).toEqual({
      components: ['api', 'storefront'],
      without: ['admin'],
      storefront: true,
      writesTree: true,
      subset: true,
    });
  });

  it('`admin` — the same tree, backend member included (D-284 clause 2)', () => {
    expect(selected(['admin'])).toEqual({
      components: ['admin'],
      without: [],
      storefront: false,
      writesTree: true,
      subset: true,
    });
  });

  it('`storefront` — no instance tree at all', () => {
    expect(selected(['storefront'])).toEqual({
      components: ['storefront'],
      without: [],
      storefront: true,
      writesTree: false,
      subset: true,
    });
  });

  it('`admin,storefront` — the tree, and the storefront beside it', () => {
    expect(selected(['admin', 'storefront'])).toEqual({
      components: ['admin', 'storefront'],
      without: [],
      storefront: true,
      writesTree: true,
      subset: true,
    });
  });
});

describe('FR-003 — it composes with the flags it restates', () => {
  it('`docs` is not a component and stays `--without docs`', () => {
    expect(selected(['api', 'admin'], ['docs']).without).toEqual(['docs']);
    expect(selected(['api'], ['docs']).without).toEqual(['docs', 'admin']);
  });

  it('both spellings of one decision, named consistently, are accepted', () => {
    expect(selected(['api'], ['admin'], false)).toEqual(selected(['api']));
  });

  it('`--only admin --without admin` is a contradiction', () => {
    const message = refused(['admin'], ['admin']);
    expect(message).toContain('--only admin');
    expect(message).toContain('--without admin');
  });

  it('`--only storefront --no-storefront` is a contradiction', () => {
    const message = refused(['storefront'], [], false);
    expect(message).toContain('--only storefront');
    expect(message).toContain('--no-storefront');
  });
});

describe('FR-002 — what is not a selection', () => {
  it('an unknown name is refused, naming the vocabulary', () => {
    const message = refused(['api', 'backend']);
    expect(message).toContain('backend');
    expect(message).toContain('api, admin, storefront');
  });

  it('an empty selection is refused', () => {
    expect(refused([''])).toContain('--only');
    expect(refused([' ', ''])).toContain('at least one');
  });
});

describe('FR-019 — the questions a selection has', () => {
  it('all three: the seven it always had', () => {
    expect(questionIdsFor(selected(undefined))).toEqual([
      'directory',
      'parts',
      'services',
      'demo',
      'admin-email',
      'admin-password',
      'admin-name',
    ]);
  });

  it('`api`: the three origins of the other machines, then the seven', () => {
    expect(questionIdsFor(selected(['api']))).toEqual([
      'directory',
      'parts',
      'api-url',
      'admin-url',
      'storefront-url',
      'services',
      'demo',
      'admin-email',
      'admin-password',
      'admin-name',
    ]);
    expect(questionIdsFor(selected(['api', 'admin']))).not.toContain('admin-url');
    expect(questionIdsFor(selected(['api', 'storefront']))).not.toContain('storefront-url');
  });

  it('`admin`: where the API is, and nothing about a database or an administrator', () => {
    expect(questionIdsFor(selected(['admin']))).toEqual(['directory', 'parts', 'api-url']);
  });

  it('`storefront`: the API, its own origin, the channel and the secret', () => {
    expect(questionIdsFor(selected(['storefront']))).toEqual([
      'directory',
      'parts',
      'api-url',
      'storefront-url',
      'sales-channel',
      'revalidate-secret',
    ]);
    expect(questionIdsFor(selected(['admin', 'storefront']))).toEqual(
      questionIdsFor(selected(['storefront'])),
    );
  });
});

describe('FR-011 — an origin is scheme, host and an optional port', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['http://localhost:3001', 'http://localhost:3001'],
    ['http://127.0.0.1:41873', 'http://127.0.0.1:41873'],
    ['https://API.Example.com:443', 'https://api.example.com'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
  ])('accepts %s', (value, origin) => {
    expect(parseOrigin(value)).toBe(origin);
    expect(parseOrigin(value)).toBe(new URL(value).origin);
  });

  it.each([
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com?x=1',
    'https://api.example.com#top',
    'https://user:secret@api.example.com',
    'ftp://api.example.com',
    'api.example.com',
    'localhost:3001',
    'https://',
    '',
    '   ',
  ])('refuses %j', (value) => {
    expect(parseOrigin(value)).toBeNull();
  });
});

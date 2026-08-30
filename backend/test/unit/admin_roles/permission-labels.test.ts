import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LEGACY_PERMISSION_LABELS,
  compareToLegacyBlock,
  countLegacyLabelsByOwner,
  findPermissionLabelDefects,
  legacyOwnerKey,
  permissionLabelReadSize,
  walkPermissionLabels,
  type PermissionLabelInput,
} from '../../helpers/permission-labels.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';

/**
 * Red proofs for the permission-label rule (feature 091, Phase 3).
 *
 * Every fixture enters at the **top** of the analysis — an owner map and a
 * per-module, per-language set of labelled codes, which is exactly what the
 * contract test hands in after reading the bundles off disk (issue #130). A
 * fixture handed to the comparison alone would prove the comparison and leave
 * the classification, which is where every one of these defects lives,
 * unproven.
 */

const LANGUAGES = ['en', 'pl'] as const;

function input(
  owners: Record<string, readonly string[]>,
  bundles: Record<string, Partial<Record<'en' | 'pl', readonly string[]>>>,
): PermissionLabelInput {
  return {
    owners: new Map(Object.entries(owners).map(([code, ids]) => [code, new Set(ids)])),
    bundles: new Map(
      Object.entries(bundles).map(([moduleId, byLanguage]) => [
        moduleId,
        new Map(
          Object.entries(byLanguage).map(([language, codes]) => [
            language,
            new Set(codes ?? []),
          ]),
        ),
      ]),
    ),
    languages: LANGUAGES,
  };
}

describe('permission label classification (feature 091, Phase 3)', () => {
  it('accepts a code its owning module labels in every shipped language', () => {
    const findings = findPermissionLabelDefects(
      input({ 'pwa:read': ['pwa'] }, { pwa: { en: ['pwa:read'], pl: ['pwa:read'] } }),
    );
    expect(findings).toEqual([]);
  });

  it('accepts a code the legacy `_i18n` block still labels', () => {
    const findings = findPermissionLabelDefects(
      input({ 'orders:read': ['orders'] }, { _i18n: { en: ['orders:read'], pl: ['orders:read'] } }),
    );
    expect(findings).toEqual([]);
  });

  it('reports a code no bundle labels — missing-label, per language', () => {
    const findings = findPermissionLabelDefects(input({ 'crm:read': ['crm'] }, {}));
    expect(findings.map((f) => [f.kind, f.code, f.language])).toEqual([
      ['missing-label', 'crm:read', 'en'],
      ['missing-label', 'crm:read', 'pl'],
    ]);
  });

  it('reports a module that labels a code it does not own — foreign-label', () => {
    const findings = findPermissionLabelDefects(
      input(
        { 'orders:read': ['orders'] },
        {
          orders: { en: ['orders:read'], pl: ['orders:read'] },
          blog: { en: ['orders:read'], pl: ['orders:read'] },
        },
      ),
    );
    expect(findings.map((f) => [f.kind, f.module, f.code])).toEqual([
      ['foreign-label', 'blog', 'orders:read'],
    ]);
  });

  it('reports an owner that labels its code in one language only — split-label', () => {
    const findings = findPermissionLabelDefects(
      input(
        { 'pwa:read': ['pwa'] },
        { pwa: { en: ['pwa:read'] }, _i18n: { en: ['pwa:read'], pl: ['pwa:read'] } },
      ),
    );
    expect(findings.map((f) => [f.kind, f.module, f.code, f.language])).toEqual([
      ['split-label', 'pwa', 'pwa:read', 'pl'],
    ]);
  });

  it('reports a legacy label for a code no module declares — orphan-legacy-label', () => {
    const findings = findPermissionLabelDefects(
      input({}, { _i18n: { en: ['dropped:code'], pl: ['dropped:code'] } }),
    );
    expect(findings.map((f) => [f.kind, f.code])).toEqual([
      ['orphan-legacy-label', 'dropped:code'],
    ]);
  });

  it('a code every owner is absent from is not laundered into the legacy count', () => {
    const counts = countLegacyLabelsByOwner(
      input(
        { 'orders:read': ['orders'], 'blog.read': ['blog'] },
        { _i18n: { en: ['orders:read', 'blog.read'], pl: ['orders:read', 'blog.read'] } },
      ),
    );
    expect([...counts].sort()).toEqual([
      ['blog', 1],
      ['orders', 1],
    ]);
  });

  it('keys a shared code by every owner, sorted — it drains only when one of them takes it', () => {
    expect(legacyOwnerKey(new Set(['webhooks', 'api_keys']))).toBe('api_keys+webhooks');
    const counts = countLegacyLabelsByOwner(
      input(
        { 'integrations:manage': ['api_keys', 'webhooks'] },
        { _i18n: { en: ['integrations:manage'], pl: ['integrations:manage'] } },
      ),
    );
    expect([...counts]).toEqual([['api_keys+webhooks', 1]]);
  });
});

describe('the legacy block is a two-way ratchet', () => {
  it('refuses a legacy label the block does not record — unrecorded', () => {
    const drift = compareToLegacyBlock(new Map([['blog', 3]]), { blog: 2 });
    expect(drift.unrecorded).toEqual([{ owner: 'blog', declared: 2, actual: 3 }]);
    expect(drift.stale).toEqual([]);
  });

  it('refuses a number left standing after the labels under it moved — stale', () => {
    const drift = compareToLegacyBlock(new Map([['blog', 1]]), { blog: 2 });
    expect(drift.stale).toEqual([{ owner: 'blog', declared: 2, actual: 1 }]);
    expect(drift.unrecorded).toEqual([]);
  });

  it('refuses an owner that has drained entirely while its entry stands', () => {
    const drift = compareToLegacyBlock(new Map(), { pwa: 3 });
    expect(drift.stale).toEqual([{ owner: 'pwa', declared: 3, actual: 0 }]);
  });

  it('refuses a brand-new owner in the shared bundle', () => {
    const drift = compareToLegacyBlock(new Map([['crm', 2]]), {});
    expect(drift.unrecorded).toEqual([{ owner: 'crm', declared: 0, actual: 2 }]);
  });

  it('the shipped block records no owner the drain has already emptied', () => {
    // A guard on the block itself: a zero is not how an entry retires — it is
    // removed, so `Object.keys(...).length` is the number that has to fall.
    expect(Object.entries(LEGACY_PERMISSION_LABELS).filter(([, n]) => n <= 0)).toEqual([]);
  });
});

describe('the walk refuses a population it did not read', () => {
  /**
   * Issue #215 over this walk. The fixture is two manifest entries — one whose
   * directory is on disk and ships a bundle, one whose directory is not there,
   * which is what every entry looks like the day a module tree moves. The walk
   * therefore opens real files and still comes back short, which is the case a
   * `files.length === 0` floor cannot see. A record handed straight to
   * `readSizeRefusal` would prove that helper and leave this walk's own
   * `covered`/`expected` derivation unproven.
   */
  const root = mkdtempSync(join(tmpdir(), 'permission-labels-'));
  mkdirSync(join(root, 'here', 'i18n'), { recursive: true });
  for (const language of ['en', 'pl']) {
    writeFileSync(
      join(root, 'here', 'i18n', `${language}.json`),
      JSON.stringify({ 'adminRoles.permission.here:read': 'View' }),
    );
  }
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const entry = (id: string, dir: string) => ({
    manifest: {
      id,
      permissions: [{ code: `${id}:read`, label: 'View' }],
      i18n: { bundlesDir: 'i18n' },
    },
    filePath: join(root, dir, 'manifest.ts'),
  });

  it('reports a module whose directory the walk could not locate as short', () => {
    const walk = walkPermissionLabels([entry('here', 'here'), entry('gone', 'gone')]);
    expect(walk.files).toBe(2);
    expect([walk.located, walk.declaring]).toEqual([1, 2]);
    expect(readSizeRefusal(permissionLabelReadSize(walk))?.kind).toBe('short-walk');
  });

  it('reports an empty registry as read-nothing, not as a clean tree', () => {
    expect(readSizeRefusal(permissionLabelReadSize(walkPermissionLabels([])))?.kind).toBe(
      'read-nothing',
    );
  });
});

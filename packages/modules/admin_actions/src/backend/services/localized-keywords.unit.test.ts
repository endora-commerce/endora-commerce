import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { AdminActionsService } from './admin-actions-service.js';

/**
 * Issue #560 — a palette action's per-language search keywords.
 *
 * `keywords` in a manifest is English and matches in every admin language; a
 * `keywordsKey` names an entry in the declaring module's own bundle — a
 * comma-separated list — that adds the words an operator types in *their*
 * language. The server resolves it in the requested language, the way it
 * already resolves `labelKey` and `descriptionKey`, so the admin's palette
 * filter (`admin-shell/src/lib/palette-match.ts`, over `label`, `description`
 * and `keywords`) needs no knowledge of languages to find a Polish word.
 */

interface ActionRow {
  module_id: string;
  action_id: string;
  label_key: string;
  description_key: string | null;
  keywords_key: string | null;
  icon: string;
  target_route: string;
  required_permission: string | null;
  keywords: string[];
  weight: number;
  version: number;
}

const NEW_CREDENTIAL: ActionRow = {
  module_id: 'credentials',
  action_id: 'new-credential',
  label_key: 'actions.newCredential.label',
  description_key: null,
  keywords_key: 'actions.newCredential.keywords',
  icon: 'Plus',
  target_route: '/credentials/new',
  required_permission: null,
  keywords: ['credential', 'configuration'],
  weight: 251,
  version: 1,
};

function emReturning(rows: ActionRow[]): () => EntityManager {
  const knex = (): unknown => {
    const chain = { select: async (): Promise<ActionRow[]> => rows };
    return chain;
  };
  return () => ({ getKnex: () => knex }) as unknown as EntityManager;
}

/**
 * The `_i18n` resolver's observable contract: the requested language, then
 * English, then the `moduleId.key` placeholder.
 */
function translatorOver(bundles: Record<string, Record<string, string>>): AdminI18nTranslatePort {
  return {
    translate: async (moduleId, key, language) =>
      bundles[language]?.[`${moduleId}.${key}`] ??
      bundles['en']?.[`${moduleId}.${key}`] ??
      `${moduleId}.${key}`,
  };
}

const BUNDLES = {
  en: {
    'credentials.actions.newCredential.label': 'New credential',
    'credentials.actions.newCredential.keywords': 'new credential, configuration',
  },
  pl: {
    'credentials.actions.newCredential.label': 'Nowe poświadczenie',
    'credentials.actions.newCredential.keywords': 'nowe poświadczenie, konfiguracja',
  },
};

const permissions: PermissionReadPort = {
  listPermissions: async () => ['*'],
  resolveRole: async () => {
    throw new Error('admin_actions reads permissions, never a role');
  },
};

async function keywordsFor(
  rows: ActionRow[],
  language: 'en' | 'pl',
  i18nService: AdminI18nTranslatePort = translatorOver(BUNDLES),
): Promise<string[]> {
  const service = new AdminActionsService({
    em: emReturning(rows),
    i18nService,
    permissionService: permissions,
  });
  try {
    const result = await service.listVisibleForOperator({ language, adminUserId: 'admin-1' });
    return result.actions[0]?.keywords ?? [];
  } finally {
    service.dispose();
  }
}

describe('admin_actions — per-language palette keywords (issue #560)', () => {
  it('serves the Polish keywords from the bundle when the admin language is pl', async () => {
    const keywords = await keywordsFor([NEW_CREDENTIAL], 'pl');
    expect(keywords).toContain('nowe poświadczenie');
    expect(keywords).toContain('konfiguracja');
  });

  it('keeps the manifest English keywords in every language, so English still finds the screen', async () => {
    expect(await keywordsFor([NEW_CREDENTIAL], 'pl')).toEqual(
      expect.arrayContaining(['credential', 'configuration']),
    );
  });

  it('serves no Polish word to an English admin', async () => {
    const keywords = await keywordsFor([NEW_CREDENTIAL], 'en');
    expect(keywords).toEqual(['credential', 'configuration', 'new credential']);
    expect(keywords.some((k) => /[ąćęłńóśźż]/u.test(k))).toBe(false);
  });

  it('answers the manifest keywords alone when the key resolves to nothing', async () => {
    expect(await keywordsFor([NEW_CREDENTIAL], 'pl', translatorOver({}))).toEqual([
      'credential',
      'configuration',
    ]);
  });

  it('asks the bundle nothing for an action that declares no keywordsKey', async () => {
    const asked: string[] = [];
    const i18n: AdminI18nTranslatePort = {
      translate: async (moduleId, key) => {
        asked.push(key);
        return `${moduleId}.${key}`;
      },
    };
    expect(await keywordsFor([{ ...NEW_CREDENTIAL, keywords_key: null }], 'pl', i18n)).toEqual([
      'credential',
      'configuration',
    ]);
    expect(asked).toEqual(['actions.newCredential.label']);
  });
});

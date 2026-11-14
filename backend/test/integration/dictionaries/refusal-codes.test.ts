import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Country, Currency, Language } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #643 (#86) — creating a country, currency or language whose code
 * already exists, and making an inactive one the default, were refused on the
 * admin dictionary routes with `409 VALIDATION_FAILED` and an English literal.
 * `VALIDATION_FAILED` is the one code whose message the error envelope never
 * replaces, so an operator working in Polish read English, and a client could
 * not tell either refusal from a malformed body.
 *
 * The two codes are minted once, in `dictionaries`, which owns the family the
 * three reference dictionaries share, and raised by all three services. The
 * `details.code` token names the dictionary (`country`, `currency`,
 * `language`), so each reads as its own sentence; the entry's own code is
 * `entryCode`, because the envelope reads `details.code` as the token.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN = { b2b_session: 'stub-admin-session' };
const LANGUAGES = ['en', 'pl'] as const;
type Lang = (typeof LANGUAGES)[number];

type EntryType = 'country' | 'currency' | 'language';

const CASES: Record<
  EntryType,
  {
    path: string;
    /** An entry every installation seeds, so a create naming it is a duplicate. */
    existing: Record<string, unknown> & { code: string };
    /** A non-default entry the case switches off for the default refusal. */
    toDeactivate: string;
    taken: Record<Lang, (code: string) => string>;
    inactive: Record<Lang, (code: string) => string>;
  }
> = {
  country: {
    path: 'countries',
    existing: {
      code: 'PL',
      alpha3Code: 'POL',
      numericCode: '616',
      label: 'Poland again',
      region: 'Europe',
    },
    toDeactivate: 'SE',
    taken: {
      en: (code) => `A country with the code ${code} already exists.`,
      pl: (code) => `Kraj o kodzie ${code} już istnieje.`,
    },
    inactive: {
      en: (code) => `Country ${code} is inactive, so it cannot be made the default. Activate it first.`,
      pl: (code) =>
        `Kraj ${code} jest nieaktywny, więc nie można go ustawić jako domyślnego. Najpierw go aktywuj.`,
    },
  },
  currency: {
    path: 'currencies',
    existing: { code: 'PLN', label: 'Zloty again', symbol: 'zł' },
    toDeactivate: 'SEK',
    taken: {
      en: (code) => `A currency with the code ${code} already exists.`,
      pl: (code) => `Waluta o kodzie ${code} już istnieje.`,
    },
    inactive: {
      en: (code) => `Currency ${code} is inactive, so it cannot be made the default. Activate it first.`,
      pl: (code) =>
        `Waluta ${code} jest nieaktywna, więc nie można jej ustawić jako domyślnej. Najpierw ją aktywuj.`,
    },
  },
  language: {
    path: 'languages',
    existing: { code: 'pl-PL', label: 'Polish again', nativeLabel: 'Polski' },
    toDeactivate: 'de',
    taken: {
      en: (code) => `A language with the code ${code} already exists.`,
      pl: (code) => `Język o kodzie ${code} już istnieje.`,
    },
    inactive: {
      en: (code) => `Language ${code} is inactive, so it cannot be made the default. Activate it first.`,
      pl: (code) =>
        `Język ${code} jest nieaktywny, więc nie można go ustawić jako domyślnego. Najpierw go aktywuj.`,
    },
  },
};

const ENTITY = { country: Country, currency: Currency, language: Language } as const;

describe('dictionary refusals carry their own code and sentence (issue #643)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) await setAdminLanguage(languageBefore);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  /** Runs `fn` with the entry switched off, and puts its `isActive` back after. */
  async function whileInactive(type: EntryType, code: string, fn: () => Promise<void>): Promise<void> {
    const em = h.em().fork();
    const row = (await em.findOneOrFail(ENTITY[type] as never, { code } as never)) as { isActive: boolean };
    const before = row.isActive;
    row.isActive = false;
    await em.flush();
    try {
      await fn();
    } finally {
      row.isActive = before;
      await em.flush();
    }
  }

  function refusal(
    res: { statusCode: number; body: string; json: () => unknown },
    code: string,
  ): ErrorBody['error'] {
    expect(res.statusCode, res.body).toBe(409);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  for (const [type, c] of Object.entries(CASES) as Array<[EntryType, (typeof CASES)[EntryType]]>) {
    describe(type, () => {
      it.each(LANGUAGES)(`refuses a ${type} whose code is taken (%s)`, async (language) => {
        await setAdminLanguage(language);
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/dictionary/${c.path}`,
          cookies: ADMIN,
          payload: c.existing,
        });
        const error = refusal(res, 'DICTIONARY_ENTRY_CODE_TAKEN');
        expect(error.details).toEqual({ code: type, entryCode: c.existing.code });
        expect(error.message).toBe(c.taken[language](c.existing.code));
        if (language === 'pl') expect(error.message).not.toBe(c.taken.en(c.existing.code));
      });

      it.each(LANGUAGES)(`refuses to make an inactive ${type} the default (%s)`, async (language) => {
        await setAdminLanguage(language);
        await whileInactive(type, c.toDeactivate, async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/dictionary/${c.path}/${c.toDeactivate}/default`,
            cookies: ADMIN,
          });
          const error = refusal(res, 'DICTIONARY_DEFAULT_ENTRY_INACTIVE');
          expect(error.details).toEqual({ code: type, entryCode: c.toDeactivate });
          expect(error.message).toBe(c.inactive[language](c.toDeactivate));
          if (language === 'pl') expect(error.message).not.toBe(c.inactive.en(c.toDeactivate));
        });
      });
    });
  }

  it('routes both codes to dictionaries, the module that owns the family', () => {
    for (const code of ['DICTIONARY_ENTRY_CODE_TAKEN', 'DICTIONARY_DEFAULT_ENTRY_INACTIVE']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('dictionaries');
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_COOKIE_NAME,
  SettingGroupDtoSchema,
  type SettingNoticeRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminUser } from '../../helpers/package-entities.js';

/**
 * Issue #930 — `mfa.admin.totp_enforced` on an instance with no
 * `MFA_SECRET_ENCRYPTION_KEY`.
 *
 * Without the key `mfa` composes but serves no enrolment or verify route, so
 * the setup step sign-in sends an unenrolled administrator to cannot be
 * completed: with the setting on, every one of them was locked out.
 *
 *  - The setting's write refuses to turn it on there, with a sentence in both
 *    shipped languages; turning it off is never refused.
 *  - An instance already in that state does not demand the impossible setup:
 *    the setting is not applied while no factor can be enrolled, and the boot
 *    warning says so (held by the module's unit test).
 *  - With `mfa` off its validator does not answer: the platform's own
 *    read-only refusal does, as for every other setting of an absent module.
 *
 * The harness pins the key for every file, so this one withholds it before it
 * composes and puts it back afterwards.
 */
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };
const ENFORCED = 'mfa.admin.totp_enforced';
const EMAIL = 'keyless-enforcement@example.com';
const PASSWORD = 'keyless-enforcement-pass-1!';

describe('mfa.admin.totp_enforced without an encryption key (issue #930)', () => {
  let h: BackendServerHandle;
  let savedKey: string | undefined;

  const putEnforced = (value: boolean) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${ENFORCED}/value`,
      cookies: STUB_ADMIN,
      payload: { scope: 'all', value },
    });

  // The admin arm resolves its language from the stored preference and
  // ignores `Accept-Language` (D-132).
  const preferLanguage = async (language: string | null) => {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = language;
    await em.flush();
  };

  const storedGlobalValue = async (): Promise<unknown> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute('select "global_value" from "settings" where "code" = ?', [ENFORCED])) as Array<{
      global_value: unknown;
    }>;
    return rows[0]?.global_value ?? null;
  };

  beforeAll(async () => {
    savedKey = process.env['MFA_SECRET_ENCRYPTION_KEY'];
    delete process.env['MFA_SECRET_ENCRYPTION_KEY'];
    h = await setupBackendServer();
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: {
        email: EMAIL,
        password: PASSWORD,
        firstName: 'Key',
        lastName: 'Less',
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    if (savedKey === undefined) delete process.env['MFA_SECRET_ENCRYPTION_KEY'];
    else process.env['MFA_SECRET_ENCRYPTION_KEY'] = savedKey;
  });

  it('is an instance that cannot enrol a second factor', async () => {
    const begin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/begin',
      payload: { setupTicket: 'any' },
    });
    expect(begin.statusCode).toBe(404);
  });

  it('refuses turning the setting on, with a translated sentence, and stores nothing', async () => {
    const res = await putEnforced(true);
    expect(res.statusCode).toBe(409);
    const error = res.json().error as { code: string; message: string; details: Record<string, unknown> };
    expect(error.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error.details).toMatchObject({ reason: 'encryption_key_missing', setting: ENFORCED });
    // The bundle's sentence, not the thrower's prose.
    expect(error.message).toBe(
      'Administrators cannot be required to use two-step verification on this instance, because ' +
        'no second factor can be set up: the encryption key MFA_SECRET_ENCRYPTION_KEY is not ' +
        'configured. Ask whoever runs this platform to set it, then turn the setting on again.',
    );
    expect(await storedGlobalValue()).toBeNull();

    const before =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    await preferLanguage('pl');
    const pl = await putEnforced(true).finally(() => preferLanguage(before));
    expect(pl.statusCode).toBe(409);
    expect((pl.json().error as { message: string }).message).toBe(
      'Na tej instancji nie można wymagać od administratorów weryfikacji dwuetapowej, bo nie da ' +
        'się skonfigurować drugiego składnika: nie ustawiono klucza szyfrowania ' +
        'MFA_SECRET_ENCRYPTION_KEY. Poproś osobę, która utrzymuje platformę, o jego ustawienie, a ' +
        'potem włącz to ustawienie ponownie.',
    );
  });

  it('always lets the setting be turned off', async () => {
    const res = await putEnforced(false);
    expect(res.statusCode).toBe(200);
  });

  it('signs an unenrolled administrator in on the password when the setting is already on', async () => {
    // The state an instance reaches by losing its key after the setting was
    // turned on, or by turning it on before the refusal existed. Written past
    // the validator, as such a value was.
    await h
      .em()
      .getConnection()
      .execute(`update "settings" set "global_value" = 'true'::jsonb where "code" = ?`, [ENFORCED]);
    await h.settings.cache.invalidateAfterWrite(ENFORCED);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('authenticated');
    expect(res.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)).toBeDefined();

    // Recovery is the ordinary write.
    expect((await putEnforced(false)).statusCode).toBe(200);
  });

  it('says on the Settings screen that the setting is on and not in force', async () => {
    const notice = async () => {
      const detail = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/settings/${ENFORCED}`,
        cookies: STUB_ADMIN,
      });
      expect(detail.statusCode).toBe(200);
      const list = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings?groupCode=mfa',
        cookies: STUB_ADMIN,
      });
      expect(list.statusCode).toBe(200);
      const listed = (
        list.json() as { groups: Array<{ settings: Array<{ code: string; notice?: unknown }> }> }
      ).groups
        .flatMap((g) => g.settings)
        .find((s) => s.code === ENFORCED);
      expect(listed?.notice).toEqual((detail.json() as { notice?: unknown }).notice);
      return (detail.json() as { notice?: unknown }).notice;
    };

    expect(await notice()).toBeUndefined();

    await h
      .em()
      .getConnection()
      .execute(`update "settings" set "global_value" = 'true'::jsonb where "code" = ?`, [ENFORCED]);
    await h.settings.cache.invalidateAfterWrite(ENFORCED);
    expect(await notice()).toEqual({
      code: 'encryption_key_missing',
      message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
    });

    expect((await putEnforced(false)).statusCode).toBe(200);
    expect(await notice()).toBeUndefined();
  });

  it('accepts re-saving an unchanged true, and the setting is still not applied', async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "settings" set "global_value" = 'true'::jsonb where "code" = ?`, [ENFORCED]);
    await h.settings.cache.invalidateAfterWrite(ENFORCED);

    const resave = await putEnforced(true);
    expect(resave.statusCode).toBe(200);
    expect(await storedGlobalValue()).toBe(true);

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect((login.json() as { data: { status: string } }).data.status).toBe('authenticated');

    expect((await putEnforced(false)).statusCode).toBe(200);
  });

  // --- Issue #948, owner ruling Q6 (2026-11-08) ------------------------------
  // Without the key no second factor is asked for at all: not by the setting,
  // not by a role's flag, and not of an administrator who enrolled while the
  // key was there — nothing could check the code.

  const createAdmin = async (email: string, adminRoleId: string): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: { email, password: PASSWORD, firstName: 'Key', lastName: 'Less', adminRoleId },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };

  const putRole = (code: string, requiresTwoFactor: boolean) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      cookies: STUB_ADMIN,
      payload: { code, name: code, permissions: ['orders:read'], requiresTwoFactor },
    });

  /** A role whose flag was set before the key went: written past the refusal. */
  const flaggedRole = async (code: string): Promise<string> => {
    const res = await putRole(code, false);
    expect(res.statusCode).toBe(200);
    await h
      .em()
      .getConnection()
      .execute(`update "admin_roles" set "requires_two_factor" = true where "code" = ?`, [code]);
    return (res.json() as { data: { id: string } }).data.id;
  };

  const signIn = (email: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email, password: PASSWORD },
    });

  it("refuses ticking a role's box, as it refuses the setting", async () => {
    expect((await putRole('keyless_refused', false)).statusCode).toBe(200);
    const res = await putRole('keyless_refused', true);
    expect(res.statusCode).toBe(409);
    const error = res.json().error as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe('MFA_REQUIRED_FOR_ROLE_TWO_FACTOR');
    expect(error.details).toMatchObject({ reason: 'encryption_key_missing' });
  });

  it("signs an unenrolled holder of a flagged role in on the password", async () => {
    const roleId = await flaggedRole('keyless_flagged');
    await createAdmin('keyless-holder@example.com', roleId);
    const res = await signIn('keyless-holder@example.com');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('authenticated');
  });

  it('signs an administrator who enrolled before the key went in on the password', async () => {
    const adminId = await createAdmin('keyless-enrolled@example.com', PLATFORM_ADMIN_ROLE_ID);
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "mfa_enrolments"
           ("id", "subject_type", "subject_id", "status", "secret_ciphertext", "secret_iv",
            "secret_auth_tag", "confirmed_at", "created_at", "updated_at")
         values (gen_random_uuid(), 'admin', ?, 'active', decode('00', 'hex'),
                 decode('00', 'hex'), decode('00', 'hex'), now(), now(), now())`,
        [adminId],
      );
    const res = await signIn('keyless-enrolled@example.com');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('authenticated');
  });

  it("says on the Roles screen that a flagged role's requirement is not in force", async () => {
    await flaggedRole('keyless_noticed');
    expect((await putRole('keyless_plain', false)).statusCode).toBe(200);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-roles',
      cookies: STUB_ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const roles = (res.json() as { data: Array<{ code: string; twoFactorNotice?: unknown }> }).data;
    expect(roles.find((r) => r.code === 'keyless_noticed')?.twoFactorNotice).toEqual({
      code: 'encryption_key_missing',
      message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
    });
    expect(roles.find((r) => r.code === 'keyless_plain')).not.toHaveProperty('twoFactorNotice');
  });

  it('signs nobody out for being given a flagged role, which binds nobody here', async () => {
    const roleId = await flaggedRole('keyless_assigned');
    const adminId = await createAdmin('keyless-assigned@example.com', PLATFORM_ADMIN_ROLE_ID);
    const login = await signIn('keyless-assigned@example.com');
    const cookie = login.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!.value;
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${adminId}`,
      cookies: STUB_ADMIN,
      payload: { adminRoleId: roleId },
    });
    expect(patch.statusCode).toBe(200);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
    });
    expect(me.statusCode).toBe(200);
  });

  it('asks the Settings screen for no sign-out confirmation, where the write is refused', async () => {
    expect((await putEnforced(false)).statusCode).toBe(200);
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/settings/${ENFORCED}`,
      cookies: STUB_ADMIN,
    });
    expect(detail.json()).not.toHaveProperty('confirmation');
  });

  it('leaves the refusal to the platform while mfa is off', async () => {
    // Stated, not inherited: a case above that failed may have left it on.
    expect((await putEnforced(false)).statusCode).toBe(200);
    await withModuleOff('mfa', 'deactivated', async () => {
      const res = await putEnforced(true);
      expect(res.statusCode).not.toBe(200);
      expect((res.json().error as { code: string }).code).toBe('MODULE_SETTING_READ_ONLY');
    });
    expect(await storedGlobalValue()).not.toBe(true);
  });

  // Last, because the provider it registers stays registered for the file.
  it('keeps the Settings list answering when a notice provider fails', async () => {
    const registry = (h.container.cradle as unknown as { settingNoticeRegistry: SettingNoticeRegistryPort })
      .settingNoticeRegistry;
    registry.register({
      contributorModuleId: 'mfa',
      codes: ['mfa.admin.totp_enabled'],
      notice: async () => {
        throw new Error('deliberate: a provider that fails');
      },
    });
    await h
      .em()
      .getConnection()
      .execute(`update "settings" set "global_value" = 'true'::jsonb where "code" = ?`, [ENFORCED]);
    await h.settings.cache.invalidateAfterWrite(ENFORCED);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings?groupCode=mfa',
      cookies: STUB_ADMIN,
    });
    expect(list.statusCode).toBe(200);
    const groups = (list.json() as { groups: unknown[] }).groups;
    // The response schema: `notice` is optional and never `null`.
    const parsed = groups.map((group) => SettingGroupDtoSchema.parse(group));
    const raw = groups.flatMap((g) => (g as { settings: Array<Record<string, unknown>> }).settings);
    for (const setting of raw) {
      if (setting['code'] !== ENFORCED) expect('notice' in setting).toBe(false);
    }
    const enforced = parsed.flatMap((g) => g.settings).find((st) => st.code === ENFORCED);
    expect(enforced?.notice?.code).toBe('encryption_key_missing');

    expect((await putEnforced(false)).statusCode).toBe(200);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest, ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '@endora-commerce/platform/kernel';

/**
 * Issue #86 — `SETTING_VALUE_SHAPE_MISMATCH` says what the setting accepts.
 *
 * Two refusals share the code. The service wrote `Value does not match
 * valueType="number".` for one and `Value must be one of: a, b.` for the
 * other, and the bundle answered both with "Setting value does not match the
 * required shape." — so an operator who typed a word into a number field, or
 * an option the setting does not have, was not told what would be accepted.
 *
 * Each refusal now names itself in `details.code`, which the envelope reads as
 * the tail of the sentence key, and carries the values that sentence
 * interpolates.
 *
 * An administrator's language is the stored preference, not a header.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const OWNER = 'i86_shape_mismatch';

interface Refusal {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('SETTING_VALUE_SHAPE_MISMATCH says what the setting accepts (issue #86)', () => {
  let h: BackendServerHandle;

  async function setAdminLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: ADMIN,
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode).toBe(200);
  }

  async function refusal(code: string, value: unknown): Promise<Refusal['error']> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: ADMIN,
      payload: { scope: 'all', value },
    });
    // The status the refusal has always had.
    expect(res.statusCode, res.body).toBe(400);
    const body = res.json() as Refusal;
    expect(body.error.code).toBe(ERROR_CODES.SETTING_VALUE_SHAPE_MISMATCH);
    return body.error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: OWNER,
        groups: [],
        settings: [
          { code: 'i86_shape.count', name: 'Count', valueType: 'number', defaultValue: 3 },
          {
            code: 'i86_shape.mode',
            name: 'Mode',
            valueType: 'string',
            enumOptions: ['conservative', 'eager'],
            defaultValue: 'conservative',
          },
        ],
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    // The preference and the two settings outlive this file in a single-fork run.
    await setAdminLanguage(null);
    const em = h.em();
    for (const setting of await em.find(Setting, { ownerModule: OWNER })) em.remove(setting);
    await em.flush();
    await teardownBackendServer(h);
  });

  describe('a value of the wrong type', () => {
    it('details name the refusal, the setting and the type it takes', async () => {
      await setAdminLanguage('en');
      const { details } = await refusal('i86_shape.count', 'three');
      expect(details).toMatchObject({
        code: 'wrong_type',
        settingCode: 'i86_shape.count',
        valueType: 'number',
      });
      // The validator's own findings are still there for a client that wants them.
      expect(details?.['issues']).toEqual([
        { path: '(root)', issue: expect.any(String) },
      ]);
    });

    it('en — the sentence names the setting and the type', async () => {
      await setAdminLanguage('en');
      expect((await refusal('i86_shape.count', 'three')).message).toBe(
        'The value of "i86_shape.count" must be of type "number".',
      );
    });

    it('pl — the Polish sentence names them too, and is not the English fallback', async () => {
      await setAdminLanguage('pl');
      const { message } = await refusal('i86_shape.count', 'three');
      expect(message).toBe('Wartość ustawienia „i86_shape.count” musi być typu „number”.');
      expect(message).not.toMatch(/Value does not match|\{/);
    });
  });

  describe('a value the setting does not offer', () => {
    it('details name the refusal, the setting and the options', async () => {
      await setAdminLanguage('en');
      const { details } = await refusal('i86_shape.mode', 'reckless');
      expect(details).toEqual({
        code: 'not_an_option',
        settingCode: 'i86_shape.mode',
        allowedValues: 'conservative, eager',
        enumOptions: ['conservative', 'eager'],
      });
    });

    it('en — the sentence lists the options', async () => {
      await setAdminLanguage('en');
      expect((await refusal('i86_shape.mode', 'reckless')).message).toBe(
        'The value of "i86_shape.mode" must be one of: conservative, eager.',
      );
    });

    it('pl — the Polish sentence lists them too, and is not the English fallback', async () => {
      await setAdminLanguage('pl');
      const { message } = await refusal('i86_shape.mode', 'reckless');
      expect(message).toBe(
        'Wartość ustawienia „i86_shape.mode” musi być jedną z: conservative, eager.',
      );
      expect(message).not.toMatch(/Value must be one of|\{/);
    });
  });
});

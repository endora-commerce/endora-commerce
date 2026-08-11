import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { EmailCradle } from '../../../src/modules/email/backend.js';
import { ConsoleMailer } from '../../../src/modules/email/services/mailer.js';
import { SmtpMailer } from '../../../src/modules/email/services/smtp-mailer.js';

/**
 * Contract — `email` composes through `registerModule` (feature 072, T079).
 *
 * `email` ships no route, so "did the conversion take effect" cannot be asked
 * over HTTP. It is asked of the container instead, and deliberately of the
 * **test harness's** container: the harness is a second composition root that
 * used to hard-code `new ConsoleMailer()` in five places, so a conversion that
 * only touched `composition.ts` would leave every mail-sending suite passing
 * against wiring nobody changed.
 *
 * The driver assertion is written as a conditional rather than as
 * "ConsoleMailer", so it states the module's actual rule — SMTP when the
 * environment configures one, console otherwise — instead of an assumption
 * about the machine running it.
 */
describe('email — the mailer is a module registration', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('registers the mailer under a module-prefixed name', () => {
    const cradle = h.container.cradle as unknown as EmailCradle;
    expect(cradle.emailMailer).toBeDefined();
    expect(typeof cradle.emailMailer.send).toBe('function');
  });

  it('picks the driver from the resolved SMTP url', () => {
    const cradle = h.container.cradle as unknown as EmailCradle;
    expect(cradle.emailMailer).toBeInstanceOf(cradle.emailSmtpUrl ? SmtpMailer : ConsoleMailer);
  });

  it('is a singleton — one transport per composition, not one per resolution', () => {
    const cradle = h.container.cradle as unknown as EmailCradle;
    expect(cradle.emailMailer).toBe(cradle.emailMailer);
  });
});

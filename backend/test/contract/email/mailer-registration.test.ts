import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { EmailCradle } from '../../../../packages/modules/email/src/backend/index.js';

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
 *
 * **Both driver assertions compare the class *name*, and `instanceof` is not
 * available to them** (feature 080, T040b, batch four; D-160.6.1). The platform
 * composes `email` through `@endora-commerce/mod-email/backend`, which the
 * package's `exports` map points at `dist`; a class imported here by filesystem
 * path into the package's **source** is a second evaluation of that file, so
 * `expect(composed).toBeInstanceOf(SourceClass)` is false against an object of
 * exactly the right kind — measured, and the failure message is the memorable
 * one: *"expected RecordingMailer to be an instance of RecordingMailer"*.
 *
 * There is no third option. A module package publishes no service class by name
 * (D-168), so there is no `dist` spelling for this file to import instead, and
 * `test/helpers/package-entities.ts`' door is for entity classes the ORM
 * registered. The class **name** is what survives the boundary, which is the
 * same property `entityNamed` resolves on.
 *
 * `check:singleton-identity` does not report this, and correctly: its second
 * conjunct is that the platform composed the *reached binding*, and what the
 * container holds here is an **instance** the module's own factory built, not
 * the class. Its header records a third signal — `instanceof` against a
 * source-reached binding — written, measured at three sites, and removed
 * because all three were correct. This is the fourth site, and it is not.
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
    expect(cradle.emailTransport.constructor.name).toBe(
      cradle.emailSmtpUrl ? 'SmtpMailer' : 'ConsoleMailer',
    );
  });

  it('hands every sending module the recording mailer, not the bare driver', () => {
    // D-59 — the delivery record wraps the driver at the registration, so no
    // module can reach a transport that writes no row.
    const cradle = h.container.cradle as unknown as EmailCradle;
    expect(cradle.emailMailer.constructor.name).toBe('RecordingMailer');
    // The half the name cannot carry, and the half that is the actual claim:
    // whatever it is called, it is not the driver the module also registered.
    expect(cradle.emailMailer).not.toBe(cradle.emailTransport);
  });

  it('is a singleton — one transport per composition, not one per resolution', () => {
    const cradle = h.container.cradle as unknown as EmailCradle;
    expect(cradle.emailMailer).toBe(cradle.emailMailer);
  });
});

import type { EntityManager } from '@mikro-orm/postgresql';
import type { EmailDeliveryRecorder, EmailMailerPort } from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/index.js';

import { resolveSmtpUrlFromEnv } from './resolve-smtp-url.js';
import { ConsoleMailer } from './services/mailer.js';
import { PersistentEmailDeliveryRecorder } from './services/email-delivery-recorder.js';
import { RecordingMailer } from './services/recording-mailer.js';
import { SmtpMailer } from './services/smtp-mailer.js';

/**
 * The Email module's backend entry point — converted to feature 072's
 * `registerModule` contract (T079).
 *
 * `email` owns no route and no worker: it is the platform's mailer seam, and
 * everything it contributes is three registrations. Before this conversion the
 * *driver decision* — SMTP when the environment configures one, console
 * otherwise — lived in `composition.ts`, while the test harness and two other
 * modules each carried their own `new ConsoleMailer()` fallback. Four places
 * decided which mailer the platform uses; now the module does.
 *
 * It owns one entity since D-59: the transport is where a message's fate is
 * decided, so it is where the record of that fate belongs.
 */

/** What `email` resolves from the container, and the names it owns. */
export interface EmailCradle {
  /**
   * The nodemailer connection URL, or `null` for the console driver. A
   * registration rather than an inline `process.env` read so a composition
   * root can pin it — the test harness relies on the environment carrying no
   * SMTP configuration, and a name is something it can assert on.
   */
  readonly emailSmtpUrl: string | null;
  readonly emFactory: () => EntityManager;
  /**
   * The driver — SMTP or console. Separated from `emailMailer` by D-59 so the
   * delivery record wraps *the driver*, which is what makes the record
   * unforgettable: a module resolves `emailMailer` and gets the recording one,
   * with no way to reach the bare transport by accident.
   */
  readonly emailTransport: EmailMailerPort;
  /** Where every delivery decision is written (D-59). */
  readonly emailDeliveryRecorder: EmailDeliveryRecorder;
  /**
   * The platform's transactional mailer. Consumed by every sending module,
   * against the `EmailMailerPort` contract since feature 075's Phase P.
   *
   * Still `ctx.di.register` rather than `providePort`: this module's manifest
   * declares it non-deactivatable, so a gate on its effective state could never
   * close, and a port advertising a 503 the platform cannot produce is worse
   * than no port. The contract type says the same thing where a consumer reads
   * it — which is the whole of what Phase P changes here.
   */
  readonly emailMailer: EmailMailerPort;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    emailSmtpUrl: ctx.asFunction((): string | null => resolveSmtpUrlFromEnv()).singleton(),

    // Singleton, matching what the composition root constructed once at boot:
    // `SmtpMailer` holds a nodemailer transport with its own connection pool,
    // and `ConsoleMailer` deduplicates on `messageId`, so both are wrong as
    // per-resolution instances.
    emailTransport: ctx
      .asFunction(
        ({ emailSmtpUrl }: EmailCradle): EmailMailerPort =>
          emailSmtpUrl ? new SmtpMailer(emailSmtpUrl) : new ConsoleMailer(),
      )
      .singleton(),

    // Resolved by `transactional_emails` as well, for the three outcomes it
    // decides before the transport is ever reached. An ordinary registration
    // rather than a `providePort`, exactly like `emailMailer`: `email` is
    // non-deactivatable (074, C3), so a gate over it could never close.
    emailDeliveryRecorder: ctx
      .asFunction(
        ({ emFactory }: EmailCradle): EmailDeliveryRecorder =>
          new PersistentEmailDeliveryRecorder(emFactory),
      )
      .singleton(),

    emailMailer: ctx
      .asFunction(
        ({ emailTransport, emailDeliveryRecorder }: EmailCradle): EmailMailerPort =>
          new RecordingMailer(emailTransport, emailDeliveryRecorder),
      )
      .singleton(),
  });
}

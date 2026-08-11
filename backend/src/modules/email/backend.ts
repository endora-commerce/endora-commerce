import type { ModuleContext } from '../../kernel/index.js';

import { resolveSmtpUrlFromEnv } from './resolve-smtp-url.js';
import { ConsoleMailer, type Mailer } from './services/mailer.js';
import { SmtpMailer } from './services/smtp-mailer.js';

/**
 * The Email module's backend entry point — converted to feature 072's
 * `registerModule` contract (T079).
 *
 * `email` owns no route, no entity and no worker: it is the platform's mailer
 * seam, and everything it contributes is one registration. Before this
 * conversion the *driver decision* — SMTP when the environment configures one,
 * console otherwise — lived in `composition.ts`, while the test harness and two
 * other modules each carried their own `new ConsoleMailer()` fallback. Four
 * places decided which mailer the platform uses; now the module does.
 */

/**
 * Every entity this module owns — none. The mailer is stateless and the
 * transactional email templates belong to `transactional_emails`.
 */
export const entities = [] as const;

/** What `email` resolves from the container, and the names it owns. */
export interface EmailCradle {
  /**
   * The nodemailer connection URL, or `null` for the console driver. A
   * registration rather than an inline `process.env` read so a composition
   * root can pin it — the test harness relies on the environment carrying no
   * SMTP configuration, and a name is something it can assert on.
   */
  readonly emailSmtpUrl: string | null;
  /** The platform's transactional mailer. Consumed by every sending module. */
  readonly emailMailer: Mailer;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    emailSmtpUrl: ctx.asFunction((): string | null => resolveSmtpUrlFromEnv()).singleton(),

    // Singleton, matching what the composition root constructed once at boot:
    // `SmtpMailer` holds a nodemailer transport with its own connection pool,
    // and `ConsoleMailer` deduplicates on `messageId`, so both are wrong as
    // per-resolution instances.
    emailMailer: ctx
      .asFunction(
        ({ emailSmtpUrl }: EmailCradle): Mailer =>
          emailSmtpUrl ? new SmtpMailer(emailSmtpUrl) : new ConsoleMailer(),
      )
      .singleton(),
  });
}

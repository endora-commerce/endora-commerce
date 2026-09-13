/**
 * Why email's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  MAIL_DRIVER: {
    classification: 'configuration' as const,
    reason:
      'Whether this instance delivers mail or prints it. `emailSmtpUrl` is a container ' +
      'singleton (`backend/index.ts:61`), resolved on first use rather than at composition, ' +
      'so the settings store is readable before any of these eight is wanted — none of them ' +
      'has a bootstrap claim. They are all here for one reason: this module ships no ' +
      'settings manifest at all, so there is nowhere for them to go yet. The repair is one ' +
      'merge request — an `email` settings group with a connection, a sender and a driver — ' +
      'and it retires all eight entries below at once.',
  },
  SMTP_URL: {
    classification: 'configuration' as const,
    reason:
      'The whole connection, credentials included, as one value. Retired by the `email` ' +
      'settings group described under `MAIL_DRIVER`; the `secret` value type is what it ' +
      'needs, since this string carries a password.',
  },
  SMTP_HOST: {
    classification: 'configuration' as const,
    reason: 'Part of the connection assembled when `SMTP_URL` is unset. Retired with `MAIL_DRIVER`.',
  },
  SMTP_PORT: {
    classification: 'configuration' as const,
    reason: 'Part of the connection assembled when `SMTP_URL` is unset. Retired with `MAIL_DRIVER`.',
  },
  SMTP_USER: {
    classification: 'configuration' as const,
    reason: 'Part of the connection assembled when `SMTP_URL` is unset. Retired with `MAIL_DRIVER`.',
  },
  SMTP_PASSWORD: {
    classification: 'configuration' as const,
    reason:
      'Part of the connection assembled when `SMTP_URL` is unset, and the one secret among ' +
      'the five. Retired with `MAIL_DRIVER`, into a `secret`-typed Setting.',
  },
  SMTP_FROM: {
    classification: 'configuration' as const,
    reason:
      'The sender address, read at `services/smtp-mailer.ts:22` on every send. A shop’s own ' +
      'return address is operator content if anything in this ledger is. Retired with ' +
      '`MAIL_DRIVER`.',
  },
  MAIL_FROM: {
    classification: 'configuration' as const,
    reason:
      'The same address under an older spelling, read where `SMTP_FROM` is unset. It is two ' +
      'names for one fact and the settings group is where they become one; until then both ' +
      'are declared, because a client whose `.env` carries only this one still has a working ' +
      'sender and would be told nothing by a declaration that omitted it.',
  },
};

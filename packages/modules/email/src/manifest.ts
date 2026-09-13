import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Email module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'email',
  name: 'Email',
  description:
    'Mailer abstraction with Console / SMTP drivers for transactional email.',
  version: '1.0.0',
  /**
   * What this module needs from the environment (`specs/117-instance-bring-up/`
   * FR-002). Only what it **owns**: its reads of platform-owned names are
   * satisfied by `packages/platform/src/env/index.ts`.
   *
   * Why each of these is not a Setting is its entry in
   * `backend/scripts/ledgers/module-environment-inputs/email.ts`.
   */
  env: [
    {
      name: 'MAIL_DRIVER',
      describes: {
        en: 'How outgoing mail leaves this instance; `console` writes messages to the log instead of delivering them.',
        pl: 'W jaki sposób poczta wychodząca opuszcza tę instancję; wartość `console` zapisuje wiadomości do logu zamiast je wysyłać.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'There is no way to stop a development instance from attempting real delivery to real addresses.',
          pl: 'Nie ma jak powstrzymać instancji deweloperskiej przed próbą wysyłki na prawdziwe adresy.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'SMTP_URL',
      describes: {
        en: 'The whole SMTP connection as one URL, credentials included.',
        pl: 'Całe połączenie SMTP jako jeden adres URL, wraz z poświadczeniami.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The connection has to be assembled from the separate host, port, user and password variables instead.',
          pl: 'Połączenie trzeba wtedy złożyć z osobnych zmiennych: hosta, portu, użytkownika i hasła.',
        },
      },
      secret: true,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'SMTP_HOST',
      describes: {
        en: 'The host name of the SMTP relay that delivers this shop’s mail.',
        pl: 'Nazwa hosta serwera SMTP, który dostarcza pocztę tego sklepu.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'No connection can be assembled from the separate fields, so nothing is delivered unless `SMTP_URL` carries the whole connection.',
          pl: 'Z osobnych pól nie da się złożyć połączenia, więc nic nie zostanie dostarczone, o ile `SMTP_URL` nie zawiera całego połączenia.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'SMTP_PORT',
      describes: {
        en: 'The port the SMTP relay listens on.',
        pl: 'Port, na którym nasłuchuje serwer SMTP.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'No connection can be assembled from the separate fields, so nothing is delivered unless `SMTP_URL` carries the whole connection.',
          pl: 'Z osobnych pól nie da się złożyć połączenia, więc nic nie zostanie dostarczone, o ile `SMTP_URL` nie zawiera całego połączenia.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'SMTP_USER',
      describes: {
        en: 'The account this instance authenticates to the SMTP relay as.',
        pl: 'Konto, na którym ta instancja uwierzytelnia się w serwerze SMTP.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The relay is addressed with no credentials, which a public relay refuses.',
          pl: 'Serwer jest odpytywany bez poświadczeń, czego publiczny serwer odmawia.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'SMTP_PASSWORD',
      describes: {
        en: 'The password for the SMTP account.',
        pl: 'Hasło do konta SMTP.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The relay is addressed with no credentials, which a public relay refuses.',
          pl: 'Serwer jest odpytywany bez poświadczeń, czego publiczny serwer odmawia.',
        },
      },
      secret: true,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'SMTP_FROM',
      describes: {
        en: 'The address outgoing mail is sent from.',
        pl: 'Adres, z którego wychodzi poczta.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'Mail leaves under the platform’s placeholder address, which a relay commonly rejects as unroutable.',
          pl: 'Poczta wychodzi spod zastępczego adresu platformy, który serwer pocztowy zwykle odrzuca jako nieroutowalny.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'MAIL_FROM',
      describes: {
        en: 'The address outgoing mail is sent from, read where `SMTP_FROM` is unset.',
        pl: 'Adres, z którego wychodzi poczta, odczytywany, gdy `SMTP_FROM` nie jest ustawiony.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'Mail leaves under the platform’s placeholder address, which a relay commonly rejects as unroutable.',
          pl: 'Poczta wychodzi spod zastępczego adresu platformy, który serwer pocztowy zwykle odrzuca jako nieroutowalny.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'email' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
  dependencies: [],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. This module
  // had no activation declaration at all, which resolved as "always activated"
  // and read as an omission. It is the outbound transport every message leaves
  // through: a business configures a driver — Console, SMTP — it does not
  // switch the transport off, and the per-message choice belongs to
  // `transactional_emails`, which offers it per email.
  activation: {
    nonDeactivatable: true,
    reason:
      'The outbound transport every message leaves through. A business configures a driver; ' +
      'it does not switch the transport off.',
  },
});

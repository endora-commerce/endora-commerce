/**
 * What a running Endora host needs from its environment — the platform's half
 * of the declaration (feature 117, FR-001; `environment-inputs.md` §R2.1).
 *
 * ## Why this exists at all
 *
 * `backend/src/index.ts` already tells an operator that a failed boot *"is
 * almost always a configuration problem (a required secret/env var missing or
 * malformed)"* and cannot name the variable, because until this file there was
 * no list. Three `.env.example` files are prose, a module package ships no
 * `.env.example` at all, and an instance's `.env` therefore could not be
 * written correctly by anybody — us included.
 *
 * ## What is in here and what is not
 *
 * Exactly the inputs read under `backend/src` and `packages/platform/src`.
 * Measured, not curated: `check:env-inputs` reconciles this array against
 * every `process.env` read in those two trees, **both ways**, so an
 * undeclared read and a declared input nothing reads are each a build failure.
 * A module's inputs are the module's own (`manifest.ts`), and each
 * application's are its own — three authors, one shape, no central list.
 *
 * ## No defaults live here (§R1.3)
 *
 * The `??` fallbacks in the tree are a separate repair and this file is not
 * their second home. A declaration that carried a default would be the thing
 * `defaulted=0` exists to make impossible.
 *
 * ## Two things this population taught, worth stating rather than rediscovering
 *
 * **`requirement` has no "one of these two" term**, and the tree has a real
 * pair: `BACKEND_PUBLIC_URL` and `PUBLIC_API_BASE_URL` are read in that order
 * by `absolutizePublicUrl`, and production refuses to boot when *neither* is
 * set. It is written below as one `required` input and one `optional` synonym
 * that says what it overrides, which is faithful about the obligation and
 * slightly overstates which spelling carries it.
 *
 * **A shared secret is not `generable`.** `REVALIDATE_SECRET` is one string in
 * two repositories; a command that generated it per tree would write two
 * different values and each tree would be internally consistent and jointly
 * wrong. `input-resolution.md` R4.1's test — *are two correct values
 * interchangeable* — is answered per **environment**, and for a value two
 * environments must share the answer is no.
 *
 * **The one exception is a command, not a change to this field.** A single
 * run that writes **both** trees is one environment, so the premise *"two
 * environments"* does not hold of it: `endora install` generates this secret
 * once and writes the same value into both `.env` files
 * (`input-resolution.md` R4.6, ruled 2026-09-25 as D-269). The field stays
 * `false` because it describes the input to every other consumer, and every
 * other command still may not generate it.
 */
import type { EnvironmentInput } from '@endora-commerce/contracts';

/**
 * The 23 inputs the host and the platform read.
 *
 * Order is the order a prompt asks in: the values without which nothing runs
 * first, then the addresses the platform composes links from, then the knobs.
 * An operator meeting this for the first time is asked for the database before
 * they are asked about proxy hops.
 *
 * The last two arrived with the liveness probe (D-229), which used to be the
 * `health_checks` module and is now `http/health.ts`. Their sentences are that
 * manifest's, carried across rather than rewritten: they were written for this
 * probe and a rewrite would be a translation round-trip for no gain.
 */
export const PLATFORM_ENVIRONMENT_INPUTS: readonly EnvironmentInput[] = [
  {
    name: 'DATABASE_URL',
    describes: {
      en: 'The PostgreSQL database this instance stores everything in, as a connection URL.',
      pl: 'Baza PostgreSQL, w której ta instancja przechowuje wszystko, jako URL połączenia.',
    },
    requirement: { kind: 'required' },
    // The URL carries the password. Treated as a secret so it is never echoed,
    // even though the host and port halves of it are not sensitive.
    secret: true,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'REDIS_URL',
    describes: {
      en: 'The Redis this instance uses for caching and for its background job queues.',
      pl: 'Redis używany przez tę instancję do cache i kolejek zadań w tle.',
    },
    requirement: { kind: 'required' },
    secret: true,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'SESSION_COOKIE_SECRET',
    describes: {
      en: "The key this instance signs session cookies with. Changing it signs every operator and customer out.",
      pl: 'Klucz, którym ta instancja podpisuje ciasteczka sesji. Zmiana wylogowuje wszystkich operatorów i klientów.',
    },
    requirement: { kind: 'required' },
    secret: true,
    // The one class `input-resolution.md` §4 permits: its only required
    // properties are that it is unguessable and per-environment, and two random
    // keys are interchangeable. It is never generated at boot (R4.4) — a
    // signing key that changed on restart would invalidate every session.
    generable: true,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'PUBLIC_API_BASE_URL',
    describes: {
      en: "The origin this backend is reachable at from the public internet. Payment gateways call back to it and outbound e-mail links are built from it.",
      pl: 'Adres, pod którym backend jest dostępny z internetu. Bramki płatnicze wywołują go zwrotnie, a linki w wysyłanych e-mailach są z niego budowane.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: 'backend',
  },
  {
    name: 'CORS_ALLOWED_ORIGINS',
    describes: {
      en: "The origins allowed to call this backend from a browser, comma-separated. The storefront's and the admin's own addresses go here — including when they are hosted elsewhere.",
      pl: 'Adresy, które mogą wywoływać ten backend z przeglądarki, rozdzielone przecinkami. Należą tu adresy sklepu i panelu administracyjnego — także wtedy, gdy są hostowane gdzie indziej.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    // Read by the backend, and by the backend alone. Its *value* names the
    // other two trees, which is exactly why a rule keyed on the spelling would
    // scope it wrongly — see `environment-inputs.ts`' header.
    consumers: ['backend'],
    // `null`, and the near miss earns the line: the value is a **list** of
    // origins and two of them are members. "The address of" is singular, so a
    // consumer that pointed every storefront address at one place would collapse
    // this list to one entry and lock the admin out of its own backend.
    addressOf: null,
  },
  {
    name: 'STOREFRONT_BASE_URL',
    describes: {
      en: 'The address of the storefront this backend serves, used for the links it puts in e-mail and for on-demand page revalidation.',
      pl: 'Adres sklepu obsługiwanego przez ten backend, używany w linkach wysyłanych e-mailem i przy odświeżaniu stron na żądanie.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: 'storefront',
  },
  {
    name: 'REVALIDATE_SECRET',
    describes: {
      en: 'The shared key the backend authenticates itself with when it asks the storefront to refresh a cached page. It must be the same string in both trees.',
      pl: 'Wspólny klucz, którym backend uwierzytelnia się, prosząc sklep o odświeżenie strony z cache. W obu drzewach musi to być ten sam ciąg.',
    },
    requirement: { kind: 'required' },
    secret: true,
    // Deliberately not generable — see this file's header. One string, two
    // repositories, and a per-tree generator writes two.
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend', 'storefront'],
    addressOf: null,
  },
  {
    name: 'DEFAULT_SALES_CHANNEL_CODE',
    describes: {
      en: 'The code of the sales channel this instance serves by default. Every storefront request that names no channel is answered on it.',
      pl: 'Kod domyślnego kanału sprzedaży tej instancji. Każde żądanie sklepu, które nie wskazuje kanału, jest obsługiwane na nim.',
    },
    // A channel always exists (D-47…D-51) and Constitution XII forbids a
    // "no channel" path, so an unset code is a **required input missing** and
    // never a value anybody may invent.
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'BACKEND_PUBLIC_URL',
    describes: {
      en: 'An override for the public origin, read in preference to PUBLIC_API_BASE_URL. Set it when the address the backend advertises differs from the one it is called at.',
      pl: 'Nadpisanie publicznego adresu, odczytywane przed PUBLIC_API_BASE_URL. Ustaw je, gdy adres ogłaszany przez backend różni się od tego, pod którym jest wywoływany.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the public origin is PUBLIC_API_BASE_URL, which is the usual case.',
        pl: 'publicznym adresem jest PUBLIC_API_BASE_URL, co jest zwykłym przypadkiem.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: 'backend',
  },
  {
    name: 'SETTINGS_SECRET_ENCRYPTION_KEY',
    describes: {
      en: 'The key settings marked secret are encrypted with at rest — an API token a module stores, for instance. Base64, 32 bytes.',
      pl: 'Klucz, którym szyfrowane są ustawienia oznaczone jako sekretne — na przykład token API zapisany przez moduł. Base64, 32 bajty.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'secret settings cannot be read or written, so any module configured through one stops working.',
        pl: 'nie można odczytać ani zapisać ustawień z sekretami, więc każdy moduł konfigurowany w ten sposób przestaje działać.',
      },
    },
    secret: true,
    generable: true,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'NEWSLETTER_TOKEN_SECRET',
    describes: {
      en: 'The key newsletter confirmation and unsubscribe links are signed with.',
      pl: 'Klucz, którym podpisywane są linki potwierdzenia i wypisania z newslettera.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'newsletter links are signed with the session key instead, so rotating that key invalidates every outstanding confirmation link.',
        pl: 'linki newslettera są podpisywane kluczem sesji, więc jego rotacja unieważnia wszystkie niepotwierdzone jeszcze linki.',
      },
    },
    secret: true,
    generable: true,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'SALES_CHANNEL_HOST_MAP',
    describes: {
      en: 'Which hostname serves which sales channel, as comma-separated `host=code` pairs, for an instance serving several storefronts from one backend.',
      pl: 'Która nazwa hosta obsługuje który kanał sprzedaży, jako pary `host=kod` rozdzielone przecinkami, dla instancji obsługującej kilka sklepów z jednego backendu.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'a request that names no channel is answered on the default one, so several storefronts cannot be told apart by their hostname.',
        pl: 'żądanie bez wskazanego kanału jest obsługiwane na kanale domyślnym, więc kilku sklepów nie da się rozróżnić po nazwie hosta.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'PORT',
    describes: {
      en: 'The TCP port the backend listens on.',
      pl: 'Port TCP, na którym nasłuchuje backend.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the port cannot be chosen, so two instances cannot run side by side on one host.',
        pl: 'nie można wybrać portu, więc dwie instancje nie uruchomią się obok siebie na jednym hoście.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'BACKEND_ROLE',
    describes: {
      en: 'Which half of the backend this process runs: the HTTP API, the background workers, or both.',
      pl: 'Którą część backendu uruchamia ten proces: API HTTP, procesy w tle, czy oba.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'one process serves the API and runs every queue consumer, so the two cannot be scaled or restarted separately.',
        pl: 'jeden proces obsługuje API i wszystkie kolejki, więc nie da się ich skalować ani restartować osobno.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'TRUSTED_PROXY_HOPS',
    describes: {
      en: 'How many reverse proxies sit in front of this backend, so it knows which forwarded address is really the client.',
      pl: 'Ile odwrotnych proxy stoi przed tym backendem, aby wiedział, który przekazany adres jest naprawdę adresem klienta.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the client address is whoever opened the socket, so behind a proxy every request looks as if it came from the proxy — which is what rate limiting and audit records then say.',
        pl: 'adresem klienta jest ten, kto otworzył połączenie, więc za proxy każde żądanie wygląda, jakby przyszło od proxy — i tak zapiszą je limity oraz dziennik audytu.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'TRUSTED_PROXY_ADDRESSES',
    describes: {
      en: 'Which proxy addresses or ranges this backend believes about the client address, instead of counting hops.',
      pl: 'Którym adresom lub zakresom proxy backend wierzy w kwestii adresu klienta, zamiast liczyć przeskoki.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the client address is whoever opened the socket, unless a hop count is configured instead.',
        pl: 'adresem klienta jest ten, kto otworzył połączenie, chyba że skonfigurowano zamiast tego liczbę przeskoków.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'BACKEND_RATE_LIMIT_MAX',
    describes: {
      en: 'How many requests one client may make in the rate-limiting window.',
      pl: 'Ile żądań może wykonać jeden klient w oknie limitowania.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: "the limit cannot be tuned to this instance's traffic.",
        pl: 'limitu nie da się dostroić do ruchu tej instancji.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'BACKEND_RATE_LIMIT_DISABLED',
    describes: {
      en: 'Turns request rate limiting off entirely. Intended for load testing, never for a served instance.',
      pl: 'Całkowicie wyłącza limitowanie żądań. Przeznaczone do testów obciążeniowych, nigdy dla działającej instancji.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'rate limiting stays on, which is what a served instance wants.',
        pl: 'limitowanie żądań pozostaje włączone, czego oczekuje działająca instancja.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'LOG_LEVEL',
    describes: {
      en: 'How much the backend writes to its log.',
      pl: 'Jak dużo backend zapisuje w dzienniku.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the log carries the platform default, which is enough to see requests and errors but not to trace one.',
        pl: 'dziennik ma domyślny poziom platformy, wystarczający, by widzieć żądania i błędy, ale nie by prześledzić jedno z nich.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'DB_DEBUG',
    describes: {
      en: 'Logs every SQL statement the backend runs, in development.',
      pl: 'Loguje każde zapytanie SQL wykonywane przez backend, w trybie deweloperskim.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'SQL statements are not logged, so a slow or wrong query has to be found another way.',
        pl: 'zapytania SQL nie są logowane, więc wolne lub błędne zapytanie trzeba znaleźć inaczej.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'NODE_ENV',
    describes: {
      en: "Which mode the backend runs in. `production` turns on the checks that refuse to boot on a missing secret; anything else is a development run.",
      pl: 'W jakim trybie działa backend. `production` włącza kontrole, które odmawiają startu przy brakującym sekrecie; każda inna wartość to uruchomienie deweloperskie.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the backend runs as a development instance, which is the wrong posture for a served one: the boot-time refusals that protect a production secret do not apply.',
        pl: 'backend działa jak instancja deweloperska, co jest złą postawą dla działającego sklepu: nie obowiązują wtedy kontrole startowe chroniące produkcyjne sekrety.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    // The storefront reads its own `NODE_ENV` on its own process and declares
    // it itself. The two are not one value two trees must agree about — they
    // are two processes, possibly on two machines — so this entry names the
    // backend alone. `REVALIDATE_SECRET` above is the contrasting case.
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'MEILISEARCH_URL',
    describes: {
      en: 'Where the health endpoint looks for the search engine when it reports whether this instance is whole.',
      pl: 'Gdzie punkt kontroli stanu szuka silnika wyszukiwania, gdy raportuje, czy ta instancja jest sprawna.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'The probe reaches for the search engine at the platform’s own address, so a shop that runs it elsewhere is reported degraded while it is working.',
        pl: 'Sonda szuka silnika wyszukiwania pod adresem wbudowanym w platformę, więc sklep, który uruchamia go gdzie indziej, jest raportowany jako niesprawny, choć działa.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
  {
    name: 'npm_package_version',
    describes: {
      en: 'The version this instance reports in its health payload. The package manager sets it when it starts the server; an operator has nothing to choose here.',
      pl: 'Wersja, którą ta instancja podaje w odpowiedzi kontroli stanu. Ustawia ją menedżer pakietów przy starcie serwera; operator nie ma tu nic do wyboru.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'The health payload carries no usable version, so one deployment cannot be told apart from the one before it.',
        pl: 'Odpowiedź kontroli stanu nie niesie użytecznej wersji, więc nie da się odróżnić jednego wdrożenia od poprzedniego.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
];

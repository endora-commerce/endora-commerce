/**
 * What this storefront needs from its environment (feature 117, FR-001;
 * `specs/117-instance-bring-up/contracts/environment-inputs.md` §R2.3).
 *
 * ## This file is yours
 *
 * Under D-195 a client's storefront is a repository they own outright, copied
 * out of the reference tree by `endora new storefront`. So this declaration
 * travels **in** the copy and is edited there like everything else in it: add
 * a variable your storefront reads and declare it here, and the tooling that
 * writes your `.env` and the doctor that checks it both learn about it. There
 * is no central list anywhere that has to be updated too.
 *
 * ## Why `.mjs`
 *
 * The same reason `lib/env.mjs` is: this is read by `endora new storefront`
 * before the tree it describes has been installed or built, and by
 * `next.config.js`' own Node process. A `.ts` file would need a compiler that
 * a scaffolded instance does not have — measured, as a red A5 on that
 * command's acceptance criterion. JSDoc gives it the same types the rest of
 * the tree compiles against.
 *
 * ## `describes` is what an operator is asked, verbatim
 *
 * Not what the code does with the value: what the person typing it is
 * choosing. Both shipped languages, because the prompt is read by whoever runs
 * the command.
 *
 * @typedef {import('@endora-commerce/contracts').EnvironmentInput} EnvironmentInput
 */

/**
 * The twelve variables this storefront reads.
 *
 * Order is the order a prompt asks in: the two addresses without which nothing
 * works, then the shop's own identity, then the knobs.
 *
 * @type {readonly EnvironmentInput[]}
 */
export const STOREFRONT_ENVIRONMENT_INPUTS = [
  {
    name: 'NEXT_PUBLIC_API_BASE_URL',
    describes: {
      en: "The address a visitor's browser calls the backend at. Next writes it into the browser bundle when the storefront is built, so it cannot be changed afterwards without building again.",
      pl: 'Adres, pod którym przeglądarka odwiedzającego wywołuje backend. Next zapisuje go w paczce przeglądarkowej podczas budowania sklepu, więc później nie da się go zmienić bez ponownego budowania.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'BACKEND_BASE_URL',
    describes: {
      en: "The address this storefront's own server calls the backend at. It is read while the storefront runs, so a container can set it at start-up.",
      pl: 'Adres, pod którym serwer tego sklepu wywołuje backend. Jest odczytywany w trakcie działania, więc kontener może go ustawić przy starcie.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'NEXT_PUBLIC_SITE_URL',
    describes: {
      en: 'The public address this storefront is served at. Search engines are told it in every canonical link, in the sitemap and in robots.txt.',
      pl: 'Publiczny adres, pod którym serwowany jest ten sklep. Wyszukiwarki dostają go w każdym linku kanonicznym, w mapie strony i w robots.txt.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'NEXT_PUBLIC_SALES_CHANNEL_CODE',
    describes: {
      en: 'Which sales channel this storefront sells on. It decides the catalogue, the prices and the languages a visitor sees, and it must be a channel the backend knows.',
      pl: 'Na którym kanale sprzedaży działa ten sklep. Decyduje o katalogu, cenach i językach widocznych dla odwiedzającego i musi być kanałem znanym backendowi.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'REVALIDATE_SECRET',
    describes: {
      en: 'The shared key the backend proves itself with when it asks this storefront to refresh a cached page. It must be the same string the backend has.',
      pl: 'Wspólny klucz, którym backend potwierdza swoją tożsamość, prosząc ten sklep o odświeżenie strony z cache. Musi to być ten sam ciąg, który ma backend.',
    },
    requirement: { kind: 'required' },
    secret: true,
    // Not generable, and the reason is the word "shared": one string lives in
    // two repositories, and a command that generated it per tree would write
    // two different values — each tree internally consistent, the pair silently
    // broken. `input-resolution.md` R4.1's test is whether two correct values
    // are interchangeable, and for a value two environments must share, no.
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['backend', 'storefront'],
  },
  {
    name: 'NEXT_PUBLIC_APP_NAME',
    describes: {
      en: "The shop's name, as it appears when a visitor installs this storefront as an app on their phone.",
      pl: 'Nazwa sklepu widoczna, gdy odwiedzający instaluje ten sklep jako aplikację na telefonie.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'an installed shortcut carries the platform default rather than the name of this shop.',
        pl: 'zainstalowany skrót ma domyślną nazwę platformy zamiast nazwy tego sklepu.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'NEXT_PUBLIC_APP_SHORT_NAME',
    describes: {
      en: "The short form of the shop's name, used under the icon where there is no room for the full one.",
      pl: 'Skrócona nazwa sklepu, używana pod ikoną, gdzie nie mieści się pełna.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the full name is used and is truncated by the phone wherever it does not fit.',
        pl: 'używana jest pełna nazwa, którą telefon obcina wszędzie, gdzie się nie mieści.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'NEXT_PUBLIC_BACKEND_BASE_URL',
    describes: {
      en: 'An override for the browser-facing backend address, for a deployment whose browser traffic reaches the backend by a different route than its build-time address.',
      pl: 'Nadpisanie adresu backendu dla przeglądarki, dla wdrożenia, w którym ruch z przeglądarki dociera do backendu inną drogą niż adres z czasu budowania.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the browser calls the address NEXT_PUBLIC_API_BASE_URL names, which is the usual case.',
        pl: 'przeglądarka wywołuje adres wskazany przez NEXT_PUBLIC_API_BASE_URL, co jest zwykłym przypadkiem.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'STOREFRONT_URL',
    describes: {
      en: 'A second spelling of the public address, read when NEXT_PUBLIC_SITE_URL is not set. The browser test suites already use it.',
      pl: 'Druga pisownia publicznego adresu, odczytywana, gdy nie ustawiono NEXT_PUBLIC_SITE_URL. Używają jej już zestawy testów przeglądarkowych.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'the public address is NEXT_PUBLIC_SITE_URL, which is what an operator sets.',
        pl: 'publicznym adresem jest NEXT_PUBLIC_SITE_URL, który ustawia operator.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'NEXT_PUBLIC_BUILD_ID',
    describes: {
      en: 'A label for this build, so a visitor whose browser is holding an old offline copy of the shop is given the new one.',
      pl: 'Etykieta tego wydania, dzięki której odwiedzający z zapisaną starą kopią offline dostaje nową.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: "an offline copy is refreshed on the browser's own schedule, so a visitor can see yesterday's shop for a while after a deployment.",
        pl: 'kopia offline odświeża się według harmonogramu przeglądarki, więc odwiedzający może przez chwilę po wdrożeniu widzieć wczorajszy sklep.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
  {
    name: 'NODE_ENV',
    describes: {
      en: 'Which mode this storefront runs in. The toolchain sets it: `next build` and `next start` say production, `next dev` says development.',
      pl: 'W jakim trybie działa ten sklep. Ustawia to narzędzie: `next build` i `next start` oznaczają produkcję, `next dev` — tryb deweloperski.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'Next decides it from the command being run, which is what you want; setting it by hand is how a production build ends up serving development output.',
        pl: 'Next ustala go na podstawie uruchamianego polecenia, i tak jest dobrze; ustawianie go ręcznie prowadzi do tego, że produkcyjne wydanie serwuje wynik deweloperski.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    // Read on this storefront's own process. It is *not* a value the backend
    // and the storefront must agree about — two processes, possibly two
    // machines — so it names one consumer and the backend declares its own.
    // `REVALIDATE_SECRET` above is the contrasting case, and the difference is
    // what §5's cross-tree derivation runs on.
    consumers: ['storefront'],
  },
  {
    name: 'NEXT_RUNTIME',
    describes: {
      en: 'Which of its two runtimes Next is currently executing. Next sets it; there is nothing here for an operator to choose.',
      pl: 'Które ze swoich dwóch środowisk uruchomieniowych wykonuje właśnie Next. Ustawia je Next; operator nie ma tu nic do wyboru.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: 'nothing: it is declared because this storefront reads it, and every read is declared. Setting it by hand can only be wrong.',
        pl: 'nic: jest zadeklarowane, ponieważ ten sklep je odczytuje, a każdy odczyt jest deklarowany. Ustawienie go ręcznie może być tylko błędem.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
  },
];

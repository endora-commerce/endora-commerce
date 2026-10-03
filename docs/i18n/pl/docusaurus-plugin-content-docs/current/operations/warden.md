---
title: Praca lokalna z Warden
description: Uruchamianie usług Endora Commerce w Warden (Traefik, HTTPS *.test), podczas gdy aplikacje działają na komputerze przez pnpm.
---

# Praca lokalna z Warden

To repozytorium to **monorepo pnpm**. Backend, storefront i panel administracyjny korzystają z
jednego API i jednego zestawu baz danych — dlatego jest **jedno** środowisko Warden
(`WARDEN_ENV_TYPE=local`), a nie osobny projekt dla każdej aplikacji.

| Warstwa | Gdzie działa |
| --- | --- |
| Usługi | Warden: PostgreSQL 16, Redis 7, Meilisearch, Mailhog |
| Aplikacje | Komputer lokalny: `pnpm run dev` (backend :3001, storefront :3000, panel :3002) |
| Wejście HTTPS (opcjonalnie) | Traefik → proxy nginx w `.warden/` → porty na komputerze |

Zwykły Docker Compose (`pnpm run dev:infra`) nadal jest obsługiwany i w codziennej pracy bez HTTPS
`*.test` działa tak samo. **Nie uruchamiaj Compose i Warden jednocześnie** — zajmują te same domyślne
porty.

## Wymagania wstępne

- [Warden](https://docs.warden.dev/) ≥ 0.15 (`brew install wardenenv/warden/warden`)
- Działający Docker Engine
- Node.js ≥ 22.17 i pnpm ≥ 9 (zobacz `README.md` w katalogu głównym)
- Przy pierwszym użyciu: `warden svc up` (Traefik, dnsmasq, Mailpit UI, Portainer)

## Jednorazowa konfiguracja

```bash
# Z katalogu głównego monorepo
cp .env.warden.example .env
warden sign-certificate endora.test   # zaufaj *.endora.test w przeglądarce
warden env up -d

pnpm install
cp backend/.env.example    backend/.env
cp storefront/.env.example storefront/.env
cp admin/.env.example      admin/.env
```

Można też uruchomić `warden env-init endora local`, a potem przenieść wartości z
`.env.warden.example` do wygenerowanego `.env` (zwłaszcza flagę `WARDEN_ELASTICHQ=0` i pokrewne —
bez nich Warden uruchamia niepotrzebny kontener ElasticHQ nawet w środowiskach `local`).

Sprawdź usługi:

```bash
warden env ps
# postgres / redis / meilisearch / mailhog / nginx_* powinny być healthy
```

### Baza danych i dane demonstracyjne

```bash
pnpm --filter backend run migration:up   # lub: db:fresh  (destrukcyjne)
pnpm --filter backend run cli demo seed
```

Polecenie wypisuje dane logowania do wersji demonstracyjnej. `endora demo reset` usuwa to, co
utworzyło — uruchom je przed ponownym wypełnieniem bazy danymi demonstracyjnymi.

## Codzienna praca

```bash
warden svc up          # raz po bootcie maszyny, jeśli globalne są down
warden env up -d       # infrastruktura projektu
pnpm run dev           # backend + storefront + admin
```

| Aplikacja | localhost | HTTPS przez Traefik |
| --- | --- | --- |
| Storefront | http://localhost:3000 | https://www.endora.test / https://endora.test |
| Backend API | http://localhost:3001 | https://api.endora.test |
| Panel administracyjny | http://localhost:3002 | https://admin.endora.test |
| Mailhog UI | http://localhost:8025 | https://mail.endora.test |
| Meilisearch | http://localhost:7700 | https://meilisearch.endora.test |
| Warden Traefik | — | https://traefik.warden.test |
| Warden webmail (global) | — | https://webmail.warden.test |

Adresy `localhost` działają z domyślnymi przykładowymi plikami `.env` aplikacji. Adresy przez
Traefik wymagają zmian CORS i publicznych adresów opisanych w następnej sekcji.

Zatrzymanie:

```bash
# Ctrl+C zatrzymuje pnpm run dev
warden env down          # zachowaj wolumeny
warden env down -v       # wyczyść też dane postgres / redis / meilisearch
```

## Korzystanie z `*.endora.test` (HTTPS)

Skieruj aplikacje na nazwy hostów obsługiwane przez Traefik, aby ciasteczka, CORS i bezwzględne
linki odpowiadały temu, co widzi przeglądarka.

Adresy używane przez przeglądarkę wskazują hosty Traefik; **adresy używane między serwerami
pozostają na `http://localhost:<port>`**. Node nie korzysta z systemowego magazynu zaufanych
certyfikatów, więc `fetch` po stronie serwera pod `https://…​.test` kończy się błędem
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, chyba że wyeksportujesz urząd certyfikacji Warden (zobacz
niżej).

**`backend/.env`** (zmiany względem przykładu):

```bash
CORS_ALLOWED_ORIGINS=https://www.endora.test,https://endora.test,https://admin.endora.test,http://localhost:3000,http://localhost:3002
BACKEND_PUBLIC_URL=https://api.endora.test
ADMIN_BASE_URL=https://admin.endora.test
STOREFRONT_BASE_URL=http://localhost:3000   # backend fetchuje to server-side
SMTP_URL=smtp://localhost:1025
```

**`storefront/.env`**:

```bash
BACKEND_BASE_URL=http://localhost:3001              # server components / server actions
NEXT_PUBLIC_API_BASE_URL=https://api.endora.test    # browser
```

### Wszystkie adresy na `*.test`

Wyeksportuj główny certyfikat urzędu certyfikacji Warden **w powłoce** przed `pnpm run dev` —
wpisanie go do `.env` nie działa, bo Node odczytuje `NODE_EXTRA_CA_CERTS` przy starcie, zanim
przetworzy `--env-file`:

```bash
export NODE_EXTRA_CA_CERTS="$HOME/.warden/ssl/rootca/certs/ca.cert.pem"
pnpm run dev
```

Po eksporcie `BACKEND_BASE_URL` i `STOREFRONT_BASE_URL` mogą wskazywać hosty `https://…​.test`.

**`admin/.env`**:

```bash
# Trzymaj API na localhost — session cookies są SameSite=Lax i Secure=false
# w development; cross-site hop do https://api.…​.test daje login 200
# a potem /admin/me 401. Otwieraj admin pod http://localhost:3002.
VITE_API_BASE_URL=http://localhost:3001
VITE_STOREFRONT_BASE_URL=http://localhost:3000
```

Aby panel administracyjny działał przez Traefik (`https://admin.…​.test` → `https://api.…​.test`),
potrzebne są też ciasteczka sesji z flagą `Secure` (i ewentualnie `SameSite=None`, tylko gdy oba
hosty są traktowane jako różne witryny). Dziś nie da się tego włączyć zmienną środowiskową — dopóki
to nie powstanie, otwieraj panel przez localhost.

Adresy połączeń z usługami pozostają na **localhost** (udostępnione porty) —

```bash
DATABASE_URL=postgresql://b2b:b2b@localhost:5432/b2b
REDIS_URL=redis://localhost:6379
MEILISEARCH_URL=http://localhost:7700
```

— bo procesy Node działają na komputerze, a nie w sieci Compose.

Jeśli przeładowywanie na żywo w Vite lub Next.js działa dziwnie za Traefik, dla aplikacji, którą
właśnie edytujesz, używaj adresów `localhost`; CORS w API już pozwala na oba.

## Build

Te same polecenia co bez Warden — usługi są potrzebne tylko wtedy, gdy dany krok korzysta z bazy
danych albo Redis:

```bash
pnpm -r run typecheck
pnpm -r run lint
pnpm -r run build

pnpm --filter @endora-commerce/cms-components build   # po zmianach klas komponentów CMS
pnpm --filter backend run test            # wymaga postgres (+ redis dla części suite)
```

Obrazy produkcyjne i konfiguracja wdrożenia Compose są w `deploy/` — Warden służy **wyłącznie do
pracy lokalnej**.

## Dlaczego nie dwa środowiska Warden?

| Pomysł | Dlaczego tu słabo pasuje |
| --- | --- |
| Osobne projekty Warden dla `backend` i `storefront` | Jest jeden Postgres, Redis i Meilisearch; podział podwaja porty i rozbieżności w konfiguracji środowiska |
| Node w osobnym kontenerze dla każdej aplikacji | Możliwe, ale przeładowywanie na żywo jest wolniejsze w WSL i koliduje z istniejącym skryptem uruchomieniowym `scripts/dev.mjs` |

Traktuj **backend, storefront i panel administracyjny** jako procesy, a **Warden** jako wspólną
warstwę danych i wejście HTTPS.

## Kolizje portów i druga kopia repozytorium

Zmień wartości `*_PORT` w głównym pliku `.env` (utworzonym z `.env.warden.example`), zadbaj o
unikalną `WARDEN_ENV_NAME` i ponownie podpisz certyfikat, jeśli zmieniasz `TRAEFIK_DOMAIN`:

```bash
warden sign-certificate other-endora.test
warden env up -d
```

Dostosuj `backend/.env`, `storefront/.env` i `admin/.env` do nowych portów.

## Powrót do samego Compose

```bash
warden env down
cp .env.example .env          # opcjonalnie — tylko jeśli potrzebujesz niestandardowych portów
pnpm run dev:infra
pnpm run dev
```

## Rozwiązywanie problemów

- **`Docker does not appear to be running`** — uruchom Docker Desktop / Engine, potem `warden svc up`.
- **502 z `https://api.endora.test`** — `pnpm run dev` nie jest uruchomione albo backend nie nasłuchuje na porcie 3001.
- **Ostrzeżenia o certyfikacie** — ponownie uruchom `warden sign-certificate endora.test` i zainstaluj urząd certyfikacji Warden jako zaufany (zobacz [Warden installing](https://docs.warden.dev/installing.html)).
- **`UNABLE_TO_VERIFY_LEAF_SIGNATURE` w procesie Node** — `fetch` po stronie serwera trafił na adres `https://…​.test`. Dla tego połączenia użyj `localhost` albo wyeksportuj `NODE_EXTRA_CA_CERTS` jak wyżej.
- **`ENOTFOUND api.endora.test` w procesie Node** — aplikacja wystartowała, zanim `warden svc up` uruchomił dnsmasq. Sprawdź `getent hosts api.endora.test`, a potem uruchom ponownie `pnpm run dev`.
- **DNS dla `*.test` nie działa** — `warden svc up` musi być uruchomione (dnsmasq); w części konfiguracji Linuksa sprawdź, czy `/etc/resolv.conf` nadal wskazuje serwer DNS Warden.
- **Port already allocated** — zatrzymaj drugi zestaw usług (`pnpm run dev:infra:down` albo `warden env down`) albo zmień `*_PORT` w `.env`.

---
title: Lokalny development z Warden
description: Uruchamianie infrastruktury Endora Commerce przez Warden (Traefik, HTTPS *.test), podczas gdy aplikacje działają na hoście przez pnpm.
---

# Lokalny development z Warden

To repozytorium to **monorepo pnpm**. Backend, storefront i admin współdzielą jedno API i
jeden zestaw magazynów danych — więc jest **jedno** środowisko Warden
(`WARDEN_ENV_TYPE=local`), a nie osobne projekty per aplikacja.

| Warstwa | Gdzie działa |
| --- | --- |
| Infrastruktura | Warden: PostgreSQL 16, Redis 7, Meilisearch, Mailhog |
| Aplikacje | Host: `pnpm run dev` (backend :3001, storefront :3000, admin :3002) |
| HTTPS front door (opcjonalnie) | Traefik → proxy nginx w `.warden/` → porty hosta |

Zwykły Docker Compose (`pnpm run dev:infra`) nadal jest wspierany i jest równoważny do
codziennej pracy bez HTTPS `*.test`. **Nie uruchamiaj Compose i Warden jednocześnie** —
publikują te same domyślne porty hosta.

## Wymagania wstępne

- [Warden](https://docs.warden.dev/) ≥ 0.15 (`brew install wardenenv/warden/warden`)
- Działający Docker Engine
- Node.js ≥ 22.17 i pnpm ≥ 9 (zob. root `README.md`)
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

Alternatywnie: `warden env-init endora local`, następnie scal wartości z
`.env.warden.example` do wygenerowanego `.env` (szczególnie flagi
`WARDEN_ELASTICHQ=0` i powiązane — bez nich Warden uruchamia nieużywany kontener ElasticHQ
nawet dla środowisk `local`).

Zweryfikuj infrastrukturę:

```bash
warden env ps
# postgres / redis / meilisearch / mailhog / nginx_* powinny być healthy
```

### Baza danych + seed

```bash
pnpm --filter backend run migration:up   # lub: db:fresh  (destrukcyjne)
pnpm --filter backend run cli demo seed
```

Dane logowania demo wypisuje polecenie. `endora demo reset` cofa to, co utworzyło, i to
uruchom przed ponownym seedowaniem bazy.

## Codzienna pętla

```bash
warden svc up          # raz po bootcie maszyny, jeśli globalne są down
warden env up -d       # infrastruktura projektu
pnpm run dev           # backend + storefront + admin
```

| Powierzchnia | localhost | HTTPS przez Traefik |
| --- | --- | --- |
| Storefront | http://localhost:3000 | https://www.endora.test / https://endora.test |
| Backend API | http://localhost:3001 | https://api.endora.test |
| Admin | http://localhost:3002 | https://admin.endora.test |
| Mailhog UI | http://localhost:8025 | https://mail.endora.test |
| Meilisearch | http://localhost:7700 | https://meilisearch.endora.test |
| Warden Traefik | — | https://traefik.warden.test |
| Warden webmail (global) | — | https://webmail.warden.test |

URL-e `localhost` działają z domyślnymi przykładami `.env` aplikacji. URL-e Traefik
wymagają nadpisań CORS / public-URL z następnej sekcji.

Stop:

```bash
# Ctrl+C zatrzymuje pnpm run dev
warden env down          # zachowaj wolumeny
warden env down -v       # wyczyść też dane postgres / redis / meilisearch
```

## Używanie `*.endora.test` (HTTPS)

Skieruj aplikacje na hostnames Traefik, aby cookies, CORS i absolutne linki
odpowiadały temu, co widzi przeglądarka.

URL-e widoczne w przeglądarce używają hostnames Traefik; **URL-e server-to-server
pozostają na `http://localhost:<port>`**. Node nie czyta systemowego trust store, więc
server-side `fetch` pod `https://…​.test` kończy się błędem
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, chyba że wyeksportujesz CA Warden (patrz niżej).

**`backend/.env`** (diff względem przykładu):

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

### Trzymanie wszystkich URL-i na `*.test`

Wyeksportuj root CA Warden **w shellu** przed `pnpm run dev` — wpisanie do `.env` nie
działa, bo Node czyta `NODE_EXTRA_CA_CERTS` przy starcie, zanim `--env-file` zostanie
sparsowany:

```bash
export NODE_EXTRA_CA_CERTS="$HOME/.warden/ssl/rootca/certs/ca.cert.pem"
pnpm run dev
```

Po eksporcie `BACKEND_BASE_URL` i `STOREFRONT_BASE_URL` mogą wskazywać hostnames
`https://…​.test`.

**`admin/.env`**:

```bash
# Trzymaj API na localhost — session cookies są SameSite=Lax i Secure=false
# w development; cross-site hop do https://api.…​.test daje login 200
# a potem /admin/me 401. Otwieraj admin pod http://localhost:3002.
VITE_API_BASE_URL=http://localhost:3001
VITE_STOREFRONT_BASE_URL=http://localhost:3000
```

Aby prowadzić admin przez Traefik (`https://admin.…​.test` → `https://api.…​.test`)
potrzebujesz też `Secure` session cookies (i ewentualnie `SameSite=None` tylko gdy oba
hosty liczą się jako cross-site). To nie jest dziś przełącznikiem env — używaj localhost
dla admin SPA, dopóki nie zostanie podpięte.

Connection stringi infrastruktury zostają na **localhost** (opublikowane porty) —

```bash
DATABASE_URL=postgresql://b2b:b2b@localhost:5432/b2b
REDIS_URL=redis://localhost:6379
MEILISEARCH_URL=http://localhost:7700
```

— bo procesy Node działają na hoście, nie w sieci Compose.

Jeśli Vite lub Next.js HMR zachowuje się dziwnie za Traefik, używaj URL-i `localhost` dla
aplikacji, którą aktywnie edytujesz; CORS API już pozwala na oba.

## Build

Te same polecenia co bez Warden — infrastruktura jest potrzebna tylko, gdy krok dotyka
bazy lub Redis:

```bash
pnpm -r run typecheck
pnpm -r run lint
pnpm -r run build

pnpm --filter @endora-commerce/cms-components build   # po zmianach klas komponentów CMS
pnpm --filter backend run test            # wymaga postgres (+ redis dla części suite)
```

Obrazy produkcyjne i deploy compose są pod `deploy/` — Warden to **tylko lokalny
development**.

## Dlaczego nie dwa środowiska Warden?

| Pomysł | Dlaczego tu słabo pasuje |
| --- | --- |
| Osobne projekty Warden `backend` + `storefront` | Jeden Postgres/Redis/Meilisearch; podział podwaja porty i dryf env |
| Node w kontenerze per aplikacja | Możliwe, ale wolniejszy hot reload na WSL i kłóci się z istniejącym orchestratorem `scripts/dev.mjs` |

Traktuj **backend / storefront / admin** jako procesy, a **Warden** jako wspólną płaszczyznę
danych + HTTPS edge.

## Kolizje portów / drugi checkout

Edytuj wartości `*_PORT` w root `.env` (z `.env.warden.example), utrzymuj unikalne
`WARDEN_ENV_NAME` i ponownie podpisz certyfikat, jeśli zmieniasz `TRAEFIK_DOMAIN`:

```bash
warden sign-certificate other-endora.test
warden env up -d
```

Wyrównaj `backend/.env` / `storefront/.env` / `admin/.env` z nowymi portami.

## Powrót do samego Compose

```bash
warden env down
cp .env.example .env          # opcjonalnie — tylko jeśli potrzebujesz niestandardowych portów
pnpm run dev:infra
pnpm run dev
```

## Rozwiązywanie problemów

- **`Docker does not appear to be running`** — uruchom Docker Desktop / Engine, potem `warden svc up`.
- **502 z `https://api.endora.test`** — `pnpm run dev` nie działa albo backend nie nasłuchuje na porcie 3001.
- **Ostrzeżenia certyfikatu** — ponownie uruchom `warden sign-certificate endora.test` i zainstaluj/zaufaj CA Warden (zob. [Warden installing](https://docs.warden.dev/installing.html)).
- **`UNABLE_TO_VERIFY_LEAF_SIGNATURE` w procesie Node** — server-side `fetch` trafił na URL `https://…​.test`. Użyj `localhost` dla tego hopu albo wyeksportuj `NODE_EXTRA_CA_CERTS` jak wyżej.
- **`ENOTFOUND api.endora.test` w procesie Node** — aplikacja wystartowała, zanim `warden svc up` podniósł dnsmasq. Zweryfikuj `getent hosts api.endora.test`, potem zrestartuj `pnpm run dev`.
- **DNS dla `*.test` nie działa** — `warden svc up` musi działać (dnsmasq); na części setupów Linux sprawdź, czy `/etc/resolv.conf` nadal wskazuje resolver Warden.
- **Port already allocated** — zatrzymaj drugi stack (`pnpm run dev:infra:down` lub `warden env down`) albo zmień `*_PORT` w `.env`.

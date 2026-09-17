---
title: Konsumenci kolejek i przetwarzanie w tle
---

# Konsumenci kolejek i przetwarzanie w tle

Asynchroniczna praca na Platformie B2B — masowe edycje, ponowne indeksowanie wyszukiwarki,
dostarczanie webhooków — przechodzi przez trwałe kolejki oparte na Redis, obsługiwane przez
**workery**. Ta strona wyjaśnia, jak uruchamiać te konsumenty i jak zachowują się obecne
operacje platformy oparte na kolejkach.

Projekt podąża za **Zasadą X Konstytucji — Skalowalne konsumenci kolejek**
(`.specify/memory/constitution.md`). Wiążący invariant brzmi:

- kolejka to **trwały, rozproszony substrat** (Redis / klasa BullMQ), a nie lista
  in-memory przypisana do jednego procesu;
- każde zadanie jest **atomowo przejmowane**, tak aby `N ≥ 2` instancje konsumenta nigdy
  nie przetworzyły jednego joba podwójnie, a handlery są **idempotentne** przy ponowieniach;
- komponent, który enqueue'uje (handler HTTP, subscriber zdarzeń, scheduler), to
  **producent** — tylko enqueue'uje i wraca, nigdy nie wykonuje joba inline na ścieżce
  żądania;
- konsument to **oddzielny entrypoint workera** — proces, który można uruchomić osobno i
  skalować do wielu instancji *bez zmian w kodzie*.

## Uruchamianie konsumentów

Workery i API współdzielą jedną kompozycję (to samo okablowanie modułów), więc konsument
nie potrzebuje osobnego grafu serwisów. Rolę procesu wybiera zmienna środowiskowa
`BACKEND_ROLE`:

| `BACKEND_ROLE` | Zachowanie procesu |
| --- | --- |
| nieustawione / `all` (domyślnie) | API **oraz** współlokalizowane workery — domyślna konfiguracja na jednym VPS |
| `api` | Tylko HTTP; **nie** uruchamia konsumentów (sparuj z osobnym procesem workera) |
| `worker` | Tylko konsumenci; nie serwuje HTTP (ustawiane automatycznie przez entrypoint workera) |

### Pojedynczy deployable (domyślnie)

Na jednym VPS uruchom tylko proces API — współlokalizuje on workery:

```bash
pnpm --filter backend run start      # production (built)
pnpm --filter backend run dev        # development (tsx watch)
```

To postawa dozwolona przez Zasadę X przy niskim wolumenie: worker pozostaje *oddzielnym
entrypointem*, ale jest hostowany w procesie API, aby utrzymać prosty deployment.

### Osobne, niezależnie skalowalne workery

Gdy masowe edycje, importy lub re-indeksowanie zaczynają konkurować z latencją żądań,
rozdziel workery na własne proces(y):

```bash
# Warstwa web — tylko HTTP, bez konsumentów in-process.
BACKEND_ROLE=api pnpm --filter backend run start

# Warstwa worker — tylko konsumenci, bez listenera HTTP.
pnpm --filter backend run worker          # production (built)
pnpm --filter backend run worker:dev      # development (tsx watch)
```

Skaluj warstwę worker **horyzontalnie**, uruchamiając więcej procesów worker (lub
kontenerów). Atomowe przejęcie joba w BullMQ gwarantuje, że job przetworzy dokładnie jeden
z nich; dodanie instancji nie wymaga zmiany konfiguracji.

Obie warstwy muszą wskazywać na **ten sam Redis** (`REDIS_URL`, domyślnie
`redis://localhost:6379`) i tę samą bazę PostgreSQL. Redis to substrat kolejki; Postgres
trzyma wiersze operacji będące źródłem prawdy.

### Graceful shutdown

Entrypoint workera (`backend/src/worker.ts`) obsługuje `SIGINT` / `SIGTERM`: zamyka
workery BullMQ (pozwalając dokończyć joby w locie), następnie rozłącza Redis i ORM. Wyślij
`SIGTERM` i poczekaj na zakończenie procesu przed podmianą podczas deployu.

## Obecne operacje oparte na kolejkach

### Masowe operacje katalogu — `catalog.bulk-operation`

Obsługuje stronę admin **Akcje masowe** (*Bulk actions*). Dwa typy jobów współdzielą jedną
kolejkę:

- **`product_bulk_update`** — masowa edycja produktów większa niż próg synchroniczny (50
  produktów). Żądanie admin zapisuje wiersz `BulkOperation` ze statusem `pending`, enqueue'uje
  jego id i natychmiast zwraca `202`.
- **`search_reindex`** — pełne ponowne indeksowanie Meilisearch (odpowiednik CLI
  `pnpm search:reindex`), enqueue'owane automatycznie po przełączeniu flagi `searchable`
  atrybutu.

Konsument przejmuje wiersz, zmieniając `pending → running` warunkowym UPDATE (atomowe
przejęcie), uruchamia handler i zapisuje postęp na żywo oraz końcowy status `completed` /
`failed`. Po zakończeniu wnioskodawca dostaje powiadomienie w aplikacji **oraz** e-mail.
Ponowne dostarczenie już przejętego joba to no-op, więc handler jest bezpieczny przy
`N ≥ 2` workerach.

Przy starcie workera **boot reconciliation** ponownie enqueue'uje wiersze pozostawione w
`pending` (np. utworzone, gdy Redis był chwilowo niedostępny). To tylko *enqueue'uje* na
trwałą kolejkę — nie jest sweeperem drainującym.

### Dostarczanie webhooków — `webhook.deliver`

Zdarzenia domenowe na in-process event bus są mostkowane na kolejkę BullMQ; worker podpisuje
każdy payload (HMAC-SHA-256) i POST-uje go na URL subskrybenta. Do 8 prób z exponential
backoff; ostateczna porażka trafia do dead letter i można ją odtworzyć z widoku admin
**Webhooks → Deliveries**. Zobacz moduł [webhooks](../modules/webhooks.md) po kontrakt
dostarczania i model ponowień.

## Inne joby w tle (jeszcze nie na wspólnej kolejce)

Kilka okresowych/jobów konserwacyjnych nadal działa jako timery in-process lub ręczne
skrypty. Poprzedzają Zasadę X i są śledzone pod migrację do tego samego modelu workera; do
tego czasu dokumentuj i obsługuj je tak:

| Job | Jak działa dziś | Wywołanie |
| --- | --- | --- |
| Cart abandonment sweep | Ręczny / cron script | `pnpm --filter backend run cart:abandonment-sweep` |
| Full search re-index | Ręczne CLI | `pnpm --filter backend run search:reindex` |
| Price-list status sweep | In-process `setInterval` (co 5 min) | startuje z procesem API |
| RFQ expiry | Metoda serwisu, wywoływana wg harmonogramu | `RfqExpiryWorker.sweep()` |

:::note
Powyższe sweepery in-process `setInterval` to legacy pattern, który Zasada X zastępuje.
Nowa asynchroniczna praca oparta na kolejkach MUSI używać trwałej kolejki + oddzielnego
modelu workera opisanego tutaj, nigdy timera w procesie żądania.
:::

Cart abandonment sweep czyta obecność modułu z `module_registrations` przed jakąkolwiek
akcją i kończy się kodem niezerowym z `MODULE_DISABLED`, gdy `carts` nie jest zainstalowany
na deploymencie — ta sama odpowiedź, jaką dałaby trasa HTTP, dla entrypointu bez trasy do
gatingu. Przetwarza partiami po 500, commitując flipy statusu każdej partii razem z
wierszami audytu, więc przerwany run zostawia całe partie, a nie częściową.

## Monitoring i rozwiązywanie problemów

- **Głębokość kolejki / failed jobs** — sprawdź klucze BullMQ w Redis, np.
  `redis-cli keys 'bull:catalog.bulk-operation:*'` i
  `redis-cli keys 'bull:webhook.deliver:*'`. Failed jobs są zachowywane (`removeOnFail`) do
  inspekcji.
- **Status operacji** — dla pracy katalogowej strona admin **Akcje masowe** listuje operacje
  pending / running / completed / failed z licznikami per item; wiersze leżą w tabeli
  `catalog_bulk_operations`.
- **Operacja w kolejce nigdy nie opuszcza `pending`** — potwierdź, że worker działa
  (`BACKEND_ROLE` obejmuje konsumentów) i współdzieli ten sam `REDIS_URL` co API. Restart
  workera ponownie enqueue'uje osierocone wiersze `pending` przez boot reconciliation.
- **Workery bezczynne, a joby się piętrzą** — sprawdź, czy moduł właściciel jest włączony;
  workery rejestrowane przez cykl życia modułu są wstrzymywane, gdy moduł jest wyłączony, i
  wznawiane po ponownym włączeniu.

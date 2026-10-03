---
title: Konsumenci kolejek i przetwarzanie w tle
---

# Konsumenci kolejek i przetwarzanie w tle

Praca asynchroniczna w Platformie B2B — masowe edycje, ponowne indeksowanie wyszukiwarki, wysyłka
webhooków — przechodzi przez trwałe kolejki w Redis, obsługiwane przez **workery**. Ta strona
wyjaśnia, jak uruchamiać konsumentów kolejek i jak zachowują się obecne operacje platformy oparte na
kolejkach.

Rozwiązanie jest zgodne z zasadą platformy o **skalowalnych konsumentach kolejek**. Wiążące
założenia:

- kolejka to **trwały, rozproszony mechanizm** (Redis / BullMQ), a nie lista w pamięci jednego
  procesu;
- każde zadanie jest **pobierane atomowo**, dzięki czemu przy `N ≥ 2` instancjach konsumenta żadne
  zadanie nie zostanie wykonane dwa razy, a handlery są **idempotentne** przy ponowieniach;
- komponent, który dodaje zadania do kolejki (handler HTTP, subskrybent zdarzeń, harmonogram), to
  **producent** — tylko dodaje zadanie i od razu kończy, nigdy nie wykonuje go w trakcie obsługi
  żądania;
- konsument to **osobny punkt wejścia workera** — proces, który można uruchomić osobno i skalować do
  wielu instancji *bez zmian w kodzie*.

## Uruchamianie konsumentów

Workery i API korzystają z tej samej kompozycji (tego samego połączenia modułów), więc konsument nie
potrzebuje osobnego grafu usług. Rolę procesu wybiera zmienna środowiskowa `BACKEND_ROLE`:

| `BACKEND_ROLE` | Zachowanie procesu |
| --- | --- |
| nieustawiona / `all` (domyślnie) | API **oraz** workery w tym samym procesie — domyślna konfiguracja na jednym serwerze VPS |
| `api` | Tylko HTTP; **nie** uruchamia konsumentów (połącz z osobnym procesem workera) |
| `worker` | Tylko konsumenci; nie obsługuje HTTP (ustawiane automatycznie przez punkt wejścia workera) |

### Jeden proces (domyślnie)

Na jednym serwerze VPS uruchom tylko proces API — workery działają w nim:

```bash
pnpm --filter backend run start      # production (built)
pnpm --filter backend run dev        # development (tsx watch)
```

Przy niewielkim obciążeniu ta zasada na to pozwala: worker pozostaje *osobnym punktem wejścia*, ale
działa w procesie API, co upraszcza wdrożenie.

### Osobne, niezależnie skalowane workery

Gdy masowe edycje, importy albo ponowne indeksowanie zaczynają spowalniać obsługę żądań, przenieś
workery do osobnych procesów:

```bash
# Warstwa web — tylko HTTP, bez konsumentów in-process.
BACKEND_ROLE=api pnpm --filter backend run start

# Warstwa worker — tylko konsumenci, bez listenera HTTP.
pnpm --filter backend run worker          # production (built)
pnpm --filter backend run worker:dev      # development (tsx watch)
```

Warstwę workerów skaluj **poziomo**, uruchamiając więcej procesów (albo kontenerów) workera.
Atomowe pobieranie zadań w BullMQ gwarantuje, że każde zadanie wykona dokładnie jeden z nich;
dodanie instancji nie wymaga zmian w konfiguracji.

Obie warstwy muszą korzystać z **tego samego Redis** (`REDIS_URL`, domyślnie
`redis://localhost:6379`) i tej samej bazy PostgreSQL. Redis jest mechanizmem kolejki, a Postgres
przechowuje wiersze operacji, które są źródłem prawdy.

### Łagodne zatrzymanie

Punkt wejścia workera (`backend/src/worker.ts`) obsługuje `SIGINT` / `SIGTERM`: zamyka workery
BullMQ (pozwalając dokończyć trwające zadania), a następnie rozłącza Redis i ORM. Podczas wdrożenia
wyślij `SIGTERM` i poczekaj na zakończenie procesu, zanim go zastąpisz.

## Obecne operacje oparte na kolejkach

### Masowe operacje w katalogu — `catalog.bulk-operation`

Obsługuje stronę panelu **Akcje masowe** (*Bulk actions*). Dwa typy zadań korzystają z jednej
kolejki:

- **`product_bulk_update`** — masowa edycja produktów powyżej progu przetwarzania synchronicznego
  (50 produktów). Żądanie z panelu zapisuje wiersz `BulkOperation` ze statusem `pending`, dodaje jego
  identyfikator do kolejki i od razu zwraca `202`.
- **`search_reindex`** — pełne ponowne indeksowanie Meilisearch (odpowiednik polecenia
  `pnpm search:reindex`), dodawane do kolejki automatycznie po zmianie flagi `searchable` atrybutu.

Konsument przejmuje wiersz, zmieniając `pending → running` warunkowym UPDATE (atomowe przejęcie),
wykonuje handler i na bieżąco zapisuje postęp, a na końcu status `completed` / `failed`. Po
zakończeniu osoba, która zleciła operację, dostaje powiadomienie w aplikacji **oraz** e-mail.
Ponowne dostarczenie już przejętego zadania nic nie robi, więc handler jest bezpieczny przy `N ≥ 2`
workerach.

Przy starcie workera **uzgadnianie przy starcie** ponownie dodaje do kolejki wiersze pozostawione w
stanie `pending` (np. utworzone, gdy Redis był chwilowo niedostępny). To *tylko dodanie do kolejki*
— nie jest to zadanie, które samo przetwarza zaległości.

### Wysyłka webhooków — `webhook.deliver`

Zdarzenia domenowe z działającej w procesie szyny zdarzeń są przekazywane do kolejki BullMQ; worker
podpisuje każdą treść (HMAC-SHA-256) i wysyła ją żądaniem POST na adres subskrybenta. Do 8 prób z
wykładniczo rosnącym odstępem; ostateczna porażka trafia do kolejki nieudanych wysyłek i można ją
ponowić w widoku panelu **Webhooks → Deliveries**. Kontrakt wysyłki i zasady ponawiania opisuje
moduł [webhooks](../modules/webhooks.md).

## Inne zadania w tle (jeszcze nie na wspólnej kolejce)

Kilka zadań okresowych i porządkowych nadal działa jako timery w procesie albo skrypty uruchamiane
ręcznie. Są starsze niż zasada o skalowalnych konsumentach kolejek i czekają na przeniesienie do tego
samego modelu workerów; do tego czasu dokumentuj je i obsługuj tak:

| Zadanie | Jak działa dziś | Uruchomienie |
| --- | --- | --- |
| Wyszukiwanie porzuconych koszyków | Skrypt uruchamiany ręcznie lub przez cron | `pnpm --filter backend run cart:abandonment-sweep` |
| Pełne ponowne indeksowanie wyszukiwarki | Polecenie uruchamiane ręcznie | `pnpm --filter backend run search:reindex` |
| Aktualizacja statusów cenników | `setInterval` w procesie (co 5 min) | startuje razem z procesem API |
| Wygasanie zapytań ofertowych | Metoda usługi wywoływana według harmonogramu | `RfqExpiryWorker.sweep()` |

:::note
Opisane wyżej zadania oparte na `setInterval` w procesie to starszy wzorzec, który zastępuje zasada
o skalowalnych konsumentach kolejek. Nowa praca asynchroniczna MUSI korzystać z trwałej kolejki i
opisanego tu modelu osobnego workera, a nigdy z timera w procesie obsługującym żądania.
:::

Wyszukiwanie porzuconych koszyków przed jakąkolwiek czynnością sprawdza obecność modułu w
`module_registrations` i kończy się niezerowym kodem z `MODULE_DISABLED`, gdy moduł `carts` nie jest
zainstalowany we wdrożeniu — to ta sama odpowiedź, jaką dałaby trasa HTTP, tylko dla punktu wejścia
bez trasy, którą można by zablokować. Przetwarza koszyki porcjami po 500 i zatwierdza zmiany statusu
każdej porcji razem z wierszami audytu, więc przerwany przebieg zostawia całe porcje, a nie częściowe.

## Monitorowanie i rozwiązywanie problemów

- **Długość kolejki i nieudane zadania** — sprawdź klucze BullMQ w Redis, np.
  `redis-cli keys 'bull:catalog.bulk-operation:*'` i `redis-cli keys 'bull:webhook.deliver:*'`.
  Nieudane zadania są zachowywane (`removeOnFail`) do analizy.
- **Status operacji** — dla pracy na katalogu strona panelu **Akcje masowe** pokazuje operacje
  oczekujące, trwające, zakończone i nieudane, z licznikami dla każdej pozycji; wiersze są w tabeli
  `catalog_bulk_operations`.
- **Operacja w kolejce nigdy nie wychodzi ze stanu `pending`** — sprawdź, czy worker działa
  (`BACKEND_ROLE` obejmuje konsumentów) i korzysta z tego samego `REDIS_URL` co API. Restart workera
  ponownie dodaje osierocone wiersze `pending` do kolejki przez uzgadnianie przy starcie.
- **Workery stoją, a zadania się gromadzą** — sprawdź, czy moduł-właściciel jest włączony; workery
  rejestrowane przez cykl życia modułu są wstrzymywane, gdy moduł jest wyłączony, i wznawiane po
  ponownym włączeniu.

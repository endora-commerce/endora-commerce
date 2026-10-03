---
title: Przewodnik dla programistów
sidebar_position: 3
---

# Kanały sprzedaży — przewodnik dla programistów

Jak moduł backendu współpracuje z modułem kanałów sprzedaży: zawężanie zapytań do wyznaczonego
kanału, zarządzanie przypisaniami i odczyt kanału w handlerach żądań.

## Odczyt wyznaczonego kanału w trasie

Warstwa pośrednia wyznaczająca kanał dodaje do każdego żądania pod `/api/v1/*` pole
`req.salesChannel` (zserializowany widok `CachedChannel` wyznaczonego wiersza). Korzystaj z typowanej
funkcji pomocniczej, aby sposób dostępu był wszędzie taki sam:

```ts
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';

app.get('/api/v1/storefront/products', async (request) => {
  const channel = getResolvedChannel(request);
  return productService.list({ salesChannelId: channel.id });
});
```

Poza obsługą żądania (zadania w tle, skrypty CLI) wywołuj bezpośrednio
`SalesChannelResolverService.getByCode(code)` albo `getSystemDefault()` przez obiekt udostępniony
przy kompozycji modułu.

## Dodawanie do modułu encji zależnej od kanału

Zależność od kanału ma dwie warstwy:

1. **Schemat** — encja dostaje relację wiele-do-wielu z `sales_channels` przez nową tabelę łączącą
   `sales_channel_<entity>` (złożony klucz główny z obu identyfikatorów, `ON DELETE CASCADE` po obu
   stronach). Dodaj tę tabelę w kolejnej migracji modułu.
2. **Usługa** — każda ścieżka odczytu encji, która ma być filtrowana według kanału, przyjmuje
   parametr `salesChannelId` i łączy dane przez tabelę łączącą. Każda ścieżka tworzenia lub
   aktualizacji, która tworzy nową encję, po `persistAndFlush` wywołuje
   `SalesChannelMembershipService.bindToDefaultIfEmpty(entityType, entity.id)`, aby nowe encje
   domyślnie trafiały do domyślnego kanału systemowego.

Następnie dodaj wartość do wyliczenia `ChannelMemberEntityTypeSchema` w kontrakcie i **zadeklaruj
tabelę łączącą we własnym module**: wyeksportuj trójkę `{ entityType, table, entityIdColumn }` z
`src/backend/index.ts` i zarejestruj ją w hooku startowym —

```ts
ctx.onBoot(() => {
  const { salesChannelBridgeRegistry } = ctx.cradle<YourCradle>();
  for (const bridge of salesChannelBridges) salesChannelBridgeRegistry.register(bridge);
});
```

Dwukierunkowe trasy administracyjne uwzględnią ją automatycznie — osobne trasy w modułach nie są
potrzebne. Platforma celowo nie przechowuje mapy tabel łączących: kiedyś ją miała, obejmującą całe
wyliczenie, co oznaczało, że wywołanie dotyczące typu encji, którego modułu instancja nigdy nie
zainstalowała, wykonywało SQL na nieistniejącej tabeli. Typ encji, którego nie zarejestrował żaden
moduł, jest teraz odrzucany z `503 MODULE_DISABLED`, zanim cokolwiek trafi do bazy, a wyliczenie
pozostaje opublikowanym *słownikiem*, podczas gdy o tym, które typy działają, decyduje rejestr.

## Zmiana przypisań

`SalesChannelMembershipService` to jedyne miejsce, które zmienia dane w tabelach łączących.
Bezpośrednie INSERT / DELETE na `sales_channel_*` z innego miejsca jest zabronione — reguła lint
`no-unscoped-channel-query` jest zabezpieczeniem (dostarczana jest wyłączona i zostanie włączona, gdy
wszystkie istniejące wywołania zostaną dostosowane).

```ts
const result = await membershipService.addToChannel(channelId, 'product', productId);
// result.changed is false on idempotent re-add.

const removed = await membershipService.removeFromChannel(channelId, 'product', productId, {
  fallbackToDefault: true,
});
// throws ENTITY_WOULD_HAVE_ZERO_CHANNELS if it would orphan the entity AND fallbackToDefault is false.
```

## Gwarancja istnienia kanału domyślnego

`DefaultChannelReconciler` wykonuje się przy każdym starcie backendu z `composition.ts` (oraz z
`test-server.ts` w testach integracyjnych). Trzy przypadki:

1. **Pusta tabela `sales_channels`** — wstawia nowy wiersz z kodem `DEFAULT_SALES_CHANNEL_CODE`
   (zmienna środowiskowa, domyślnie `default`).
2. **Wiersze istnieją, ale żaden nie ma `system_default = true`** — ustawia jako domyślny pierwszy
   wiersz w kolejności leksykograficznej, przy remisie preferując wiersz z `code = 'default'`.
3. **Dokładnie jeden wiersz ma już `system_default = true`** — nic nie robi.

Mechanizm uzgadniania nigdy nie odbiera oznaczenia, nie usuwa i nie zmienia danych kanału. Kod spoza
tego modułu zakłada, że kanał domyślny istnieje; jeśli piszesz kod infrastruktury uruchamiany przed
mechanizmem uzgadniania, najpierw wywołaj `DefaultChannelReconciler.run()`.

## Optymistyczna kontrola współbieżności przy edycji kanału

Kolumna całkowitoliczbowa `version` w `sales_channels` rośnie dokładnie o 1 przy każdej udanej
aktualizacji danych kanału. Endpoint PATCH wymaga, aby `expectedVersion` od klienta było równe
bieżącej `version` wiersza; przy niezgodności zwraca HTTP 412 `STALE_SALES_CHANNEL_WRITE` z bieżącą
`version` w odpowiedzi z błędem, aby klient mógł odświeżyć dane i spróbować ponownie.

Dodawanie i usuwanie przypisań jest z definicji idempotentne i nie zwiększa `version` kanału.

## Audyt

Każda zmiana danych kanału, zmiana w cyklu życia i zmiana przypisań zapisuje synchronicznie, w tej
samej transakcji, jeden wiersz w `audit_log_entries`. Kody akcji są w `@endora-commerce/contracts`:

```ts
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';

await auditLogService.record({
  action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
  // ...
});
```

Korzystaj ze stałych — nigdy nie wpisuj stringów na stałe — aby przyszła zmiana nazwy w wyliczeniu
lub typie poprawnie objęła wszystkie miejsca.

## Unieważnianie pamięci podręcznej

`SalesChannelsCache` (lokalna dla procesu pamięć LRU i Redis) przechowuje `CachedChannel` dla każdego
`code`. Pamięć podręczna jest unieważniana przy każdej zmianie danych lub cyklu życia przez istniejącą
szynę `EventBus`:

- `sales_channels.identity_changed` → usuwa jeden wpis według kodu.
- `sales_channels.lifecycle_changed` → usuwa jeden wpis albo wszystkie, gdy ustawiono
  `invalidateAll: true` (używane przy trwałym usunięciu).

Oba najpierw usuwają wspólny wpis w Redis, potem lokalny, z kluczem oznaczonym na czas całej
operacji, aby równoległy odczyt nie mógł ponownie zapamiętać kanału sprzed zmiany — i aby nieudane
usunięcie w Redis kierowało odczyty do PostgreSQL, zamiast zwracać wartość, którą unieważnienie
miało usunąć. `EventBus` działa w procesie, więc druga instancja dochodzi do aktualnego stanu w
30-sekundowym oknie warstwy lokalnej.

Odczyty przypisań idą bezpośrednio przez MikroORM (bez pamięci podręcznej); jeśli potrzebujesz ich
szybciej, dodaj warstwę Redis z kluczem `(entityType, entityId)` i krótkim TTL — hooki są już na
miejscu.

## Testowanie kodu zależnego od kanału

Korzystaj z istniejącego środowiska `setupBackendServer()` — uruchamia ono cały stos ze świeżym
kanałem `default`, uzgodnionym względem danych testowych (`en-US` / `PLN`). W testach bezpośrednio na
bazie danych użyj `setupTestDb()` i sam wywołaj `DefaultChannelReconciler.run()`, opcjonalnie
nadpisując wartości początkowe, gdy dane testowe mają inne kody języka lub waluty.

Wzorcowe testy integracyjne zależne od kanału w tym repozytorium (wycofywanie transakcji,
parametryzowane typy encji, dane testowe w surowym SQL niezależne od klas encji modułu-właściciela):

- `backend/test/integration/sales_channels/bidirectional-membership-every-bridge.test.ts` — test
  tabelaryczny dla wszystkich 9 tabel łączących.
- `backend/test/integration/sales_channels/at-least-one-channel-invariant.test.ts` — egzekwowanie
  reguły „co najmniej jeden kanał”.
- `backend/test/contract/sales_channels/admin-membership.contract.test.ts` — pokrycie po stronie HTTP.

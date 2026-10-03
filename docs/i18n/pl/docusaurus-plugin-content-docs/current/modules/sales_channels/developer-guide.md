---
title: Developer guide
sidebar_position: 3
---

# Developer guide — Sales Channels

Jak moduł backendu integruje się z modułem Sales Channels: scope'owanie zapytań przez rozwiązany kanał, zarządzanie członkostwami i odczyt kontekstu kanału z handlerów requestów.

## Odczyt rozwiązanego kanału wewnątrz route

Middleware resolvera ustala kanał sprzedaży każdego żądania pod `/api/v1/*` i zapisuje go (widok `CachedChannel` wiersza) w zakresie platformy żądania, a nie na obiekcie żądania. Odczytuj go helperami publikowanymi przez kernel platformy:

```ts
import { getResolvedChannel } from '@endora-commerce/platform/kernel';

app.get('/api/v1/storefront/products', async () => {
  const channel = getResolvedChannel();
  return productService.list({ salesChannelId: channel.id });
});
```

`getResolvedChannel()` rzuca błąd (`500`), gdy resolver nie zadziałał na danej ścieżce; `currentSalesChannel()` z tego samego barrela zwraca wtedy `null`. Żaden z nich nie potrzebuje `FastifyRequest`, więc usługa głęboko w łańcuchu wywołań może odczytać kanał bez przekazywania go przez parametry. (`getResolvedChannel` nadal przyjmuje argument żądania dla starszych wywołań i go ignoruje.)

Poza cyklem życia żądania (zadania w tle, skrypty CLI) pobierz z kontenera `salesChannelResolutionPort` i wywołaj `getByCode(code)` lub `getSystemDefault()`; typuj go jako `SalesChannelResolutionPort` z `@endora-commerce/platform/kernel`. Klasa `SalesChannelResolverService`, która za nim stoi, nie jest publikowana.

## Dodawanie encji scope'owanej kanałem do modułu

Scope kanału ma dwie warstwy:

1. **Schema** — encja zyskuje relację many-to-many do `sales_channels` przez nową tabelę mostu `sales_channel_<entity>` (composite primary key na obu id, `ON DELETE CASCADE` po obu stronach). Dodaj tabelę w następnej migracji modułu.
2. **Service** — każda ścieżka odczytu encji, która ma być filtrowana kanałem, przyjmuje parametr `salesChannelId` i joinuje przez tabelę mostu. Każda ścieżka create / update, która tworzy nową encję, woła `bindToDefaultIfEmpty(entityType, entity.id)` na `salesChannelMembershipPort` po `persistAndFlush`, aby nowo utworzone encje domyślnie trafiały do kanału system default.

Następnie dodaj member do enum `ChannelMemberEntityTypeSchema` w kontrakcie i **zadeklaruj most z własnego modułu**: eksportuj triple `{ entityType, table, entityIdColumn }` z `src/backend/index.ts` i zarejestruj go z boot hook —

```ts
ctx.onBoot(() => {
  const { salesChannelBridgeRegistry } = ctx.cradle<YourCradle>();
  for (const bridge of salesChannelBridges) salesChannelBridgeRegistry.register(bridge);
});
```

Dwukierunkowe route admin podchwytują to automatycznie — per-module routes nie są potrzebne. Platforma celowo nie trzyma mapy mostów: kiedyś trzymała, total over the enum, co oznaczało, że wywołanie członkostwa dla membera, którego moduł instancja nigdy nie zainstalowała, uruchamiało SQL wobec relacji, której nie ma. Member, którego żaden moduł nie zarejestrował, odmawia teraz z `503 MODULE_DISABLED` zanim dotknie bazy, a enum pozostaje opublikowanym *słownikiem*, podczas gdy rejestr decyduje, które membery są live.

## Mutowanie członkostw

`SalesChannelMembershipService` jest jedynym mutatorem każdej tabeli mostu. Moduł sięga po niego jako wpis kontenera `salesChannelMembershipPort`, typowany jako `SalesChannelMembershipPort` z `@endora-commerce/platform/kernel`; sama klasa nie jest publikowana. Bezpośredni INSERT / DELETE na `sales_channel_*` z innego miejsca jest zabroniony, a pilnuje tego `check:module-boundary`: przypisuje każdą tabelę `sales_channel_*` do jej właściciela na podstawie DDL i zgłasza moduł, który zapisuje ją surowym SQL.

```ts
const result = await membershipService.addToChannel(channelId, 'product', productId);
// result.changed is false on idempotent re-add.

const removed = await membershipService.removeFromChannel(channelId, 'product', productId, {
  fallbackToDefault: true,
});
// throws ENTITY_WOULD_HAVE_ZERO_CHANNELS if it would orphan the entity AND fallbackToDefault is false.
```

## Gwarancja kanału Default

`DefaultChannelReconciler` działa przy każdym starcie backendu, w kompozycji platformy (`packages/platform/src/composition/compose-app.ts`), a więc także w serwerze testów integracyjnych. Trzy gałęzie:

1. **Pusta tabela `sales_channels`** — wstawia nowy wiersz `default` z `DEFAULT_SALES_CHANNEL_CODE` (env, default `default`).
2. **Wiersze istnieją, ale żaden nie ma `system_default = true`** — promuje leksykalnie pierwszy wiersz, z tie-break preferującym wiersz, którego `code = 'default'`.
3. **Dokładnie jeden wiersz ma już `system_default = true`** — no-op.

Reconciler nigdy nie degraduje, nie usuwa i nie edytuje tożsamości. Kod poza tym modułem zakłada, że default istnieje; jeśli piszesz kod infra-level uruchamiany przed reconcilerem, najpierw wołaj `DefaultChannelReconciler.run()`.

## Optimistic concurrency dla edycji tożsamości

Kolumna integer `version` na `sales_channels` rośnie dokładnie o 1 przy każdej udanej aktualizacji tożsamości. Endpoint PATCH wymaga, aby `expectedVersion` klienta zgadzało się z bieżącą `version` wiersza, mismatch → HTTP 412 `STALE_SALES_CHANNEL_WRITE` z bieżącą `version` w envelope błędu, aby klient mógł odświeżyć i ponowić.

Operacje add / remove członkostwa są idempotentne z definicji i nie bumpują `version` kanału.

## Hooki audytu

Każda zmiana tożsamości, zmiana cyklu życia i zmiana członkostwa zapisuje jeden wiersz `audit_log_entries` synchronicznie w tej samej transakcji. Kody akcji są w `@endora-commerce/contracts`:

```ts
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';

await auditLogService.record({
  action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
  // ...
});
```

Używaj stałych — nigdy nie hardcoduj stringów — aby przyszły rename enum / typu propagował się czysto.

## Unieważnianie cache

`SalesChannelsCache` (process-local LRU + Redis) trzyma `CachedChannel` per `code`. Cache jest unieważniany przy każdej zmianie tożsamości / cyklu życia przez istniejący `EventBus`:

- `sales_channels.identity_changed` → usuwa jeden wpis po code.
- `sales_channels.lifecycle_changed` → usuwa jeden wpis, albo wszystkie wpisy, gdy ustawiono `invalidateAll: true` (używane przy hard delete).

Oba najpierw usuwają wspólny wpis Redis, potem lokalny, z kluczem oznaczonym na całą operację, aby równoległy odczyt nie mógł ponownie przypiąć kanału sprzed zmiany — i aby nieudane usunięcie Redis pozostawiało odczyty z fallthrough do PostgreSQL zamiast serwować wartość, którą unieważnienie miało usunąć. `EventBus` jest in-process, więc druga instancja zbiega przez 30 s okno warstwy lokalnej.

Lookupi członkostwa idą bezpośrednio przez MikroORM (bez warstwy cache); jeśli potrzebujesz ich szybciej, dodaj warstwę Redis kluczowaną po `(entityType, entityId)` z krótkim TTL — hooki są już na miejscu.

## Testowanie kodu channel-aware

Użyj istniejącego harnessu `setupBackendServer()` — bootuje pełny stack ze świeżym kanałem `default` zreconcilowanym względem seeda testowego (`en-US` / `PLN`). Dla testów na poziomie raw DB użyj `setupTestDb()` i sam wołaj `DefaultChannelReconciler.run()`, opcjonalnie nadpisując bootstrap defaults, gdy seed testowy ma inne kody języka/waluty.

Istniejący precedens repozytorium dla testów integracyjnych channel-aware (transactional rollback, parametryzowane typy encji, fixture raw-SQL odłączone od klas encji modułu-właściciela) jest w:

- `backend/test/integration/sales_channels/bidirectional-membership-every-bridge.test.ts` — table-driven po wszystkich 9 mostach.
- `backend/test/integration/sales_channels/at-least-one-channel-invariant.test.ts` — egzekwowanie inwariantu at-least-one-channel.
- `backend/test/contract/sales_channels/admin-membership.contract.test.ts` — pokrycie po stronie HTTP.

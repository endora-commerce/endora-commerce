---
title: Developer guide
sidebar_position: 3
---

# Developer guide — Sales Channels

Jak moduł backendu integruje się z modułem Sales Channels: scope'owanie zapytań przez rozwiązany kanał, zarządzanie członkostwami i odczyt kontekstu kanału z handlerów requestów.

## Odczyt rozwiązanego kanału wewnątrz route

Middleware resolver dekoruje każdy request pod `/api/v1/*` polem `req.salesChannel` (serializowany widok `CachedChannel` rozwiązanego wiersza). Użyj typowanego helpera, aby utrzymać spójny wzorzec dostępu:

```ts
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';

app.get('/api/v1/storefront/products', async (request) => {
  const channel = getResolvedChannel(request);
  return productService.list({ salesChannelId: channel.id });
});
```

Poza cyklem życia requestu (background jobs, skrypty CLI) wołaj `SalesChannelResolverService.getByCode(code)` lub `getSystemDefault()` bezpośrednio przez handle composition modułu.

## Dodawanie encji scope'owanej kanałem do modułu

Scope kanału ma dwie warstwy:

1. **Schema** — encja zyskuje relację many-to-many do `sales_channels` przez nową tabelę mostu `sales_channel_<entity>` (composite primary key na obu id, `ON DELETE CASCADE` po obu stronach). Dodaj tabelę w następnej migracji modułu.
2. **Service** — każda ścieżka odczytu encji, która ma być filtrowana kanałem, przyjmuje parametr `salesChannelId` i joinuje przez tabelę mostu. Każda ścieżka create / update, która tworzy nową encję, woła `SalesChannelMembershipService.bindToDefaultIfEmpty(entityType, entity.id)` po `persistAndFlush`, aby nowo utworzone encje domyślnie trafiały do kanału system default (FR-011).

Następnie dodaj member do enum `ChannelMemberEntityTypeSchema` w kontrakcie i **zadeklaruj most z własnego modułu** (feature 120, FR-015): eksportuj triple `{ entityType, table, entityIdColumn }` z `src/backend/index.ts` i zarejestruj go z boot hook —

```ts
ctx.onBoot(() => {
  const { salesChannelBridgeRegistry } = ctx.cradle<YourCradle>();
  for (const bridge of salesChannelBridges) salesChannelBridgeRegistry.register(bridge);
});
```

Dwukierunkowe route admin podchwytują to automatycznie — per-module routes nie są potrzebne. Platforma celowo nie trzyma mapy mostów: kiedyś trzymała, total over the enum, co oznaczało, że wywołanie członkostwa dla membera, którego moduł instancja nigdy nie zainstalowała, uruchamiało SQL wobec relacji, której nie ma (D-226). Member, którego żaden moduł nie zarejestrował, odmawia teraz z `503 MODULE_DISABLED` zanim dotknie bazy, a enum pozostaje opublikowanym *słownikiem*, podczas gdy rejestr decyduje, które membery są live.

## Mutowanie członkostw

`SalesChannelMembershipService` jest jedynym mutatorem każdej tabeli mostu. Bezpośredni INSERT / DELETE na `sales_channel_*` z innego miejsca jest zabroniony — reguła lint `no-unscoped-channel-query` to siatka bezpieczeństwa (ships disabled i zostanie włączona, gdy każdy istniejący call site zostanie przeciągnięty; zobacz tasks.md T020 / T062).

```ts
const result = await membershipService.addToChannel(channelId, 'product', productId);
// result.changed is false on idempotent re-add.

const removed = await membershipService.removeFromChannel(channelId, 'product', productId, {
  fallbackToDefault: true,
});
// throws ENTITY_WOULD_HAVE_ZERO_CHANNELS if it would orphan the entity AND fallbackToDefault is false.
```

## Gwarancja kanału Default

`DefaultChannelReconciler` działa przy każdym bootcie backendu z `composition.ts` (oraz z `test-server.ts` dla testów integracyjnych). Trzy gałęzie:

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

- `backend/test/integration/sales_channels/bidirectional-membership-every-bridge.test.ts` (T043) — table-driven po wszystkich 9 mostach.
- `backend/test/integration/sales_channels/at-least-one-channel-invariant.test.ts` (T022) — egzekwowanie FR-008.
- `backend/test/contract/sales_channels/admin-membership.contract.test.ts` (Phase 5b) — pokrycie po stronie HTTP.

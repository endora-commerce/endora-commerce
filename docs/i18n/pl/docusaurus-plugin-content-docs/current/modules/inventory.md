---
title: inventory
description: Poziomy stanów, rezerwacje, powiadomienia o dostępności
---

# `inventory`

Moduł wielomagazynowego stanu: tożsamość magazynu, liczniki on-hand i reserved
per `(product, warehouse)`, powiązanie kanału sprzedaży, alerty niskiego stanu,
pasma wyświetlania, backorder + unmanaged + notify-when-available, import CSV
oraz zapisy `stock_allocations` per linia.

Moduł zastępuje model single-bucket z foundation. Migracja 030 zachowuje
tabelę foundation `stock_levels`, ale
rozszerza kształt unikalności do `(product_id, variant_id, warehouse_id)`,
seeduje magazyn `Default` z deterministycznym UUID
`00000000-0000-4000-8000-00000000d017` i paruje każdy aktywny kanał
sprzedaży z tym magazynem przez nową tabelę
`warehouse_channel_assignments`.

## Encje modułu

| Entity | Cel |
| --- | --- |
| `Warehouse` | Tożsamość lokalizacji magazynowej (nazwa, code, flaga active, kontakt, adres) |
| `StockLevel` | Wiersz `(product_id, variant_id, warehouse_id)` z `on_hand` + `reserved` |
| `WarehouseChannelAssignment` | Powiązanie m:n magazyn ↔ kanał sprzedaży; co najwyżej jedno `is_default = true` per kanał |
| `InventoryThreshold` | Progi pasma wyświetlania w scope `global` / `category` / `product` |
| `StockAllocation` | Jeden wiersz per `(order_item, warehouse)` — pochodzenie fulfilmentu + wsparcie release |
| `AvailabilityNotification` | Klient lub anonimowy e-mail zapisany na sygnał back-in-stock |

## Ustawienia (Module Settings)

Siedem kluczy w grupie `inventory`:

| Code | Type | Default | Notes |
| --- | --- | --- | --- |
| `inventory.display_mode` | string | `band` | Wyświetlanie storefront: `exact` / `band` / `available_or_not` |
| `inventory.fulfilment_strategy` | string | `default_first` | `any` / `default_first` / `lowest_stock_first` / `highest_stock_first` / `defined_order` |
| `inventory.fulfilment_strategy_warehouse_order` | json | `[]` | Kolejność obchodu dla strategii `defined_order` |
| `inventory.global_threshold_high` | number | `100` | Skumulowany on-hand od którego produkt jest „high stock” |
| `inventory.global_threshold_medium` | number | `20` | Od którego „medium” |
| `inventory.global_threshold_low` | number | `1` | Od którego „low”; poniżej out-of-stock |
| `inventory.low_stock_alert_recipient_email` | string | `''` | Puste fallbackuje do env `INVENTORY_LOW_STOCK_RECIPIENT` |

## Publiczne API

Trasy admina są chronione przez `inventory:read` (odczyt) / `inventory:write` (zapis) —
własne kody modułu od 2026-08-29. Wszystkie 21 wcześniej wymuszało `orders:read`
i `catalog:write`; zobacz **Permissions** poniżej.

Tabela wymienia wszystkie 21 miejsc admina. Wymieniała dziesięć do 2026-08-29 i
pomijała zapis progów per-(product, warehouse) oraz obie trasy backward-compatibility
foundation — to rodzaj luki, którą każda z czterech poprzednich napraw uprawnień
znajdowała na stronie modułu.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/inventory` | `inventory:read` | KPI landing: śledzone produkty, łączny on-hand, liczba out-of-stock, liczba low-stock, sumy per magazyn |
| `GET /api/v1/admin/inventory/levels` | `inventory:read` | Roster per produkt ze skumulowanym on-hand, rozbiciem per magazyn, pasmem wyświetlania |
| `PUT /api/v1/admin/inventory/levels` | `inventory:write` | Ustaw absolutny on-hand dla `(productId, warehouseId, variantId?)`; emituje `inventory.adjusted.v1` |
| `PUT /api/v1/admin/inventory/warehouse-low-stock-thresholds` | `inventory:write` | Progi low-stock per-(product, warehouse) |
| `GET /api/v1/admin/inventory/low-stock` | `inventory:read` | Produkty, których skumulowany on-hand jest at-or-below `lowStockThreshold` |
| `GET /api/v1/admin/inventory/thresholds` | `inventory:read` | Odczyt globalnych / per-kategoria / per-produkt progów pasma wyświetlania |
| `PATCH /api/v1/admin/inventory/thresholds` | `inventory:write` | Aktualizacja |
| `GET /api/v1/admin/warehouses[/:id]` | `inventory:read` | Lista i szczegóły magazynów |
| `POST/PATCH/DELETE /api/v1/admin/warehouses[/:id]` | `inventory:write` | CRUD magazynów; odmawia delete, gdy magazyn jest domyślny kanału lub trzyma stock |
| `GET /api/v1/admin/sales-channels/:id/warehouses` | `inventory:read` | Magazyny powiązane z kanałem |
| `POST/PATCH/DELETE /api/v1/admin/sales-channels/:id/warehouses[/:assignmentId]` | `inventory:write` | Powiązanie kanał ↔ magazyn z co najwyżej jednym default per kanał |
| `GET /api/v1/admin/inventory/availability-notifications` | `inventory:read` | Admin przegląda kolejkę back-in-stock |
| `PATCH /api/v1/admin/inventory/availability-notifications/:id` | `inventory:write` | Anuluje subskrypcję |
| `POST /api/v1/admin/inventory/import` | `inventory:write` | Import CSV stanów (`?dryRun=true` waliduje bez zapisu) |
| `PUT /api/v1/admin/inventory` | `inventory:write` | **Deprecated** zapis single-bucket foundation; deleguje do `StockLevelService.setOnHand` względem seedowanego magazynu Default |
| `GET /api/v1/admin/inventory/legacy` | `inventory:read` | **Deprecated** lista single-bucket foundation |
| `GET /api/v1/storefront/inventory/display-mode` | — | Publiczny odczyt storefront: jaki tryb wyświetlania używa kanał |

## Uprawnienia

`inventory:read` i `inventory:write`, własne modułu od 2026-08-29.

Wcześniej wszystkie 21 tras admina wymuszało kody dwóch innych modułów — dziewięć
odczytów na `orders:read` i dwanaście zapisów na `catalog:write`. Kto mógł edytować
opis produktu, mógł tworzyć, przemianowywać i usuwać magazyn, przepisywać stan,
uruchamiać import CSV przez stock każdego produktu i wiązać lub odpinać magazyn od
kanału sprzedaży; a kto mógł czytać zamówienia, mógł enumerować każdy magazyn i adres
na nim. Żaden kod nie nazywa danych, których dotyka — to dyskryminator, na
którym rozstrzyga się własność uprawnień: per trasa, a nie per moduł.

**Nie ma migracji danych**: rola, która docierała do tych ekranów przez
`catalog:write` lub `orders:read`, dostaje nowe kody explicite na
`/admin-roles`, gdzie manifest wstawia je automatycznie. Nadanie ich każdemu
posiadaczowi starych kodów odtworzyłoby nadmierne uprawnienie, które split usuwa.

`test/contract/inventory/permission-authority.test.ts` przypina oba kierunki i
oba stare kody.
| `GET /api/v1/storefront/inventory/stock/:id` | Storefront-public stock per produkt ze skumulowanym on-hand sumowanym tylko po magazynach powiązanych z kanałem wywołującego |
| `POST /api/v1/catalog/products/:id/notify-when-available` | Klient subskrybuje back-in-stock; zalogowani mają e-mail wstępnie wypełniony |

### Deprecated

Dwie trasy foundation są starsze niż powierzchnia per-magazyn powyżej i zawsze
adresują seedowany magazyn Default. Nic w platformie nie woła żadnej z nich
— żaden ekran admina, żaden call klienta API admina, żaden seed, żaden skrypt — więc
istnieją dla własnej integracji wdrożenia i nic więcej. Nie buduj na nich.

| Verb + Path | Purpose | Replacement |
| --- | --- | --- |
| `PUT /api/v1/admin/inventory` | Ustaw absolutny on-hand dla `(productId, variantId?)` w magazynie Default | `PUT /api/v1/admin/inventory/levels`, który bierze explicite `warehouseId` |
| `GET /api/v1/admin/inventory/legacy` | Płaskie wiersze `stock_levels`, najnowsze pierwsze, opcjonalnie filtrowane `productId` | `GET /api/v1/admin/inventory/levels` dla wszystkiego oprócz `variantId` i `updatedAt`, których nie niesie |

`PUT` deleguje teraz do tego samego serwisu co
`PUT .../levels`, więc emituje `inventory.adjusted.v1` i odpowiada `404` dla
nieznanego produktu zamiast pisać wiersz stocku dla niego. Zostanie usunięty, gdy
log dostępu produkcyjnego lub właściciel wdrożenia potwierdzi, że nic tego nie woła.

## Flagi per produkt

Pięć nowych pól żyje na `products` i przechodzi przez `PATCH /api/v1/admin/catalog/products/:id`:

- `manageStock` (default `true`) — gdy `false`, storefront traktuje produkt jako zawsze dostępny, a ścieżki koszyka/zamówienia pomijają rezerwację całkowicie.
- `backorderEnabled` (default `false`) — gdy `true`, checkout przy zerowym stocku jest akceptowany; powstały wiersz `stock_allocations` ma flagę `is_backorder = true`.
- `lowStockThreshold` — opcjonalna liczba całkowita; gdy null, produkt jest zwolniony z alertów low-stock.
- `fulfilmentStrategy` — per-produktowe nadpisanie globalnej strategii.
- `fulfilmentStrategyWarehouseOrder` — gdy strategia to `defined_order`, uporządkowana lista UUID magazynów do obchodu.

## Rozwiązywanie pasma wyświetlania

Potrójne lookup `(product, category[], global)` działa per-klucz (high / medium / low),
więc produkt może nadpisać tylko `low`, dziedzicząc `high` i `medium` z globalnego
domyślnego. Resolver żyje w
`packages/modules/inventory/src/backend/services/threshold-resolver.ts` i jest czystą
funkcją z pełnym pokryciem testów jednostkowych.

Resolver pasma wyświetlania w
`packages/modules/inventory/src/backend/services/display-band-resolver.ts` mapuje
skumulowany on-hand na jedno z `high | medium | low | out_of_stock | available`
(`available` to specjalne wiadro dla `manageStock = false`).

## Strategie fulfilmentu

Pięć strategii żyje w `fulfilment-strategy-resolver.ts`:

| Strategy | Behaviour |
| --- | --- |
| `any` | Wybierz pierwszy magazyn (lex po code), który zaspokoi linię w całości |
| `default_first` | Jedyna strategia dzieląca linię między magazyny; magazyn domyślny pierwszy, reszta lex po code |
| `lowest_stock_first` | Magazyn z najmniejszym wystarczającym `available` (lex tie-break) |
| `highest_stock_first` | Magazyn z największym `available` (lex tie-break) |
| `defined_order` | Obchodź skonfigurowaną listę id magazynów w kolejności; pierwszy wystarczający wygrywa |

Gdy `backorderEnabled = true`, wszystkie pięć strategii pozwala linii przejść z resztą
oznaczoną jako backorder względem magazynu first-choice.

Ścieżka składania zamówienia zapisuje jeden wiersz `stock_allocations` per pozycja.
Anulowanie uruchamia `OrderService.releaseAllocations(orderId)`, który dekrementuje
`stock_levels.reserved` per alokacja i stempluje `released_at`.

## Kontrakt reserve / release

`OrderService.placeOrder` otwiera `SELECT … FOR UPDATE` per wiersz
`(product_id, variant_id, warehouse_id)` w transakcji składania. Magazyn domyślny
jest rozwiązywany z `warehouse_channel_assignments` dla kanału sprzedaży zamówienia.
Równolegli składający serializują się; przegrany podnosi `409 STOCK_UNAVAILABLE`,
chyba że `backorderEnabled = true` na produkcie — wtedy linia przechodzi z
`is_backorder = true`.

`releaseAllocations(orderId)` jest idempotentne — już zwolnione wiersze są
odfiltrowane przez `released_at IS NULL`. Uruchamia się automatycznie przy anulowaniu
zamówienia obok release limitu kredytowego.

## Notify-when-available

Klient subskrybuje przez endpoint storefront `/notify-when-available` (ścieżka
zalogowana; e-mail wstępnie wypełniony) lub dialog po stronie klienta (anonimowy;
e-mail w ciele). Subskrypcja jest odrzucana z `PRODUCT_UNMANAGED_STOCK`, gdy produkt
zrezygnował ze śledzenia stocku; idempotentne ponowne subskrypcje zwracają istniejący wiersz.

`AvailabilityWorker.attach(eventBus)` nasłuchuje zdarzeń `inventory.adjusted.v1`.
Fan-out odpala tylko, gdy *skumulowany przez magazyny* przekracza 0 → > 0 — doładowania
pojedynczego magazynu, które nie podnoszą skumulowanego powyżej zera, nigdy nie
triggerują e-maili.

## Alerty low-stock

`LowStockAlertService.attach(eventBus)` nasłuchuje tego samego zdarzenia. Gdy skumulowany
on-hand przechodzi z powyżej `lowStockThreshold` produktu na at-or-below, jeden e-mail
idzie do odbiorcy skonfigurowanego przez `inventory.low_stock_alert_recipient_email`.
Detektor jest platform-wide, nie per-kanał.

## Reconciler przy starcie

`WarehouseChannelReconciler` działa przy starcie PO `DefaultChannelReconciler`, więc
każdy aktywny kanał sprzedaży kończy sparowany z co najmniej jednym magazynem i
dokładnie jednym przypisaniem `is_default`. Reconciler jest idempotentny i obsługuje
przypadek kanałów utworzonych po migracji.

## Stałe

- `DEFAULT_WAREHOUSE_ID` = `00000000-0000-4000-8000-00000000d017`
- `DEFAULT_WAREHOUSE_CODE` = `default`

Obie są eksportowane z `packages/modules/inventory/src/backend/entities/warehouse.entity.ts`.

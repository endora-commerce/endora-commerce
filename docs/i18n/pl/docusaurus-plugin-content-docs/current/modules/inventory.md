---
title: inventory
description: Stany magazynowe, rezerwacje, powiadomienia o dostępności
---

# `inventory`

Moduł stanów magazynowych w wielu magazynach: dane magazynów, liczniki stanu fizycznego (on-hand) i
zarezerwowanego (reserved) dla każdej pary `(product, warehouse)`, przypisanie magazynów do kanałów
sprzedaży, alerty o niskim stanie, przedziały dostępności wyświetlane w sklepie, sprzedaż na
zamówienie (backorder), produkty bez śledzenia stanu, powiadomienia o dostępności, import CSV oraz
zapis alokacji `stock_allocations` dla każdej pozycji zamówienia.

Moduł zastępuje pierwotny model z jednym wspólnym stanem. Migracja 030 zachowuje pierwotną tabelę
`stock_levels`, ale rozszerza unikalność do `(product_id, variant_id, warehouse_id)`, tworzy magazyn
`Default` ze stałym UUID `00000000-0000-4000-8000-00000000d017` i przypisuje do niego każdy aktywny
kanał sprzedaży przez nową tabelę `warehouse_channel_assignments`.

## Encje modułu

| Encja | Przeznaczenie |
| --- | --- |
| `Warehouse` | Dane magazynu (nazwa, kod, flaga aktywności, kontakt, adres) |
| `StockLevel` | Wiersz `(product_id, variant_id, warehouse_id)` z `on_hand` i `reserved` |
| `WarehouseChannelAssignment` | Przypisanie wiele-do-wielu magazyn ↔ kanał sprzedaży; najwyżej jedno `is_default = true` na kanał |
| `InventoryThreshold` | Progi przedziałów dostępności w zakresie `global` / `category` / `product` |
| `StockAllocation` | Jeden wiersz na parę `(order_item, warehouse)` — skąd realizowana jest pozycja i podstawa zwolnienia rezerwacji |
| `AvailabilityNotification` | Zapis klienta albo anonimowego adresu e-mail na powiadomienie o ponownej dostępności |

## Ustawienia modułu

Siedem kluczy w grupie `inventory`:

| Kod | Typ | Wartość domyślna | Uwagi |
| --- | --- | --- | --- |
| `inventory.display_mode` | string | `band` | Sposób pokazywania stanu w storefroncie: `exact` / `band` / `available_or_not` |
| `inventory.fulfilment_strategy` | string | `default_first` | `any` / `default_first` / `lowest_stock_first` / `highest_stock_first` / `defined_order` |
| `inventory.fulfilment_strategy_warehouse_order` | json | `[]` | Kolejność magazynów dla strategii `defined_order` |
| `inventory.global_threshold_high` | number | `100` | Łączny stan, od którego produkt ma „wysoki stan” |
| `inventory.global_threshold_medium` | number | `20` | Od którego ma „średni stan” |
| `inventory.global_threshold_low` | number | `1` | Od którego ma „niski stan”; poniżej jest niedostępny |
| `inventory.low_stock_alert_recipient_email` | string | `''` | Gdy puste, używana jest zmienna środowiskowa `INVENTORY_LOW_STOCK_RECIPIENT` |

## API publiczne

Trasy administracyjne są chronione przez `inventory:read` (odczyt) i `inventory:write` (zapis) —
własne kody modułu od 2026-08-29. Wcześniej wszystkie 21 tras wymagało `orders:read` i
`catalog:write`; zobacz **Uprawnienia** niżej.

Tabela wymienia wszystkie 21 tras administracyjnych. Do 2026-08-29 wymieniała dziesięć i pomijała
zapis progów dla par (produkt, magazyn) oraz obie trasy zachowane dla zgodności wstecznej — to ten
rodzaj luki, który każda z czterech wcześniejszych poprawek uprawnień znajdowała na stronie modułu.

| Metoda i ścieżka | Uprawnienie | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/inventory` | `inventory:read` | Wskaźniki na stronę główną: śledzone produkty, łączny stan, liczba produktów niedostępnych i z niskim stanem, sumy dla magazynów |
| `GET /api/v1/admin/inventory/levels` | `inventory:read` | Lista produktów z łącznym stanem, rozbiciem na magazyny i przedziałem dostępności |
| `PUT /api/v1/admin/inventory/levels` | `inventory:write` | Ustawienie bezwzględnego stanu dla `(productId, warehouseId, variantId?)`; emituje `inventory.adjusted.v1` |
| `PUT /api/v1/admin/inventory/warehouse-low-stock-thresholds` | `inventory:write` | Progi niskiego stanu dla par (produkt, magazyn) |
| `GET /api/v1/admin/inventory/low-stock` | `inventory:read` | Produkty, których łączny stan jest równy `lowStockThreshold` albo niższy |
| `GET /api/v1/admin/inventory/thresholds` | `inventory:read` | Odczyt progów przedziałów dostępności — globalnych, dla kategorii i dla produktów |
| `PATCH /api/v1/admin/inventory/thresholds` | `inventory:write` | Aktualizacja progów |
| `GET /api/v1/admin/warehouses[/:id]` | `inventory:read` | Lista i szczegóły magazynów |
| `POST/PATCH/DELETE /api/v1/admin/warehouses[/:id]` | `inventory:write` | Zarządzanie magazynami; usunięcie jest odrzucane, gdy magazyn jest domyślny dla kanału albo ma stan |
| `GET /api/v1/admin/sales-channels/:id/warehouses` | `inventory:read` | Magazyny przypisane do kanału |
| `POST/PATCH/DELETE /api/v1/admin/sales-channels/:id/warehouses[/:assignmentId]` | `inventory:write` | Przypisanie kanał ↔ magazyn, z najwyżej jednym magazynem domyślnym na kanał |
| `GET /api/v1/admin/inventory/availability-notifications` | `inventory:read` | Podgląd kolejki powiadomień o ponownej dostępności |
| `PATCH /api/v1/admin/inventory/availability-notifications/:id` | `inventory:write` | Anulowanie zapisu na powiadomienie |
| `POST /api/v1/admin/inventory/import` | `inventory:write` | Import stanów z CSV (`?dryRun=true` sprawdza dane bez zapisu) |
| `PUT /api/v1/admin/inventory` | `inventory:write` | **Wycofywany** zapis w pierwotnym modelu z jednym stanem; deleguje do `StockLevelService.setOnHand` dla magazynu Default |
| `GET /api/v1/admin/inventory/legacy` | `inventory:read` | **Wycofywana** lista w pierwotnym modelu z jednym stanem |
| `GET /api/v1/storefront/inventory/display-mode` | — | Publiczny odczyt dla storefrontu: jak kanał pokazuje stan |

Trasy publiczne:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/storefront/inventory/stock/:id` | Publiczny stan produktu dla storefrontu, z łącznym stanem liczonym tylko z magazynów przypisanych do kanału wywołującego |
| `POST /api/v1/catalog/products/:id/notify-when-available` | Klient zapisuje się na powiadomienie o ponownej dostępności; zalogowanym e-mail jest wypełniany automatycznie |

## Uprawnienia

`inventory:read` i `inventory:write`, należące do modułu od 2026-08-29.

Wcześniej wszystkie 21 tras administracyjnych wymagało kodów dwóch innych modułów — dziewięć odczytów
`orders:read`, a dwanaście zapisów `catalog:write`. Kto mógł edytować opis produktu, mógł tworzyć,
zmieniać nazwy i usuwać magazyny, nadpisywać stany, uruchamiać import CSV obejmujący stany wszystkich
produktów i przypisywać magazyny do kanałów sprzedaży lub je odłączać; a kto mógł czytać zamówienia,
mógł wyliczyć wszystkie magazyny i ich adresy. Żaden z tych kodów nie opisuje danych, do których daje
dostęp — a właśnie to rozstrzyga, kto jest właścicielem uprawnienia: osobno dla każdej trasy, a nie dla
modułu.

**Nie ma migracji danych**: rola, która miała dostęp do tych ekranów dzięki `catalog:write` albo
`orders:read`, musi jawnie dostać nowe kody na `/admin-roles`, gdzie manifest dodaje je
automatycznie. Przyznanie ich każdemu, kto ma stare kody, odtworzyłoby nadmierne uprawnienia, które
ten podział usuwa.

`test/contract/inventory/permission-authority.test.ts` sprawdza oba kierunki i oba stare kody.

### Wycofywane trasy

Dwie pierwotne trasy są starsze niż opisane wyżej API dla wielu magazynów i zawsze dotyczą magazynu
Default utworzonego przy instalacji. Nic w platformie nie wywołuje żadnej z nich — żaden ekran panelu,
żadne wywołanie klienta API panelu, żadne dane początkowe, żaden skrypt — więc istnieją wyłącznie dla
własnych integracji wdrożeń. Nie opieraj na nich nowego kodu.

| Metoda i ścieżka | Przeznaczenie | Zastępstwo |
| --- | --- | --- |
| `PUT /api/v1/admin/inventory` | Ustawienie bezwzględnego stanu dla `(productId, variantId?)` w magazynie Default | `PUT /api/v1/admin/inventory/levels`, który przyjmuje jawne `warehouseId` |
| `GET /api/v1/admin/inventory/legacy` | Płaskie wiersze `stock_levels`, od najnowszych, z opcjonalnym filtrem `productId` | `GET /api/v1/admin/inventory/levels` — zawiera wszystko oprócz `variantId` i `updatedAt` |

`PUT` deleguje teraz do tej samej usługi co `PUT .../levels`, więc emituje `inventory.adjusted.v1` i
dla nieznanego produktu odpowiada `404`, zamiast zapisywać dla niego wiersz stanu. Zostanie usunięty,
gdy logi dostępu z produkcji albo właściciel wdrożenia potwierdzą, że nic go nie wywołuje.

## Flagi produktu

Pięć nowych pól w `products`, zapisywanych przez `PATCH /api/v1/admin/catalog/products/:id`:

- `manageStock` (domyślnie `true`) — gdy `false`, storefront traktuje produkt jako zawsze dostępny, a
  koszyk i zamówienia w ogóle pomijają rezerwację.
- `backorderEnabled` (domyślnie `false`) — gdy `true`, checkout przy zerowym stanie jest akceptowany;
  powstały wiersz `stock_allocations` ma `is_backorder = true`.
- `lowStockThreshold` — opcjonalna liczba całkowita; gdy null, produkt nie wywołuje alertów o niskim
  stanie.
- `fulfilmentStrategy` — nadpisanie strategii globalnej dla produktu.
- `fulfilmentStrategyWarehouseOrder` — przy strategii `defined_order` uporządkowana lista UUID
  magazynów.

## Wyznaczanie przedziału dostępności

Wyszukiwanie progów w trzech zakresach `(product, category[], global)` odbywa się osobno dla każdego
klucza (high / medium / low), więc produkt może nadpisać tylko `low`, dziedzicząc `high` i `medium` z
wartości globalnych. Mechanizm znajduje się w
`packages/modules/inventory/src/backend/services/threshold-resolver.ts` i jest czystą funkcją w pełni
pokrytą testami jednostkowymi.

Mechanizm w `packages/modules/inventory/src/backend/services/display-band-resolver.ts` przypisuje
łącznemu stanowi jeden z przedziałów `high | medium | low | out_of_stock | available` (`available` to
osobna kategoria dla `manageStock = false`).

## Strategie realizacji

Pięć strategii znajduje się w `fulfilment-strategy-resolver.ts`:

| Strategia | Działanie |
| --- | --- |
| `any` | Wybiera pierwszy magazyn (według kodu, leksykograficznie), który w całości pokrywa pozycję |
| `default_first` | Jedyna strategia, która dzieli pozycję między magazyny; najpierw magazyn domyślny, potem pozostałe według kodu |
| `lowest_stock_first` | Magazyn z najmniejszym wystarczającym `available` (remisy według kodu) |
| `highest_stock_first` | Magazyn z największym `available` (remisy według kodu) |
| `defined_order` | Przechodzi skonfigurowaną listę magazynów w podanej kolejności; wygrywa pierwszy wystarczający |

Gdy `backorderEnabled = true`, każda z pięciu strategii pozwala złożyć zamówienie, a brakująca część
jest oznaczana jako sprzedaż na zamówienie w magazynie pierwszego wyboru.

Składanie zamówienia zapisuje jeden wiersz `stock_allocations` dla każdej pozycji. Anulowanie
uruchamia `OrderService.releaseAllocations(orderId)`, które dla każdej alokacji zmniejsza
`stock_levels.reserved` i zapisuje `released_at`.

## Rezerwacja i zwolnienie

`OrderService.placeOrder` w transakcji składania zamówienia wykonuje `SELECT … FOR UPDATE` na każdym
wierszu `(product_id, variant_id, warehouse_id)`. Magazyn domyślny jest wyznaczany z
`warehouse_channel_assignments` dla kanału sprzedaży zamówienia. Równoczesne zamówienia są
wykonywane po kolei; to, które przegra, kończy się `409 STOCK_UNAVAILABLE`, chyba że produkt ma
`backorderEnabled = true` — wtedy pozycja przechodzi z `is_backorder = true`.

`releaseAllocations(orderId)` jest idempotentne — już zwolnione wiersze są pomijane dzięki
`released_at IS NULL`. Uruchamia się automatycznie przy anulowaniu zamówienia, razem ze zwolnieniem
limitu kredytowego.

## Powiadomienia o dostępności

Klient zapisuje się przez endpoint storefrontu `/notify-when-available` (zalogowany; e-mail wypełniany
automatycznie) albo przez okno w przeglądarce (anonimowy; e-mail w treści żądania). Zapis jest
odrzucany z `PRODUCT_UNMANAGED_STOCK`, gdy produkt nie ma śledzenia stanu; ponowny zapis jest
idempotentny i zwraca istniejący wiersz.

`AvailabilityWorker.attach(eventBus)` nasłuchuje zdarzeń `inventory.adjusted.v1`. Powiadomienia są
rozsyłane tylko wtedy, gdy stan *łączny we wszystkich magazynach* zmienia się z 0 na > 0 — uzupełnienie
jednego magazynu, które nie podnosi stanu łącznego powyżej zera, nigdy nie wywołuje e-maili.

## Alerty o niskim stanie

`LowStockAlertService.attach(eventBus)` nasłuchuje tego samego zdarzenia. Gdy łączny stan spada
powyżej `lowStockThreshold` produktu do tej wartości albo poniżej, wysyłany jest jeden e-mail do
odbiorcy z `inventory.low_stock_alert_recipient_email`. Wykrywanie działa dla całej platformy, a nie
osobno dla kanałów.

## Uzgadnianie przy starcie

`WarehouseChannelReconciler` wykonuje się przy starcie PO `DefaultChannelReconciler`, dzięki czemu
każdy aktywny kanał sprzedaży ma co najmniej jeden przypisany magazyn i dokładnie jedno przypisanie
`is_default`. Uzgadnianie jest idempotentne i obsługuje kanały utworzone po migracji.

## Stałe

- `DEFAULT_WAREHOUSE_ID` = `00000000-0000-4000-8000-00000000d017`
- `DEFAULT_WAREHOUSE_CODE` = `default`

Obie są eksportowane z `packages/modules/inventory/src/backend/entities/warehouse.entity.ts`.

---
title: price_lists
description: Cenniki dla klienta, grupy i domyślne, z progami ilościowymi i korektami dla kategorii
---

# `price_lists`

Mechanizm cen — przebudowany na pierwotnych podstawach wyznaczania cen. Obejmuje:

- **CustomerGroup** — grupa organizacji korzystających ze wspólnego cennika.
- **PriceList** — nazwany cennik ze statusem w cyklu życia (`draft`, `scheduled`, `active`,
  `expired`), typem `type` (`base` albo `sale`), opcjonalnym okresem obowiązywania (`startsAt` /
  `endsAt`) oraz regułą `applicationRule` w postaci drzewa, która decyduje, którego klienta,
  organizacji lub kanału dotyczy cennik.
- **PriceListProduct** — przypisanie produktu do cennika, ze złożonym kluczem głównym.
- **PriceListPriceBracket** — wiersz ze złożonym kluczem głównym
  `(priceListId, productId, currencyCode, minQuantity)`, zawierający cenę jednostkową w danej walucie
  dla progu ilościowego. Luki między progami są dozwolone; mechanizm wyznaczania przechodzi wtedy do
  cennika o następnym priorytecie.
- **PriceDisplayModeOverride** — wiersz ze złożonym kluczem głównym `(scope, targetId)`, który
  nadpisuje łańcuch trybu wyświetlania cen na poziomie organizacji, kategorii lub produktu. Początkiem
  łańcucha są dwa klucze ustawień (`pricing.default_display_mode`,
  `pricing.unauthenticated_display_mode`).

Dawne tabele `PriceListItem` i `PriceListAssignment` (oraz kolumny `code` / `currency` / `priority` /
`isDefault` w `price_lists`) są utrzymywane przez migrację `20260504T125655_price_lists_engine.ts` wyłącznie jako tymczasowa warstwa
zgodności na czas przejścia „rozszerz → przenieś → zawęź”. Nowy kod MUSI korzystać ze schematu
mechanizmu cen przez `@endora-commerce/contracts`.

## Cykl życia

```text
draft ──activate──▶ scheduled ──auto on startsAt──▶ active ──auto on endsAt──▶ expired
  ▲                     │                              │                        │
  └──── draftify ───────┴────── draftify ──────────────┴────── activate (resets) ┘
```

- `activate` przestawia cennik `draft` (albo `expired`) na `scheduled`, gdy ustawiono przyszłe
  `startsAt`, a w przeciwnym razie od razu na `active`.
- `draftify` przywraca każdy cennik niesystemowy do `draft`.
- `PriceListStatusWorker.sweep()` wykonuje dwa przejścia zależne od czasu (`scheduled → active` w
  chwili `startsAt`, `active → expired` w chwili `endsAt`). Na produkcji wywołuje go co 5 minut
  powtarzalne zadanie BullMQ; w testach to samo `sweep()` jest dostępne przez
  `POST /api/v1/admin/price-lists-engine/internal/sweep`.

Cennik `Default` tworzony przy instalacji (`isSystem = true`) odrzuca każdą zmianę stanu, każde
usunięcie i każdą niepustą `applicationRule`. Migracja `20260504T125655_price_lists_engine.ts` tworzy w nim też progi na podstawie
dawnego `attributeValues.defaultPrice` każdego produktu, więc platforma zawsze ma użyteczną cenę
ostatecznej wartości zastępczej.

## Reguła stosowania (drzewo)

Kolumna JSONB `applicationRule` przechowuje unię rozłączną:

```ts
type ApplicationRule =
  | { kind: 'all' }
  | {
      kind: 'criterion';
      type: 'salesChannel' | 'customerGroup' | 'organization' | 'category' | 'currency';
      values: string[];                  // UUIDs (or ISO 4217 for currency)
    }
  | {
      kind: 'group';
      op: 'AND' | 'OR';
      children: ApplicationRule[];        // 1..20
    };
```

Ograniczenia (egzekwowane w kreatorze reguł po stronie klienta i przez normalizację w usłudze):

- Najwyżej 5 poziomów zagnieżdżonych grup.
- Listy wartości w kryterium są pozbawiane duplikatów; kody walut — zamieniane na wielkie litery.
- Puste grupy są odrzucane; jeśli korzeń zostaje pusty, jest zastępowany przez `{ kind: 'all' }` —
  ale `{ kind: 'all' }` jest dozwolone tylko w systemowym cenniku `Default`. Każdy inny cennik z
  pustą regułą jest odrzucany przy aktywacji (`400 empty_rule_on_non_default`).
- Nieznane identyfikatory celów (kanału, grupy klientów, organizacji, kategorii) są odrzucane z
  `400 unknown_target { type, values }`.

## Wyznaczanie ceny

`PricingService.resolveEngine({ product, variantId?, context })` zwraca:

```ts
{
  base:  { listId, bracket, listName },        // never null — Default is the floor
  sale:  { listId, bracket, listName } | null, // optional second tier
  displayMode: 'gross_only' | 'net_only' | 'both' | 'none',
  currencyCode: string
}
```

Algorytm:

1. Wczytaj wszystkie cenniki ze `status='active'`.
2. Sprawdź `applicationRule` każdego cennika względem kontekstu; zachowaj pasujące i podziel je
   według `type`.
3. W każdej grupie przejdź **łańcuch priorytetów**:
   - Poziom 1: jawne dopasowanie do organizacji.
   - Poziom 2: jawne dopasowanie do grupy klientów.
   - Poziom 3: jawne dopasowanie do kategorii.
   - Poziom 4: jawne dopasowanie do kanału sprzedaży.
   - Poziom 5: każdy inny pasujący cennik.
4. Na każdym poziomie wybierz zwycięzcę przez `tieBreak()` — najpierw najnowsze `modifiedAt`, potem
   `name` rosnąco.
5. Znajdź próg dla `(productId, currencyCode, quantity)`. Jeśli progu nie ma (luka), przejdź do
   cennika o następnym priorytecie w tej samej grupie; cennik Default jest zawsze na poziomie 5 grupy
   Base i stanowi ostateczne minimum.
6. Niezależnie wyznacz tryb wyświetlania przez
   `displayModeResolver(product, organization, customerKind)` w łańcuchu ustawienia → organizacja →
   kategoria → produkt.

Determinizm: te same dane wejściowe → ten sam wynik (bez zegara, bez losowości, pełny porządek przy
remisach). Z mechanizmu korzysta storefront (`GET /api/v1/storefront/products/:id/resolved-price`)
oraz koszyk i składanie zamówienia.

## Tryby wyświetlania

Cztery wartości: `gross_only`, `net_only`, `both`, `none`. Pierwsze trzy decydują o kolumnach cen we
wszystkich miejscach storefrontu, które pokazują cenę; `none` ukrywa wszystkie elementy ceny i
zastępuje przycisk Add-to-cart istniejącym przyciskiem zapytania ofertowego. Endpointy pozycji koszyka
i składania zamówienia dodatkowo odrzucają pozycję z `400 CART_PRODUCT_QUOTE_ONLY`, gdy dla trójki
`(product, organization, channel)` wyznaczony tryb to `none` — jako druga linia obrony.

## API publiczne

### Endpointy mechanizmu cen (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/price-lists-engine?status=&type=&search=` | Lista cenników z opcjonalnymi filtrami |
| `POST /api/v1/admin/price-lists-engine` | Utworzenie cennika w stanie `draft` |
| `GET /api/v1/admin/price-lists-engine/:id` | Odczyt jednego cennika |
| `PATCH /api/v1/admin/price-lists-engine/:id` | Zmiana nazwy, typu, dat albo applicationRule |
| `POST /api/v1/admin/price-lists-engine/:id/activate` | Cykl życia → scheduled albo active |
| `POST /api/v1/admin/price-lists-engine/:id/draftify` | Cykl życia → draft |
| `POST /api/v1/admin/price-lists-engine/:id/duplicate` | Kopia (z wyzerowanymi datami i statusem) |
| `GET /api/v1/admin/price-lists-engine/:id/products` | Lista produktów z progami w poszczególnych walutach |
| `PUT /api/v1/admin/price-lists-engine/:id/products` | Zamiana listy produktów (różnicowo) |
| `POST /api/v1/admin/price-lists-engine/:id/products` | Dodanie jednego produktu |
| `DELETE /api/v1/admin/price-lists-engine/:id/products/:productId` | Usunięcie (razem z progami) |
| `GET /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Odczyt progów jednego produktu |
| `PUT /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Zamiana progów (`{ bracketsByCurrency }`) |
| `POST /api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy` | Skopiowanie progów jednej waluty bez zmian do N innych |
| `POST /api/v1/admin/price-lists-engine/internal/sweep` | Jeden przebieg workera, tylko na potrzeby testów |

### Listy wyboru w kreatorze reguł (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/pricing/rule-targets/sales-channels` | Kanały do kreatora reguł |
| `GET /api/v1/admin/pricing/rule-targets/customer-groups` | Grupy klientów |
| `GET /api/v1/admin/pricing/rule-targets/organizations?search=&limit=` | Stronicowana lista organizacji |
| `GET /api/v1/admin/pricing/rule-targets/categories` | Pełne drzewo kategorii |
| `GET /api/v1/admin/pricing/rule-targets/currencies` | Waluty dostępne w którymkolwiek kanale sprzedaży |

### Tryby wyświetlania (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/pricing/display-mode-overrides?scope=` | Lista nadpisań |
| `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Odczyt jednego nadpisania |
| `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Utworzenie lub aktualizacja (`{ mode }`, albo `{ mode: 'inherit' }`, aby usunąć) |

### Panel powiązanych cenników (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/products/:productId/price-lists` | Wszystkie cenniki, w których jest produkt, z podsumowaniem progów w poszczególnych walutach i linkiem do cennika |

### Storefront (publiczne)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | Cena podstawowa, promocyjna i tryb wyświetlania dla klienta |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | Sam tryb wyświetlania (dla koszyka i miejsc, które wyznaczają ceny zbiorczo i osobno) |

Oba odczyty w storefroncie są wyznaczane **dla oglądającego**: korzystają z sesji kupującego, gdy
istnieje, a gdy jej nie ma, odpowiadają tak jak dla anonimowego użytkownika. Oglądającego ustala
jedna funkcja, więc tryb wyświetlania w wyznaczonej cenie i ten z tego endpointu nie mogą się różnić
dla tego samego wywołującego — kiedyś mogły, i zalogowany kupujący widział cenę netto na stronie
produktu, a brutto w koszyku, gdy `pricing.default_display_mode` i
`pricing.unauthenticated_display_mode` miały różne wartości. Odpowiedź wyznaczona dla organizacji ma
nagłówek `Cache-Control: private, no-store`; odpowiedź anonimowa go nie ma i pozostaje tą wersją,
którą przechowują roboty wyszukiwarek i wspólna pamięć podręczna storefrontu.

### Dawne API (nadal dostępne, dopóki wszystkie miejsca odczytu nie zostaną przeniesione)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET / PUT / DELETE /api/v1/admin/price-lists{,/:code,/:id}` | Dawne zarządzanie cennikami w starej postaci |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/items{,/:itemId}` | Dawne zarządzanie pozycjami |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/assignments{,/:assignmentId}` | Dawne zarządzanie przypisaniami |
| `GET /api/v1/admin/price-lists/preview?productSku=&quantity=&organizationId=&salesChannelCode=` | Dawny podgląd |

## Uwagi o migracji (przebudowa silnika)

Migracja modułu `20260504T125655_price_lists_engine.ts` przebudowuje schemat w jednej transakcji:

1. Zakłada blokadę doradczą ograniczoną do transakcji (`pg_advisory_xact_lock`), aby równoległe
   migracje wykonywały się po kolei; blokada zwalnia się wraz z końcem transakcji.
2. Dodaje nowe kolumny w `price_lists` (`type`, `status`, `startsAt`, `endsAt`, `modifiedAt`,
   `isSystem`, `applicationRule` JSONB).
3. Tworzy trzy nowe tabele (`price_list_products`, `price_list_price_brackets`,
   `price_display_mode_overrides`).
4. Tworzy cennik `Default` ze stałym UUID `00000000-0000-4000-8000-00000000d51b`.
5. Przechodzi przez każdy `Product`, którego `attributeValues` zawiera `defaultPrice` (albo, w razie
   jego braku, `price`), przypisuje go do cennika `Default` i zapisuje po jednym progu dla każdej
   waluty dostępnej w którymkolwiek kanale sprzedaży, kopiując tę samą kwotę do każdej waluty.

Dawne klucze `attributeValues.defaultPrice` i `attributeValues.price` **nie** są usuwane, więc
istniejące miejsca odczytu działają dalej, a migracja nie zapisuje żadnego pliku raportu.

Migracja jest **dodatkiem** względem dawnego schematu — tabele `price_list_items` i
`price_list_assignments` oraz kolumny `code`/`currency`/`priority`/`isDefault` w `price_lists`
pozostają, dopóki miejsca odczytu w `cart-service`, `comparison-service`, `catalog-query`,
`search-query` i `product-link.service` nie przejdą na nowy mechanizm. Dawne kolumny usunie kolejna
migracja, gdy zakończy się przegląd.

Ten sam backfill jest dostępny jako usługa `DefaultPriceListMigrator`
(`src/backend/services/default-price-list-migration.ts` w tym module). Jest idempotentna, więc można
ją bezpiecznie uruchomić ponownie, i zwraca ustrukturyzowany raport wymieniający każdy produkt,
którego pojedyncza dawna cena została skopiowana do więcej niż jednej waluty.

## Storefront

- Z `GET /api/v1/storefront/products/:id/resolved-price` korzysta `storefront/lib/api/pricing.ts`
  (`getResolvedPrice` / `getResolvedPricesBulk`); wersja zbiorcza wywołuje endpoint dla pojedynczych
  produktów z ograniczoną współbieżnością, dopóki w backendzie nie powstanie zbiorczy endpoint POST.
- `BaseSalePriceBlock`, `PriceTag` i `ProductCard` korzystają ze struktury `resolvedPrice`;
  `displayMode === 'none'` ukrywa wszystkie elementy ceny i pokazuje `QuoteRequestCta` (prowadzący
  do `AddToRfqForm`).
- Strona produktu pobiera cenę równolegle ze stanem magazynowym i zamienia wiersz Add-to-cart na
  przycisk zapytania ofertowego, gdy tryb to `none`.

## Panel administracyjny

- `/price-lists` (lista cenników) i `/price-lists/:id` (edytor z zakładkami Details / Products &
  brackets / Application rule).
- `/price-lists/display-modes` — przegląd nadpisań oraz dwa klucze ustawień `pricing.*`.
- `DisplayModeOverrideRow` jest osadzony w edytorze organizacji, w formularzu edycji drzewa kategorii
  i w panelu LinkedPriceListsPanel, który zastępuje dawny `PricingPlaceholder` w edytorze produktu.

## Punkty rozszerzenia

- **Pamięć podręczna LRU w procesie** wokół mechanizmu wyznaczania cen (odłożona — 60-sekundowe okno
  odświeżania storefrontu wystarcza na MVP). Do zrobienia: każda ścieżka zapisu w
  `PriceListService` powinna emitować `pricing.invalidate.v1`.
- **Przejście koszyka i składania zamówień na nowy mechanizm** — pierwotny koszyk i składanie
  zamówień nadal odczytują `attributeValues.defaultPrice`. Następna wersja wprowadzi
  `PricingService.resolveLinePrice()` i uzależni od niego konstruktor `cart-service`; w tej samej
  zmianie pojawi się dodatkowe sprawdzenie `displayMode === 'none'`.
- **Podłączenie workera statusów do BullMQ** — `PriceListStatusWorker.sweep()` jest gotowy, ale
  rejestracja powtarzalnego zadania BullMQ (wzorem workera wygasania zapytań ofertowych) czeka na
  kolejną zmianę.

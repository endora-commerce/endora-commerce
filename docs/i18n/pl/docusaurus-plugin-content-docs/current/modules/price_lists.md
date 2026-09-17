---
title: price_lists
description: Cenniki klienta / grupy / domyślne z progami ilościowymi + korektami per kategoria
---

# `price_lists`

Silnik cen — reshape feature 011 na fundamencie oryginalnego feature 014.
Posiada:

- **CustomerGroup** — adresowalny zbiór Organizations współdzielących cennik.
- **PriceList** — nazwany artefakt cenowy ze statusem cyklu życia
  (`draft`, `scheduled`, `active`, `expired`), `type` (`base` lub
  `sale`), opcjonalnym oknem aktywności (`startsAt` / `endsAt`) oraz
  AST `applicationRule` decydującym, któremu klientowi / org / kanałowi
  lista ma zastosowanie.
- **PriceListProduct** — przypisanie Product do PriceList ze złożonym PK.
- **PriceListPriceBracket** — wiersz ze złożonym PK
  `(priceListId, productId, currencyCode, minQuantity)` niosący
  cenę jednostkową per waluta dla progu ilości. Luki między progami są
  dozwolone; resolver przechodzi do listy następnego priorytetu.
- **PriceDisplayModeOverride** — wiersz ze złożonym PK
  `(scope, targetId)` nadpisujący łańcuch trybu wyświetlania resolvera w
  zakresie Organization / Category / Product. Korzeń łańcucha to dwa
  klucze Settings (`pricing.default_display_mode`,
  `pricing.unauthenticated_display_mode`).

Legacy tabele `PriceListItem` i `PriceListAssignment` (oraz kolumny
`code` / `currency` / `priority` / `isDefault` na `price_lists`)
są utrzymywane przez migrację 031 wyłącznie jako przejściowy shim podczas
rolloutu expand → migrate → contract. Nowo pisany kod MUSI konsumować
schemat silnika przez `@endora-commerce/contracts`.

## Cykl życia

```text
draft ──activate──▶ scheduled ──auto on startsAt──▶ active ──auto on endsAt──▶ expired
  ▲                     │                              │                        │
  └──── draftify ───────┴────── draftify ──────────────┴────── activate (resets) ┘
```

- `activate` przełącza listę `draft` (lub `expired`) na `scheduled`, gdy
  ustawione jest przyszłe `startsAt`, inaczej wprost na `active`.
- `draftify` zwraca każdą listę nie-systemową do `draft`.
- `PriceListStatusWorker.sweep()` wykonuje dwie przejścia sterowane zegarem
  (`scheduled → active` przy `startsAt`, `active → expired` przy `endsAt`).
  W produkcji wywoływany jest powtarzalnym jobem BullMQ co 5 min; w testach
  ten sam `sweep()` jest wystawiony przez `POST /api/v1/admin/price-lists-engine/internal/sweep`.

Seedowana lista `Default` (`isSystem = true`) odrzuca każdą zmianę
stanu, każde usunięcie i każde niepuste `applicationRule` (FR-005,
FR-006). Migracja 031 seeduje też na niej wiersze progów z legacy
`attributeValues.defaultPrice` każdego produktu, więc platforma zawsze
ma użyteczną cenę terminalnego fallbacku.

## Application Rule (AST)

Kolumna JSONB `applicationRule` przechowuje discriminated union:

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

Ograniczenia (egzekwowane client-side w rule builderze i przez
normaliser warstwy serwisu):

- Głębokość ≤ 5 zagnieżdżonych grup.
- Listy wartości per kryterium są deduplikowane; kody walut uppercased.
- Puste grupy są odrzucane; gdy korzeń kończy pusty, zastępowany jest
  `{ kind: 'all' }` — ale `{ kind: 'all' }` jest dozwolone tylko na
  systemowej liście `Default`. Każda inna lista z pustą regułą jest
  odrzucana przy aktywacji (`400 empty_rule_on_non_default`).
- Nieznane target ID (channel / customer-group / organization /
  category) są odrzucane z `400 unknown_target { type, values }`.

## Resolver

`PricingService.resolveEngine({ product, variantId?, context })`
zwraca:

```ts
{
  base:  { listId, bracket, listName },        // never null — Default is the floor
  sale:  { listId, bracket, listName } | null, // optional second tier
  displayMode: 'gross_only' | 'net_only' | 'both' | 'none',
  currencyCode: string
}
```

Algorytm (także w `data-model.md` § 5):

1. Załaduj każdą listę cenową ze `status='active'`.
2. Oceń `applicationRule` każdej listy względem kontekstu
   rozwiązywania; zachowaj dopasowania, partycjonuj po `type`.
3. Dla każdej partycji przejdź **łańcuch priorytetów** (FR-026 + FR-027):
   - Poziom 1: jawne dopasowanie organization.
   - Poziom 2: jawne dopasowanie customer-group.
   - Poziom 3: jawne dopasowanie category.
   - Poziom 4: jawne dopasowanie sales-channel.
   - Poziom 5: każda inna pasująca lista.
4. Wybierz zwycięzcę per poziom przez `tieBreak()` — najpierw najnowsze
   `modifiedAt`, potem leksykograficznie `name` ASC.
5. Wyszukaj bracket dla `(productId, currencyCode, quantity)`. Gdy
   brak bracketu (luka), przechodź do listy następnego priorytetu w
   tej samej partycji; lista Default jest zawsze na poziomie 5 partycji
   Base i służy jako terminalny floor.
6. Rozwiąż tryb wyświetlania niezależnie przez
   `displayModeResolver(product, organization, customerKind)` wzdłuż
   łańcucha Settings → Organization → Category → Product.

Determinizm: te same wejścia → te same wyjścia (bez zegara, bez losowości, całkowita
kolejność tie-break). Resolver jest konsumowany przez storefront
(`GET /api/v1/storefront/products/:id/resolved-price`) oraz ścieżki
koszyka i składania zamówienia.

## Tryby wyświetlania

Cztery wartości: `gross_only`, `net_only`, `both`, `none`. Pierwsze trzy
kontrolują układ kolumn na każdej powierzchni storefront z ceną;
`none` ukrywa każdy element ceny i zastępuje Add-to-cart istniejącym
CTA Quote Request z feature 008. Endpointy linii koszyka i
składania zamówienia dodatkowo odrzucają linię z
`400 product_quote_only`, gdy rozwiązany tryb to `none` dla krotki
`(product, organization, channel)` — defence in depth.

## Publiczne API

### Endpointy silnika (admin)

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/price-lists-engine?status=&type=&search=` | Lista list w kształcie silnika z opcjonalnymi filtrami |
| `POST /api/v1/admin/price-lists-engine` | Utworzenie listy draft |
| `GET /api/v1/admin/price-lists-engine/:id` | Odczyt jednej listy |
| `PATCH /api/v1/admin/price-lists-engine/:id` | Aktualizacja name / type / dates / applicationRule |
| `POST /api/v1/admin/price-lists-engine/:id/activate` | Cykl życia → scheduled lub active |
| `POST /api/v1/admin/price-lists-engine/:id/draftify` | Cykl życia → draft |
| `POST /api/v1/admin/price-lists-engine/:id/duplicate` | Klon (resetuje daty i status) |
| `GET /api/v1/admin/price-lists-engine/:id/products` | Rejestr + progi per waluta |
| `PUT /api/v1/admin/price-lists-engine/:id/products` | Zamiana rejestru (delta) |
| `POST /api/v1/admin/price-lists-engine/:id/products` | Dołączenie jednego produktu |
| `DELETE /api/v1/admin/price-lists-engine/:id/products/:productId` | Usunięcie (kaskada bracketów) |
| `GET /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Odczyt bracketów jednego produktu |
| `PUT /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Zamiana bracketów (`{ bracketsByCurrency }`) |
| `POST /api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy` | Kopia tożsamości jednej waluty do N innych |
| `POST /api/v1/admin/price-lists-engine/internal/sweep` | Tick workera tylko do testów |

### Pickery rule-buildera (admin)

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/pricing/rule-targets/sales-channels` | Opcje kanałów dla rule buildera |
| `GET /api/v1/admin/pricing/rule-targets/customer-groups` | Opcje customer-group |
| `GET /api/v1/admin/pricing/rule-targets/organizations?search=&limit=` | Paginowane opcje org |
| `GET /api/v1/admin/pricing/rule-targets/categories` | Pełne drzewo kategorii |
| `GET /api/v1/admin/pricing/rule-targets/currencies` | Waluty wystawione przez dowolny sales channel |

### Admin trybów wyświetlania

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/pricing/display-mode-overrides?scope=` | Lista nadpisań |
| `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Odczyt jednego |
| `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Upsert (`{ mode }` lub `{ mode: 'inherit' }` do usunięcia) |

### Panel powiązanych cenników (admin)

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/products/:productId/price-lists` | Wszystkie listy cenowe, w których produkt uczestniczy, z podsumowaniem bracketów per waluta i deep-linkiem |

### Storefront (public)

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | Base + Sale + tryb wyświetlania per klient |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | Tylko tryb wyświetlania (używany przez koszyk i powierzchnie batch rozwiązujące cenę osobno) |

Oba odczyty storefront są rozwiązywane **dla oglądającego**: biorą sesję
kupującego, gdy jest, i odpowiadają jak publiczne, gdy jej nie ma. Wyprowadzają
tego oglądającego jedną funkcją, więc tryb wyświetlania w rozwiązanej cenie i ten
z tego endpointu nie mogą się różnić dla tego samego
wywołującego — przed issue #271 mogły, i zalogowany kupujący czytał netto na
stronie produktu i brutto w koszyku, gdzie `pricing.default_display_mode` i
`pricing.unauthenticated_display_mode` były ustawione inaczej. Odpowiedź rozwiązana
dla Organization niesie `Cache-Control: private, no-store`; anonimowa
nie jest stemplowana i pozostaje reprezentacją, którą trzyma crawler i współdzielone
okno storefront.

### Legacy (feature 014 — nadal serwowane, dopóki każdy reader nie zmigruje)

| Verb + Path | Cel |
| --- | --- |
| `GET / PUT / DELETE /api/v1/admin/price-lists{,/:code,/:id}` | Legacy CRUD nad starym kształtem |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/items{,/:itemId}` | Legacy CRUD pozycji |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/assignments{,/:assignmentId}` | Legacy CRUD przypisań |
| `GET /api/v1/admin/price-lists/preview?productSku=&quantity=&organizationId=&salesChannelCode=` | Legacy preview |

## Notatki migracyjne (031)

`031_price_lists_engine.ts` wykonuje 8-krokowy reshape transakcyjny:

1. Pobierz advisory lock, aby równoległe migracje wycofały się czysto.
2. Dodaj nowe kolumny na `price_lists` (`type`, `status`, `startsAt`,
   `endsAt`, `modifiedAt`, `isSystem`, `applicationRule` JSONB).
3. Utwórz trzy nowe tabele (`price_list_products`,
   `price_list_price_brackets`, `price_display_mode_overrides`).
4. Seeduj listę `Default` deterministycznym UUID.
5. Przejdź każdy `Product`, którego `attributeValues` niesie `defaultPrice`
   (lub `price` jako fallback), i upsertuj jeden wiersz bracketu per waluta
   wystawiona przez dowolny sales channel. Kopia tożsamości między walutami jest
   oznaczona w raporcie migracji.
6. Usuń legacy klucze `attributeValues.defaultPrice` i
   `attributeValues.price` (zgodnie z FR-047).
7. Wyemituj raport do `backend/var/migration-reports/011_price_lists_seed.json`.
8. Zwolnij advisory lock.

Migracja jest **addytywna** względem legacy schematu — tabele
`price_list_items` i `price_list_assignments` oraz kolumny
`code`/`currency`/`priority`/`isDefault` na `price_lists`
pozostają, dopóki readery w `cart-service`, `comparison-service`,
`catalog-query`, `search-query` i `product-link.service` nie
przejdą na resolver. Follow-up migracja usuwa kolumny legacy, gdy
audit (T103) wyląduje.

Helper migracji (`default-price-list-migration.ts`) jest idempotentny
i może być ponownie uruchomiony jako komenda naprawcza.

## Integracja storefront

- `GET /api/v1/storefront/products/:id/resolved-price` jest konsumowany przez
  `storefront/lib/api/pricing.ts` (`getResolvedPrice` /
  `getResolvedPricesBulk`); wrapper bulk rozgałęzia na endpoint
  pojedynczy z ograniczoną współbieżnością, dopóki nie wyląduje backend POST batch.
- `BaseSalePriceBlock`, `PriceTag` i `ProductCard` konsumują
  kopertę `resolvedPrice`; `displayMode === 'none'` ukrywa każdy element
  ceny i pokazuje `QuoteRequestCta` (routing przez
  `AddToRfqForm` z feature 008).
- PDP pobiera resolver równolegle ze stockiem i zamienia wiersz
  Add-to-cart na QuoteRequest CTA, gdy tryb to `none`.

## Integracja admin

- `/price-lists` (lista silnika) i `/price-lists/:id` (edytor z
  zakładkami Details / Products & brackets / Application rule).
- `/price-lists/display-modes` — przeglądarka nadpisań plus dwa
  klucze settings `pricing.*`.
- `DisplayModeOverrideRow` jest osadzony w edytorze Organization,
  drzewie Categories EditForm oraz LinkedPriceListsPanel, który
  zastępuje stary `PricingPlaceholder` w edytorze produktu katalogu.

## Punkty rozszerzenia

- **Cache LRU in-memory** wokół resolvera zgodnie z
  `contracts/pricing-resolution.contract.md` § Caching behaviour
  (odroczone — 60-s okno revalidate storefront wystarcza na
  MVP). Bookkeeping: każda ścieżka zapisu w `PriceListService`
  powinna emitować `pricing.invalidate.v1`.
- **Swap cart-service / order-placement** — foundation cart i
  ścieżki składania zamówienia nadal czytają `attributeValues.defaultPrice`.
  Następna iteracja wprowadza `PricingService.resolveLinePrice()`
  i podmienia konstruktor cart-service na zależność od niego; check
  defence-in-depth dla `displayMode === 'none'` ląduje w tej samej zmianie.
- **Podłączenie workera statusów BullMQ** — `PriceListStatusWorker.sweep()` jest
  gotowy, ale rejestracja repeatable job BullMQ (na wzór
  workera wygaśnięcia RFQ z feature 008) czeka w follow-up.

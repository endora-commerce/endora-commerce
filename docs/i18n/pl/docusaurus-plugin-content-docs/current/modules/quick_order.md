---
title: quick_order
description: Import CSV i podpowiedzi dla kupujących zamawiających według SKU
---

# `quick_order`

**Zestaw narzędzi do szybkiego zamawiania** w platformie. Łączy kilka udogodnień, dzięki którym
kupujący B2B składają powtarzalne i hurtowe zamówienia w jak najmniejszej liczbie kroków —
korzystając z istniejących możliwości koszyka, zapytań ofertowych, zamówień i checkoutu, organizacji,
metod płatności i dostawy, katalogu oraz ustawień, zamiast wprowadzać równoległy mechanizm
zamawiania.

## Możliwości

### 1. Import CSV / Excel → koszyk lub zapytanie ofertowe

`POST /api/v1/quick-order/import` przyjmuje wklejony CSV (`csv`) **albo** przesłany plik CSV /
`.xlsx` (`file: { filename, contentBase64 }`). Oba są sprowadzane do tego samego modelu wiersza i
sprawdzane względem katalogu:

- Wymagane kolumny to `sku` i `quantity` (wiersz nagłówka, dowolna kolejność, bez rozróżniania
  wielkości liter). Każda inna kolumna jest traktowana jako **wartość atrybutu wariantu** i
  dopasowywana do atrybutów osi wariantów produktu nadrzędnego — wiersz zostaje rozpoznany tylko
  wtedy, gdy pasuje dokładnie jeden wariant dostępny do zakupu.
- Odpowiedź dzieli wiersze na `recognized` i `rejected` (każdy odrzucony z powodem: `sku_missing`,
  `quantity_invalid`, `product_not_found`, `product_archived`, `malformed_row`,
  `variant_not_resolved`, `variant_ambiguous`, `row_limit_exceeded`, `below_minimum`) i zawiera
  `summary`.
- Powtórzone SKU są łączone (ilości się sumują); wiersze powyżej `quick_order.import_max_rows` są
  odrzucane. Ustawienie jest ograniczane do zakresu **1–10 000** bez względu na zapisaną wartość.

`POST /api/v1/quick-order/build` zamienia potwierdzone, rozpoznane wiersze w **koszyk**
(`CartService`) albo **zapytanie ofertowe** (`RfqService`), z bieżącymi cenami kupującego z
cenników — wyceną koszyka dla koszyka i cenami referencyjnymi zapytania dla zapytania.
Odpowiedniki w panelu administracyjnym
(`/api/v1/admin/quick-order/import` i `/build`, chronione przez `orders:write`) budują koszyk lub
zapytanie w imieniu wybranego klienta przez `onBehalfOf`.

**Minimalne ilości zamówienia w pliku.** Podgląd ocenia minimum każdego produktu w sztukach na
**łącznej ilości produktu w całym pliku** — po połączeniu powtórzonych wierszy i zsumowaniu
wszystkich wariantów produktu — nigdy razem z koszykiem kupującego, więc werdykt podglądu i
budowania mogą się różnić. Wiersze odrzucone z innego powodu nie liczą się do żadnej sumy.

- W imporcie **kupującego** każdy wiersz produktu, którego suma w pliku jest poniżej minimum, jest
  odrzucany z powodem `below_minimum`, z `minimum` i `productTotal` użytymi w werdykcie.
- W imporcie **operatora** (trasa panelu) taki wiersz zostaje w `recognized` z
  `warning: { reason: 'below_minimum', minimum, productTotal }`, a podsumowanie liczy go w
  `warningCount`. Ekran zamawiania w imieniu klienta oznacza wiersz plakietką i nadal go buduje — do
  zapytania ofertowego bez zmian, do koszyka z zastrzeżeniem sprawdzenia koszyka.

**Budowanie.** Budowanie z więcej niż **200** pozycjami jest odrzucane w całości z kodem
`422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, przed czymkolwiek
innym, dla obu celów, tak samo dla kupującego i operatora.

- Cel `cart` dodaje pozycje jedną partią ocenianą razem z koszykiem: pozycje spełniające minima są
  dodawane, pozostałe trafiają do `rejected[]` (`reason: 'below_minimum'`, `kind`, `minimum` oraz
  `packagingUnitName` dla minimum jednostki opakowania). Produkt, którego klient nie może zobaczyć
  albo którego kanał nie publikuje, kończy budowanie jako nieznany produkt, zanim cokolwiek
  zostanie dodane.
- Cel `quote_request` to jedno zapytanie ofertowe, nie partia: budowanie kupującego jest odrzucane
  poniżej minimum jak każde zapytanie ofertowe klienta, a budowanie operatora jest zapisywane z
  pozycjami oznaczonymi dla działu sprzedaży (strona modułu Quote Requests).

Pliki `.xlsx` są odczytywane przez **`exceljs`** (tylko w backendzie, w osobnym pliku
`excel-importer.ts`); czytany jest tylko pierwszy arkusz.

### 2. Szybkie wyszukiwanie

`GET /api/v1/quick-order/search?q=` dopasowuje według SKU, nazwy produktu oraz wartości atrybutów
oznaczonych jako **`quick_searchable`** (osobna flaga logiczna w `product_attributes`, przełączana w
zarządzaniu atrybutami w panelu). Wartości atrybutów bez tej flagi nigdy nie są dopasowywane.
Wymaga sesji; ograniczone do kanału sprzedaży.

### 3. Domyślne preferencje zamawiania

`quick_order_default_preferences` przechowuje cztery wartości domyślne — metodę płatności, metodę
dostawy, adres do faktury i adres dostawy — dla każdego celu (`scope` = `organization` |
`customer`). Wygrywa wartość najbardziej szczegółowa (ustawienie klienta nadpisuje ustawienie
organizacji, osobno dla każdego pola), a w chwili użycia sprawdzane jest ponownie, czy wartość jest
nadal dopuszczalna (aktywna, dozwolona dla organizacji, adres istnieje — w przeciwnym razie null).

- Storefront: klient zarządza własnymi wartościami domyślnymi (`/preferences`); checkout wstępnie
  wybiera wyznaczone wartości domyślne.
- Panel: `/api/v1/admin/quick-order/preferences` — administrator platformy zarządza dowolnym
  zakresem, a handlowiec tylko przypisanymi organizacjami i ich klientami. Każda zmiana jest
  audytowana.

### 4. Ponowne zamówienie

„Zamów ponownie” przy wcześniejszym zamówieniu tworzy nowy koszyk (`POST /orders/:id/reorder`) albo
nowe zapytanie ofertowe (`POST /orders/:id/clone-to-quote`) po bieżących cenach, zgłaszając
niedostępne pozycje i respektując ustawienie `orders.reorder_enabled`.

### 5. Zakup jednym kliknięciem

Gdy w kanale sprzedaży kupującego włączone jest `quick_order.one_click_buy_enabled` **i** kupujący
ma wszystkie cztery dopuszczalne wartości domyślne, strona produktu pokazuje przycisk „Kup jednym
kliknięciem”. Pomija on koszyk i checkout: zamówienie jest składane z wartości domyślnych,
a kupujący trafia tam, gdzie wskazuje `nextAction` płatności (przekierowanie do bramki albo strona
zamówienia lub sukcesu, gdy krok płatności nie jest potrzebny).

Produkt staje się całym koszykiem kupującego przez metodę koszyka `addItems` z
`replaceExisting: true` i `onBelowMinimum: 'throw'`, a następnie `OrderService.placeOrder` składa
zamówienie. `addItems` opróżnia koszyk dopiero wtedy, gdy nie ma już powodu, by odrzucić pozycję,
więc pozycja odrzucona przed zapisem — poniżej minimalnej ilości zamówienia, bez ceny albo dostępna
tylko przez zapytanie ofertowe — zostawia koszyk dokładnie takim, jaki był. Odmowa przy składaniu
zamówienia, już po zapisaniu pozycji (stan magazynowy, organizacja, metoda płatności lub dostawy),
zostawia w koszyku tę jedną pozycję z zakupu jednym kliknięciem.

Obowiązują te same warunki co przy zwykłym zamówieniu (aktywna organizacja, wartość minimalna, limit
kredytowy, stan magazynowy, minimalna ilość zamówienia). Dla produktu `simple` lub `configurable` z
minimalną ilością zamówienia jedno kliknięcie zamawia to minimum zamiast 1.

## Ustawienia

| Kod | Typ | Wartość domyślna | Zakres |
|------|------|---------|-------|
| `quick_order.one_click_buy_enabled` | boolean | `false` | dla kanału sprzedaży |
| `quick_order.import_max_rows` | number | `2000` (ograniczane do 1–10 000) | globalnie |

## Dane

- Nowa tabela `quick_order_default_preferences` (migracja `20260611T140359_quick_order_default_preferences.ts`).
- Nowa kolumna `product_attributes.quick_searchable` (migracja `20260611T140400_catalog_attribute_quick_searchable.ts`,
  należy do `catalog`).

## Zależności

Korzysta z `orders` (rdzeń zamawiania), `carts`, `quote_requests`, `organizations`,
`payment_methods`, `delivery_methods`, `catalog`, `addresses` i `settings`. Moduł `orders` **nie**
zależy od `quick_order`; zakup jednym kliknięciem dostaje `OrderService` przez leniwy getter
podłączony przy kompozycji.

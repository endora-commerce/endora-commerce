---
title: Jednostki opakowania
---

# Jednostki opakowania

Nazwane jednostki zamawiania przypisane do produktu — na przykład **Paleta** zawierająca 480 sztuk.
Pozwalają kupującym B2B zamawiać w jednostkach hurtowych bez wpisywania dokładnej liczby sztuk, a ta
informacja trafia aż do zamówienia i zapytania ofertowego.

## Dla operatora

Jednostkami opakowania zarządza się w sekcji **Inventory** karty produktu (tylko produkty typu
simple i configurable). Każda jednostka ma:

- **nazwę** (tekst operatora, np. `Paleta`, `Karton`) — unikalną w obrębie produktu,
- **base quantity** (liczba całkowita ≥ 1) — ile sztuk mieści jednostka,
- flagę **default** — jednostka wybrana domyślnie w storefroncie,
- **position** — kolejność, w jakiej jednostki są wyświetlane,
- opcjonalne **minimum** — najmniejsza liczba tej jednostki, jaką kupujący może zamówić naraz
  (liczba całkowita od 1 do 1 000 000; puste pole oznacza brak minimum).

## Minimalna liczba jednostek

Minimum jednostki liczy się ze **wszystkich pozycji produktu zamawianych w tej jednostce**, we
wszystkich wariantach: pozycja wnosi swoją liczbę sztuk podzieloną przez base quantity jednostki.
Minimum 2 dla palety spełnia jedna pozycja z 2 paletami albo dwie pozycje po 1 palecie różnych
wariantów. Jest niezależne od minimum produktu w sztukach (ustawianego na karcie **Zasady
zamawiania** produktu): można ustawić oba, a zamówienie musi spełnić każde z nich. Sztuki
zamawiane pojedynczo albo w innej jednostce nie liczą się do minimum tej jednostki, ale każda
pozycja liczy się do minimum w sztukach.

Koszyk, zapytanie ofertowe albo zamówienie, w którym jednostka nie osiąga swojego minimum, jest
odrzucane z kodem `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, a komunikat podaje produkt, minimum i
jednostkę. Storefront zaczyna ilość od minimum wybranej jednostki. Ekran tworzenia zamówienia w
panelu administracyjnym i zewnętrzne API zamówień nie przekazują jednostki opakowania, więc działa
tam tylko minimum w sztukach.

W zapytaniu ofertowym pozycja wskazuje jednostkę przez `packagingUnitId`; serwer zapisuje dla niej
nazwę i base quantity z katalogu. Pozycja, która przesyła nazwę jednostki i base quantity bez
identyfikatora, jest przyjmowana tylko wtedy, gdy oba pasują do jednej z jednostek produktu.
Wszystko inne jest odrzucane z kodem `422 PACKAGING_UNIT_MISMATCH` — identyfikator nieznany,
usunięty albo należący do innego produktu daje ten sam powód.

## Dla kupującego

Na stronie produktu lista wyboru oferuje dostępne jednostki oraz opcję *pojedynczej sztuki*.
Zamówienie jednostki dodaje do koszyka `baseQuantity × units` sztuk jako jedną pozycję, której
wyświetlana nazwa ma dopisek z jednostką — np. `Łożysko 6205-2RS (Paleta)`. Pozycja z jednostką
opakowania i zwykła pozycja z pojedynczymi sztukami tego samego produktu pozostają osobne.

## Co dzieje się z nazwą jednostki

Nazwa jednostki i base quantity są **kopiowane** do pozycji w chwili jej utworzenia, więc późniejsze
zmiany (albo usunięcie) jednostek opakowania produktu nigdy nie zmieniają historycznych koszyków,
zamówień ani zapytań ofertowych.

- **Koszyk** — `cart_items` zapisują kopię jednostki; serializacja koszyka buduje `displayName` z
  dopiskiem.
- **Zamówienie** — `order_items` dostają `packaging_unit_snapshot`, a nazwa jednostki jest
  dopisywana do `product_snapshot.name`, więc pokazuje ją każdy dokument zamówienia (szczegóły,
  faktura, CSV, e-mail).
- **Zapytanie ofertowe** — `quote_request_items` zapisują kopię jednostki i dopisują ją do
  `product_name`; zamiana koszyka w zapytanie ofertowe przenosi tę informację dalej.

## Ceny i dostępność

Pozycja w jednostce opakowania jest wyceniana z cenników na podstawie wynikowej liczby sztuk
(łącznie z progami ilościowymi cenników) — nie ma osobnej ceny za jednostkę. Dostępność w magazynie i limity dla pozycji
są sprawdzane dla wynikowej liczby sztuk.

## API

- Zarządzanie w panelu: `GET/POST /api/v1/admin/catalog/products/:id/packaging-units`,
  `PATCH/DELETE …/:unitId`, `PATCH …/packaging-units/reorder` (chronione przez `catalog:read` /
  `catalog:write`). Tworzenie i aktualizacja przyjmują opcjonalne `minOrderUnits` (`1…1000000`
  albo `null`, aby je usunąć); odpowiedź zawsze je zawiera. Wewnątrzprocesowy
  `CatalogPackagingPort`, używany przez konektory PIM, przyjmuje to samo opcjonalne pole i odrzuca
  wartość spoza zakresu z kodem `422 VALIDATION_FAILED`; zapisujący, który go nie wysyła, działa
  dalej.
- Publiczne: szczegóły produktu (`GET /api/v1/catalog/products/:idOrSlug`) zawierają opcjonalną
  tablicę `packagingUnits`; każda jednostka niesie `minOrderUnits` (`null`, gdy minimum nie ma).
- Koszyk: `POST /api/v1/cart/items` przyjmuje opcjonalne `packagingUnitId`; wynikowa ilość w pozycji
  to `baseQuantity × quantity`.

## Schemat

Tabela `product_packaging_units` (migracja
`20260611T140412_catalog_product_packaging_units.ts`): `id`, `product_id` (klucz obcy → `products`,
usuwany kaskadowo), `name`, `base_quantity` (`CHECK >= 1`), `position`, `is_default`, znaczniki
czasu; `UNIQUE (product_id, name)`. Migracja `20261016T082008_catalog_order_rules.ts` dodaje
`min_order_units` (dopuszcza `null`, `CHECK` 1–1 000 000). Dodatkowe kolumny z kopią danych, każdą dodaje moduł, do którego należy:
`cart_items` (`20260611T140413_carts_cart_item_packaging.ts`), `order_items`
(`20260611T140414_orders_order_item_packaging.ts`), `quote_request_items`
(`20260611T140415_quote_requests_qr_item_packaging.ts`; kolumnę `packaging_unit_id` tej tabeli
dodaje `20261018T122118_quote_requests_item_packaging_unit_id.ts`).

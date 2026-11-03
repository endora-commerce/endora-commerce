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

- **nazwę** (tekst operatora, np. `Paleta`, `Karton`) — nazwa globalna jest unikalna w obrębie
  produktu; kanał albo kanał i język mogą ją nadpisać (zob. *Nazwa w zakresie* poniżej),
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

**Dla klientów API:** nazwa przesłana bez identyfikatora jest porównywana wyłącznie z
**globalną** nazwą jednostki, nigdy z nazwą kanału ani języka (zob. *Nazwa w zakresie*). Pozycja,
która przesyła nazwę widzianą przez kupującego w przetłumaczonym storefroncie — `Pallet`, gdy
nazwa globalna to `Paleta` — jest odrzucana z kodem `422 PACKAGING_UNIT_MISMATCH` (powód
`name_unknown`). Należy przesłać `packagingUnitId` albo nazwę globalną.

## Nazwa w zakresie

Nazwa jednostki jest polem zakresu: ma wartość globalną i można ją nadpisać w kanale sprzedaży albo
w kanale i języku. Zapisuje się ją razem z resztą zakresu przez `PUT …/products/:id/scoped-values`,
np. `{ "changes": { "packagingUnits": { "<unitId>": { "name": "Pallet" } } } }` w zakresie
`{ "channelId": "…", "languageCode": "en-US" }`. Każda nazwa ma najwyżej 160 znaków;
`{ "inherit": true }` usuwa własną nazwę zakresu, a `null` zapisuje celowo pustą nazwę w kanale
albo w kanale i języku. Nazwa globalna nie może być pusta. To ona musi być unikalna w obrębie
produktu, z nią porównywana jest pozycja zapytania ofertowego przesłana bez identyfikatora i to ją
podają komunikaty o niespełnionym minimum.

Tam, gdzie kupujący widzi jednostkę, jej nazwa jest nazwą obowiązującą w kanale i języku żądania —
kanał × język → kanał → globalna:

- `packagingUnits[].name` na stronie produktu;
- nazwa kopiowana do pozycji koszyka — w kanale i języku koszyka. Gdy administrator wskazuje kanał
  w imieniu klienta, nazwa jest brana w domyślnym języku tego kanału, tak jak nazwa produktu obok
  niej;
- nazwa kopiowana do pozycji zapytania ofertowego kupującego — w kanale i języku, w których
  zapytanie jest składane.

Celowo pusta nazwa w danym zakresie nie daje pozycji bez nazwy: kopie w koszyku, zapytaniu
ofertowym i zamówieniu zachowują wtedy nazwę globalną.

Utworzenie lub zmiana jednostki trafia do dziennika zdarzeń raz, jako `packaging_unit.create` albo
`packaging_unit.update`, ze stanem jednostki przed zmianą i po niej (produktem, nazwą globalną,
base quantity, flagą default i minimum). Wysłanie zapisanego stanu sprzed zmiany (bez `productId`)
tą samą ścieżką przywraca go. Zapis zakresu trafia do dziennika jako `product.scoped_values.save`.
Oba ogłaszają zdarzenie `product.updated.v1`. Żądanie, które niczego nie zmienia, niczego nie
zapisuje i niczego nie ogłasza. Usunięcie jednostki usuwa jej nadpisania we wszystkich zakresach.

## Dla kupującego

Na stronie produktu lista wyboru oferuje dostępne jednostki oraz opcję *pojedynczej sztuki*.
Zamówienie jednostki dodaje do koszyka `baseQuantity × units` sztuk jako jedną pozycję, której
wyświetlana nazwa ma dopisek z jednostką — np. `Łożysko 6205-2RS (Paleta)`. Pozycja z jednostką
opakowania i zwykła pozycja z pojedynczymi sztukami tego samego produktu pozostają osobne.

## Co dzieje się z nazwą jednostki

Nazwa jednostki i base quantity są **kopiowane** do pozycji w chwili jej utworzenia — nazwa
obowiązująca w kanale i języku pozycji, jak opisano wyżej — więc późniejsze
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
  `catalog:write`). Tworzenie przyjmuje nazwę globalną; aktualizacja przyjmuje base quantity,
  flagę default, pozycję i opcjonalne `minOrderUnits` (`1…1000000` albo `null`, aby je usunąć) —
  nazwę w dowolnym zakresie zapisuje `PUT …/scoped-values`. Odpowiedź zawsze zawiera
  `minOrderUnits`. Wewnątrzprocesowy
  `CatalogPackagingPort`, używany przez konektory PIM, przyjmuje to samo opcjonalne pole i odrzuca
  wartość spoza zakresu z kodem `422 VALIDATION_FAILED`; zapisujący, który go nie wysyła, działa
  dalej.
- Publiczne: szczegóły produktu (`GET /api/v1/catalog/products/:idOrSlug`) zawierają opcjonalną
  tablicę `packagingUnits`; każda jednostka niesie nazwę obowiązującą w kanale i języku żądania i
  `minOrderUnits`
  (`null`, gdy minimum nie ma).
- Koszyk: `POST /api/v1/cart/items` przyjmuje opcjonalne `packagingUnitId`; wynikowa ilość w pozycji
  to `baseQuantity × quantity`.

## Schemat

Tabela `product_packaging_units` (migracja
`20260611T140412_catalog_product_packaging_units.ts`): `id`, `product_id` (klucz obcy → `products`,
usuwany kaskadowo), `name`, `base_quantity` (`CHECK >= 1`), `position`, `is_default`, znaczniki
czasu; `UNIQUE (product_id, name)`. Migracja `20261016T082008_catalog_order_rules.ts` dodaje
`min_order_units` (dopuszcza `null`, `CHECK` 1–1 000 000). Migracja
`20261030T113908_catalog_scope_model_media.ts` zastępuje nazwy w językach (`name_translations`)
tabelą `product_packaging_unit_scope_overrides`: nazwą w kanale albo w kanale i języku, która
wskazuje jednostkę razem z jej produktem i jest usuwana razem z jednostką, produktem i kanałem. Dodatkowe kolumny z kopią danych, każdą dodaje moduł, do którego należy:
`cart_items` (`20260611T140413_carts_cart_item_packaging.ts`), `order_items`
(`20260611T140414_orders_order_item_packaging.ts`), `quote_request_items`
(`20260611T140415_quote_requests_qr_item_packaging.ts`; kolumnę `packaging_unit_id` tej tabeli
dodaje `20261018T122118_quote_requests_item_packaging_unit_id.ts`).

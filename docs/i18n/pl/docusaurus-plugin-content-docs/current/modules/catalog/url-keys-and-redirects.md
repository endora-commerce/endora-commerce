---
title: Klucze URL i przekierowania
---

# Klucze URL i przekierowania

Adres produktu w sklepie to `/p/<klucz>`. Klucz podlega zakresom produktu — globalnemu, kanału i
kanału × języka:

- **klucz globalny** — `slug` produktu; obowiązuje wszędzie tam, gdzie produkt nie ma własnego
  klucza;
- **klucz kanału** — jeden na kanał sprzedaży, we wszystkich językach, które kanał oferuje;
- **klucz kanału × języka** — jeden na kanał i język, zastępuje tam klucz kanału.

Nie ma klucza samego języka. **Klucz obowiązujący** w danym kanale sprzedaży i języku to klucz
kanału × języka, w przeciwnym razie klucz kanału, a w ostatniej kolejności klucz globalny. Każdy
adres produktu generowany przez platformę — kanoniczny adres i linki do wersji językowych w sklepie,
mapa witryny, cel przekierowania, adres podglądu w panelu administracyjnym — używa klucza
obowiązującego, z prefiksem ścieżki danego języka.

Tekst klucza należy do **najwyżej jednego produktu w kanale sprzedaży**, we wszystkich językach
kanału; ten sam produkt może go używać w kilku językach. Klucz globalny nie pokrywa się z żadnym
kluczem globalnym, kluczem kanału, kluczem kanału × języka ani przekierowaniem innego produktu.
Zmiana klucza zachowuje poprzedni jako stałe przekierowanie w tym kanale i języku, prosto do
produktu; przekierowania są przechowywane, dopóki operator ich nie usunie. Przekierowania działają,
gdy moduł `seo` jest włączony; przy wyłączonym `seo` stary klucz odpowiada „nie znaleziono”, a po
ponownym włączeniu `seo` przekierowania wracają. Pozostałe **bieżące** klucze produktu nie są
przekierowaniami: także przy wyłączonym `seo` żądanie jego klucza kanału lub klucza globalnego, gdy
zastępuje go węższy klucz, nadal prowadzi do jego adresu w danym kanale.

## Zarządzanie kluczami

W edytorze produktu klucz URL jest jednym polem w zakresie edytora, tak jak nazwa: w zakresie
globalnym to klucz globalny, w kanale albo w kanale i języku pole pokazuje „Użyj wartości z
*zakresu nadrzędnego*” albo zawiera własny klucz. Zapisuje się go razem z resztą zakresu przez
`PUT …/products/:id/scoped-values` (`urlKey`). Gdy moduł `seo` jest włączony, edytor wymienia też
przekierowania zachowane przez stare klucze — w kanale i języku edytora, we wszystkich językach
kanału albo wszystkie w zakresie globalnym.

Dla klientów API `GET /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read`) zwraca wszystkie
klucze, klucz obowiązujący i adres w każdym kanale i języku oraz przekierowania; `PUT` na tej samej
ścieżce (`catalog:write`) zapisuje klucze:

```json
{
  "globalKey": "cordless-drill",
  "channelKeys": [
    { "channelId": "<retail-uuid>", "key": "wiertarka" },
    { "channelId": "<retail-uuid>", "languageCode": "en-US", "key": { "inherit": true } }
  ]
}
```

Wpis bez `languageCode` (albo z `null`) to klucz kanału; wpis z językiem to klucz kanału × języka.
Pominięta lista lub klucz pozostają bez zmian; `{ "inherit": true }` usuwa klucz w danym zakresie,
więc znowu obowiązuje tam klucz dziedziczony. `null` jest odrzucane: klucz URL jest wymagany. Klucz
składa się z małych liter, cyfr i łączników i ma najwyżej 160 znaków. Klucz dla kanału, do którego
produkt nie należy, albo dla języka, którego kanał nie oferuje, jest odrzucany z kodem
`422 SCOPE_INVALID`; klucz pozostawiony przez kanał, z którego produkt został usunięty, jest
oznaczony jako **Nie obowiązuje już** i można go usunąć.

- **Klucz, który ma inny produkt** w tym kanale, w dowolnym z jego języków, jest odrzucany z kodem
  `409 URL_KEY_TAKEN`, a odpowiedź wskazuje ten produkt (`details.conflicts`). Klucz globalny
  usuniętego produktu pozostaje zajęty; jego klucze kanałów i kanałów × języków są zwalniane.
- **Klucz, który jest przekierowaniem innego produktu**, daje odpowiedź
  `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` wskazującą produkt, który straciłby to przekierowanie
  (`details.takeovers`). Ponowne wysłanie tego samego żądania z kluczem w `confirmTakeover` przejmuje
  go. Może to zrobić tylko operator; integracja nigdy nie przejmuje przekierowania.
- **Zmieniony klucz zostaje przekierowaniem** w każdym kanale i języku, w którym obowiązywał,
  wskazującym produkt, a nie klucz, więc przekierowania nigdy nie tworzą łańcuchów. Na produkt i
  kanał przechowywanych jest najwyżej 50; najstarsze jest usuwane i wymienione we wpisie dziennika
  zdarzeń. Przekierowanie istnieje, dopóki operator go nie usunie:
  `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`).
  Usunięcie produktu usuwa jego przekierowania. Gdy `seo` jest wyłączony, odpowiedź pomija
  `redirects`, ale wiersze pozostają i nadal rezerwują swoje klucze.

`PUT` to jedno polecenie zapisywane w dzienniku zdarzeń, `product.url_keys.update`; wysłanie
zapisanego stanu sprzed zmiany tą samą ścieżką przywraca klucze. Usunięcie przekierowania to
`product.url_redirect.delete`. Oba ogłaszają `product.updated.v1` z `changedFields: ["urlKeys"]`.
`PUT`, który niczego nie zmienia, nie tworzy wpisu w dzienniku i nie zmienia wersji produktu. Klucz
globalny nowego lub zduplikowanego produktu jest wybierany tak, aby nie pokrywał się z żadnym
kluczem ani przekierowaniem istniejących produktów.

## W sklepie

`GET /api/v1/catalog/products/resolve/:key` rozpoznaje klucz w kanale sprzedaży i języku żądania:

- klucz obowiązujący produktu w tym miejscu daje odpowiedź `{ kind: "product", productId, key }`;
- inny bieżący klucz produktu w tym kanale i języku (jego klucz kanału lub klucz globalny, gdy
  zastępuje go węższy klucz) oraz — przy włączonym `seo` — jego przekierowania w tym miejscu dają
  odpowiedź `{ kind: "redirect", key, languageCode, path, permanent: true }`, gdzie `path` to adres
  produktu, pod który należy przekierować;
- bieżący klucz produktu w innym języku kanału daje tę samą odpowiedź z `permanent: false`: klucz
  używany dziś w innym języku jutro może należeć do innego produktu;
- klucz żadnego produktu w tym miejscu i produkt, który nie jest tam dostępny dla wywołującego, dają
  tę samą odpowiedź `404 PRODUCT_NOT_FOUND`; produkt zarchiwizowany daje `410 PRODUCT_ARCHIVED`.

`GET /api/v1/catalog/products/:idOrSlug` przyjmuje identyfikator, bieżący klucz w kanale i języku
żądania albo klucz globalny produktu — nigdy przekierowanie. Szczegóły produktu zawierają
`paths: { canonical, alternates }`: adres strony w kanale i języku żądania oraz po jednym adresie dla
każdego języka kanału, w którym produkt jest dostępny dla anonimowych odwiedzających. `slug` na
liście produktów, w szczegółach produktu, w produktach składowych zestawu grupowego i pakietu oraz w
kafelkach powiązanych produktów to klucz obowiązujący w kanale i języku żądania.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `URL_KEY_TAKEN` | 409 | Klucz jest kluczem innego produktu w tym kanale (w dowolnym języku), a dla klucza globalnego — gdziekolwiek |
| `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` | 409 | Klucz jest przekierowaniem innego produktu, a zapis nie potwierdził przejęcia |
| `URL_REDIRECT_NOT_FOUND` | 404 | `:redirectId` nie jest przekierowaniem tego produktu |
| `SCOPE_INVALID` | 422 | Klucz dla kanału, do którego produkt nie należy, albo dla języka, którego kanał nie oferuje |
| `PRODUCT_NOT_FOUND` | 404 | Rozpoznanie klucza w sklepie nie znalazło produktu dostępnego dla wywołującego |
| `PRODUCT_ARCHIVED` | 410 | Rozpoznanie klucza w sklepie znalazło produkt zarchiwizowany |

## Integracje

Co zapisuje konektor, synchronizacja z PIM albo arkusz kalkulacyjny i w jakim zakresie. Integracja
zapisuje tylko zakresy, które wskazuje: zapis wartości globalnej nigdy nie usuwa nadpisania operatora
w kanale sprzedaży ani w kanale i języku (FR-091).

Konektory zapisują przez `catalogProductScopeWritePort.applyScopes` (wersja 2): listę komórek, z
których każda ma zakres (`{}`, `{ channelId }` albo `{ channelId, languageCode }`), ścieżkę pola i
wartość w kodowaniu zapisu — brak wartości oznacza brak zmiany, `null` celowo pustą wartość, a
`{ "inherit": true }` usunięcie własnej wartości. Konektor może zapisać nazwę, opis, wartości
atrybutów, tekst alternatywny obrazu w galerii, nazwy i opisy załączników, nazwy jednostek
opakowania, status, okno publikacji i klucz URL. Każde inne pole — grupa odbiorców, pola produktu
wyłącznie globalne, SEO, role obrazów w galerii, flagi ukrycia, minimalna ilość zamówienia i
możliwość zwrotu — jest odrzucane w danej komórce z kodem `not_supported`; reszta wywołania jest
mimo to stosowana. Jak języki z PIM stają się zakresami, określa mapowanie w profilu importu,
opisane na stronach modułów `import_export` i `pim_connector`.

**Klucze URL z integracji nigdy nie są wymuszane.** Klucz, który jest kluczem innego produktu w tym
kanale albo przekierowaniem innego produktu, nie zostaje zapisany: produkt zachowuje dotychczasowy
klucz w tym zakresie, a wywołanie zwraca dla każdego klucza `{ written: false, issue: { languageCode,
channelId, key, heldByProductId, kind } }` — `kind` to `current` albo `redirect`. Integracja nigdy nie
przejmuje przekierowania innego produktu i nigdy nie jest proszona o potwierdzenie; może to zrobić
tylko operator, w edytorze produktu (FR-093). Integracja rezerwuje najwyżej 1 000 nowych kluczy na
przebieg; pozostałe są zgłaszane jako `limit_reached`.

**Nie jest wykonywane sprawdzenie kompletności** przy zapisie z integracji; ostrzeżenia operatora o
brakujących nazwach i kluczach w zakresie to funkcja edytora.

**CSV produktów** zapisuje te same zakresy przez nagłówki kolumn `<pole>`, `<pole>@<kod kanału>` i
`<pole>@<kod kanału>/<język>`, ze znacznikami komórek `NULL` i `INHERIT`; gramatykę opisuje strona
modułu `import_export`. Każdy zapis trafia do dziennika zdarzeń i jest ogłaszany zdarzeniem
`product.updated.v1`, którego `changedFields` wskazuje, co się zmieniło.

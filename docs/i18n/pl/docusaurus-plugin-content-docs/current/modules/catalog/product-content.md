---
title: Treść produktu
description: Dokumenty Page Buildera przechowywane dla produktu w atrybutach treści i wyświetlane w zakładce opisu na stronie produktu.
---

# Treść produktu

**Atrybut treści** przechowuje dla każdego produktu jeden dokument Page Buildera na język —
poradnik zakupowy, baner z cechami, tabelę rozmiarów. Strona produktu pokazuje go w zakładce opisu
(**Opis**), pod zwykłym opisem. Może zawierać wszystko, co oferuje Page Builder, w tym tekst
formatowany w bloku tekstu sformatowanego.

## Definiowanie atrybutu treści

W **Katalog → Atrybuty** utwórz atrybut typu **Treść Page Builder**. Ten typ ma stałe ustawienia:

- jest zawsze przechowywany **osobno dla każdego języka**;
- nie może być wyszukiwalny, filtrowalny, porównywalny, osią wariantu, regułą promocji ani
  cennika, edytowalny masowo, dostępny w szybkim wyszukiwaniu, wymagany, pokazywany w zakładce
  **Parametry** ani ustawiany osobno dla kanału sprzedaży. Formularz nie oferuje tych ustawień,
  lista pokazuje je jako zablokowane, a API odrzuca każde z nich z `400 VALIDATION_FAILED`, podając
  nazwę ustawienia;
- nie ma opcji;
- jego typu nie można później zmienić ani zmienić na niego typu innego atrybutu (`409`).

Następnie dodaj atrybut do [zestawu atrybutów](./attribute-sets.md). Jego pozycja w zestawie
wyznacza kolejność, w jakiej strona produktu pokazuje atrybuty treści z tego zestawu. Typ jest
dostępny wyłącznie dla produktów — ogólne ekrany pól niestandardowych innych rekordów go nie
oferują.

## Edycja

Na karcie **Atrybuty** produktu każdy atrybut treści z zapisanego zestawu atrybutów produktu jest
kartą, a nie polem, pod wartościami atrybutów. Karta pokazuje dla każdego języka edycji, czy treść
jest wypełniona, oraz krótkie podsumowanie tego, co zapisano. Karty są takie same w każdym zakresie
przełącznika zakresów edytora: treść nie ma wartości dla kanału sprzedaży. **Edytuj treść** otwiera ekran treści produktu
(`/catalog/products/:id/content/:attributeKey`). Zawiera on:

- przełącznik **języka** — angielski, polski i każdy inny język, który ma już zapisana treść;
- obszar roboczy **Page Buildera** dla wybranego języka;
- przycisk **Zapisz treść** — jedno zapisanie utrwala wszystkie edytowane języki. Opuszczenie ekranu z
  niezapisanymi zmianami wymaga potwierdzenia. Link powrotu prowadzi do karty Atrybuty produktu.

Karta nie zawiera linku, dopóki produkt nie został zapisany albo gdy karta Szczegóły pokazuje inny
zestaw atrybutów niż zapisany — najpierw zapisz produkt.

Aby usunąć język, usuń z jego dokumentu wszystkie bloki i zapisz. Język bez bloków nie jest
przechowywany, a atrybut, w którym nie pozostał żaden język, nie ma wartości.

Odczyt treści wymaga uprawnienia do odczytu katalogu, a zapis — uprawnienia do zapisu katalogu. Bez
uprawnienia do zapisu ekran jest tylko do odczytu.

Obszar roboczy oferuje akcję **Przetłumacz** Page Buildera, z jej zwykłym przełącznikiem i
uprawnieniem. Tłumaczenie trafia do obszaru roboczego i jest zapisywane dopiero po naciśnięciu
**Zapisz treść**.

## W sklepie

Zakładka opisu jest pokazywana, gdy produkt ma zwykły opis **albo** co najmniej jeden atrybut treści
z treścią. Najpierw pokazuje zwykły opis, a potem każdy atrybut treści w kolejności z zestawu
atrybutów. Nad dokumentem nie jest wyświetlany żaden nagłówek ani etykieta — dokument ma własne
nagłówki.

Każdy dokument jest dobierany do jednego języka w tej kolejności: język klienta, domyślny język
kanału sprzedaży, angielski, a następnie dowolny język, który ma treść. Język, którego dokument nie
zawiera żadnego bloku, jest pomijany. Treść należy do produktu, więc jest taka sama niezależnie od
wybranego wariantu.

Bloki rysuje renderer Page Buildera w storefroncie — ten sam, który rysuje strony CMS — więc HTML
wpisany przez operatora jest oczyszczany w ten sam sposób, a blok należący do wyłączonego modułu
nie jest rysowany. Zapisana zmiana jest widoczna przy następnym wczytaniu strony produktu.

Treść nigdy nie pojawia się w zakładce **Parametry**. Ta zakładka wymienia tylko atrybuty oznaczone
jako widoczne na stronie produktu, które mają wartość, i nie jest pokazywana, gdy takiego atrybutu
nie ma.

## Gdy moduł CMS jest wyłączony

Treść produktu wymaga modułu CMS, który dostarcza Page Builder:

- strona produktu **nie** pokazuje treści, a API produktu jej nie zwraca — produkt, którego jedynym
  opisem była treść, nie ma zakładki opisu;
- karty w panelu nadal pokazują, które języki mają treść, ale nie zawierają linku **Edytuj treść**,
  a ekran treści informuje, że edytor jest niedostępny. Operator bez dostępu do modułu CMS widzi to
  samo;
- nic z zapisanych danych nie jest zmieniane ani usuwane. Ponowne włączenie modułu CMS przywraca
  treść na stronie produktu i możliwość jej edycji.

To reguła ostrzejsza niż dla [treści strony kategorii](./category-content.md), która przy
wyłączonym module CMS jest nadal wyświetlana.

## Cykl życia

- **Duplikowanie** — kopia ma tę samą treść.
- **Zestaw atrybutów** — gdy atrybut treści przestaje należeć do zestawu atrybutów produktu, jego
  treść jest zachowywana, ale nie jest oferowana: karta znika, ekran treści odpowiada, że treść jest
  niedostępna, a strona produktu ją pomija. Ponowne dodanie atrybutu przywraca wszystko.
- **Usunięcie produktu** — treść usuniętego produktu pozostaje zapisana razem z nim i jest
  niedostępna w panelu, w API i w sklepie. Zasoby osadzone w tej treści nie są już zgłaszane jako
  używane.
- **Usunięcie atrybutu** — usunięcie atrybutu treści usuwa jego treść we wszystkich produktach.
  Okno potwierdzenia najpierw podaje, ile produktów ma treść (zobacz
  [Atrybuty](./attributes.md#usuwanie-atrybutu)).
- **Zasoby** — zasób biblioteki osadzony w treści produktu jest zgłaszany jako używany przez ten
  produkt, więc nie można go usunąć, dopóki treść go zawiera.

## W czym treść nie uczestniczy

Atrybuty treści są celowo pomijane w:

- wartościach dla kanału sprzedaży lub języka kanału (zakresy Kanał i Kanał × język w edytorze):
  zapis w edytorze i zapis zakresów przez konektory odrzucają klucz atrybutu treści;
- eksporcie i imporcie produktów — eksport je pomija, a niepusta komórka w kolumnie
  `attribute:<key>` atrybutu treści jest odrzucana dla tej komórki (`content_attribute`), a reszta
  wiersza jest importowana;
- zewnętrznym (integracyjnym) API i konektorach PIM/ERP oraz w odczycie zestawu atrybutów kluczem
  API;
- masowej edycji produktów;
- feedach produktowych — ani jako pole feedu, ani w regule wyboru;
- wyszukiwaniu w sklepie, szybkim wyszukiwaniu i wyszukiwaniu produktów w panelu;
- promocjach, cennikach, porównaniu i filtrach w sklepie;
- liście produktów, odpowiedzi wyszukiwania i każdym innym odczycie produktu poza odczytem strony
  produktu.

## Dla integratorów

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/catalog/products/:idOrSlug?include=content` | storefront | Szczegóły produktu z `contentAttributes`: `[{ key, language, content }]`, każdy dokument dobrany do języka wywołującego, w kolejności z zestawu. Bez `include` odpowiedź nie ma klucza `contentAttributes`. `include` przyjmuje tylko `content` |
| `GET /api/v1/admin/catalog/products/:id/content` | administrator (`catalog:read`) | Lista kart: `{ productId, attributeSetId, attributes: [{ attributeId, key, label, labelDefault, position, languages: [{ language, filled, blocks, excerpt }] }] }`. Tylko podsumowania, nigdy dokumenty |
| `GET /api/v1/admin/catalog/products/:id/content/:attributeKey` | administrator (`catalog:read`) | Koperta jednego atrybutu: `{ productId, attributeKey, content }`, gdzie `content` = `{ languages: { "<code>": <document> } }` albo `null` |
| `PUT /api/v1/admin/catalog/products/:id/content/:attributeKey` | administrator (`catalog:write`) | Zastępuje kopertę; treść żądania to `{ "content": <koperta> }`, a `{ "content": null }` ją czyści. Zwraca zapisaną, znormalizowaną wartość |

Koperta jest taka sama jak dla strony CMS i jest ograniczona do 1 MiB (1 048 576 bajtów) danych
JSON łącznie dla wszystkich języków; większa jest odrzucana z `400 VALIDATION_FAILED`. Klucz, który
nie jest atrybutem treści bieżącego zestawu produktu, jest odrzucany z
`400 ATTRIBUTE_VALUE_REJECTED`. Nieznany albo usunięty produkt daje `404 PRODUCT_NOT_FOUND`. Treść
żądania `PUT` jest sprawdzana w obsłudze trasy, więc publikowany dokument OpenAPI nie pokazuje dla
niej schematu.

Klucz atrybutu treści jest odrzucany w `attributeValues` wszędzie —
`POST`/`PATCH /api/v1/admin/catalog/products`, `PUT /api/v1/catalog/products/by-sku/:sku` z kluczem
API i port zapisu katalogu — z `400 ATTRIBUTE_VALUE_REJECTED`; treść zapisuje się wyłącznie przez
trasę opisaną wyżej.

Zapis uruchamia polecenie `product.content.update` — wpis audytu rejestruje atrybut i to, które
języki zawierała koperta, a nie same dokumenty — i emituje `product.content.updated.v1`, po którym
czyszczona jest pamięć podręczna produktu w storefroncie. Nie emituje `product.updated.v1`, więc
zapis treści nie powoduje ponownego indeksowania produktu.

Konektor, który mapuje typy atrybutów, powinien pomijać `page_builder`: to typ wartości w
`customFieldValueTypeSchema`, `attributeValueTypeSchema` i `apiAttributeTypeSchema` w
`@endora-commerce/contracts`, a żadna ścieżka integracyjna go nie przenosi. Schematy treści to
`productContentEnvelopeSchema`, `putProductContentRequestSchema`, `adminProductContentSchema`,
`adminProductContentListSchema` i `productPageContentAttributeSchema`.

## Dostarczanie edytora

Ekran treści jest właścicielem dokumentu, ale nie edytora: renderuje strefę panelu
administracyjnego `product.content.editor` i zapisuje to, co strefa zgłosi. Moduł, który ma
Page Builder, wnosi tam komponent; jego właściwości to
`{ productId, attributeKey, language, data, onChange }`, gdzie `data` to dokument do otwarcia, a
`onChange` zgłasza każdą zmianę. Moduł wnoszący edytor nigdy nie zapisuje. Gdy nic nie wnosi
edytora, karta i ekran informują, że edytor jest niedostępny.

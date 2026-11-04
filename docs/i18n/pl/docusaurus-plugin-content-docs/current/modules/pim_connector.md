---
title: Wspólna warstwa konektorów PIM
sidebar_label: Wspólna warstwa konektorów PIM
description: Kontrakt mapowania języków, gramatyka ochrony całych pól i zasady zapisu wartości zakresowych, przez które każdy konektor PIM zapisuje produkty.
---

# Wspólna warstwa konektorów PIM (`pim_connector`)

Ta strona jest dla inżyniera, który pisze lub utrzymuje konektor PIM. Opisuje, co konektor wysyła
do Endory od wprowadzenia trzypoziomowego modelu zakresów: jak języki źródłowe są mapowane na
kanały sprzedaży i języki, który język źródłowy zapisuje wartość globalną, jak kodowana jest
wartość, które pola konektor może zapisywać i jak ochrona pól wskazuje pole. Transport, ekrany
i magazyn danych konektora opisuje pakiet tego konektora.

`pim_connector` jest właścicielem kontraktu mapowania i gramatyki ochrony. Sam zapis produktu to
port zapisu zakresowego modułu `catalog`. Typy znajdują się w `@endora-commerce/contracts`
(`pim-locale-mapping.ts`, `pim-field-path.ts`, `scoped-write-encoding.ts`).

## Trzy poziomy, na które zapisuje konektor

Wartość produktu znajduje się na jednym z trzech poziomów:

| Poziom | Znaczenie |
| --- | --- |
| **Globalny** (G) | Wartość, której używa każdy kanał i język, o ile jej nie nadpisze. |
| **Kanał** (C) | Wartość dla jednego kanału sprzedaży, we wszystkich jego językach. |
| **Kanał i język** (C×L) | Wartość dla jednego języka jednego kanału sprzedaży. |

Nie ma poziomu „tylko język”: język PIM jest zawsze mapowany na parę kanał i język albo na
poziom globalny.

## Mapowanie języków

Konektor przechowuje jedno mapowanie na połączenie i przekazuje je do `planLocaleWrites()`:

```ts
{
  sourceLanguageForGlobal: 'en_US' | null,
  entries: Array<{
    sourceLocale: 'pl_PL',          // pl_PL, pl-PL or pl; compared case-insensitively, _ equals -
    sourceChannel: 'ecommerce' | null, // the PIM's channel or scope code; null matches any
    targets: Array<{ channelId: '<uuid>', languageCode: 'pl-PL' }>, // 1 to 64 targets
  }>,                                // at most 500 entries, no duplicate (locale, source channel)
}
```

Planista stosuje te reguły w tej kolejności:

1. Wartości niezależne od języka trafiają na poziom **globalny**.
2. Język wskazany w `sourceLanguageForGlobal` zapisuje poziom **globalny** dla pól zależnych od
   języka, a jeśli ma wpisy mapowania, zapisuje też ich cele.
3. Język dopasowany przez wpis zapisuje każdy cel na poziomie **kanał i język**. Wpis z kanałem
   źródłowym pasuje tylko do tego kanału; wpis z `sourceChannel: null` pasuje do każdego.
   Wygrywa wpis bardziej szczegółowy.
4. Język, którego nie dopasowuje żaden wpis, **nie jest zapisywany**. Wraca w `unmapped`, a raport
   z przebiegu zawiera jedno ostrzeżenie na język z liczbą produktów, których dotyczy.
5. Cel, dla którego produkt nie jest ważny (kanał, w którym produkt nie jest sprzedawany, albo
   język, którego kanał nie oferuje), wraca w `skipped` dla tego produktu. Pozostałe cele są
   zapisywane.
6. Pole bez poziomu kanał i język (na przykład `status`) jest zapisywane na poziomie **kanału**
   danego celu.
7. Gdy dwie grupy języków trafiają w to samo pole i zakres, wygrywa wpis szczegółowy, a potem
   pierwszy wpis w kolejności mapowania.

## Kodowanie zapisu

Każdy zapis zakresowy niesie jawną operację, a nigdy gołą wartość, którą dałoby się odczytać jako
operację:

| Zamiar | Operacja | Postać JSON | Postać CSV |
| --- | --- | --- | --- |
| Ustaw wartość | `{ op: 'set', value }` | wartość | tekst |
| Celowo puste | `{ op: 'empty' }` | `null` | `NULL` |
| Dziedzicz z poziomu wyżej | `{ op: 'inherit' }` | `{ "inherit": true }` | `INHERIT` |
| Bez zmian | brak pola | brak albo `""` | pusta komórka |

To nie jest JSON Merge Patch: `null` oznacza „celowo puste”, a nie „usuń”. Dziedziczenie na
poziomie globalnym oraz opróżnienie pola wymaganego (`name`, `urlKey`, wymagane atrybuty) są
odrzucane dla danej komórki. Wartość, która wygląda jak operacja (na przykład pole własne
z `{ "op": "empty" }`), pozostaje wartością, gdy konektor wysyła ją wewnątrz `{ op: 'set' }`.

## Co konektor może zapisywać

`catalogProductScopeWritePort` przyjmuje: `name`, `description`, `attribute:<key>` (atrybuty
z zestawu atrybutów produktu, sprawdzane według typu wartości i poziomów),
`gallery:<itemId>:altText`, `attachment:<id>:name` i `:description`, `packagingUnit:<id>:name`,
`urlKey`, `status` oraz okres publikacji `window`. Status, okres publikacji i klucz URL przechodzą
tę samą walidację i tę samą bramkę kompletności co edytor.

Odrzuca z kodem `not_supported`: `audience`, `product.*`, `seo:*`, `galleryRole:*`, `*:hidden`,
`minOrderQuantity` i `returnable`. Konektor zapisuje SEO przez moduł `seo`, a nie przez ten port.

Każdy produkt to jedno wywołanie: najwyżej 2 000 komórek, bez powtórzonej pary (pole, zakres),
identyfikatory podmiotów powiązane z produktem, a `options.source` ustawione na zarejestrowany
identyfikator modułu konektora. Odmowy wracają dla poszczególnych komórek, a reszta produktu jest
zapisywana. Zajęty klucz URL jest zgłaszany, nigdy przejmowany.

## Ochrona pól: tylko całe pola

Operator chroni **pole**, a nigdy jeden język ani kanał tego pola. Chroniona ścieżka usuwa
z zaplanowanych zapisów każdy zakres tego pola (`filterProtectedWrites()`). Gramatyka:

```text
name
description
attribute.<key>
seo.metaTitle | seo.metaDescription | seo.metaKeywords
gallery.<n>
attachment.<uuid>
price.<uuid>.<CUR>
category.<uuid>
```

Segment języka lub kanału (gramatyka sprzed modelu trzypoziomowego, np. `name.pl_PL` albo
`attribute.colour.<channel-uuid>`) jest nieprawidłowy: `canonicalisePimFieldPath()` zwraca dla
niego `null`. Endora nie migruje reguł ochrony zapisanych we własnej bazie konektora. Konektor,
który przechowywał takie reguły, musi przepisać je do postaci całych pól.

## Import CSV korzysta z tego samego kontraktu

Import produktów z CSV w module `import_export` używa tego samego mapowania (przechowywanego tam
jako profil importu), tego samego planisty i tego samego kodowania. Ochrona pól nie dotyczy CSV.

---
title: Zakresy produktu — globalny, kanał oraz kanał × język
description: Jak wartość produktu ustawia się raz dla wszystkich kanałów i nadpisuje dla kanału sprzedaży albo dla kanału sprzedaży i języka.
---

# Zakresy produktu — globalny, kanał oraz kanał × język

Każda zakresowa wartość produktu leży na jednym z **trzech poziomów**:

- **Globalny** — jedna wartość dla wszystkich kanałów sprzedaży i wszystkich języków;
- **Kanał** — jedna wartość dla jednego kanału sprzedaży, we wszystkich językach tego kanału;
- **Kanał × język** — jedna wartość dla jednego kanału sprzedaży w jednym z jego języków.

Nie ma poziomu samego języka. Tłumaczenie to wartość na poziomie kanał × język albo wartość kanału, gdy kanał
sprzedaje w jednym języku. Wartość pochodzi z najwęższego poziomu, który ją przechowuje:
**kanał × język → kanał → globalny**.

## Które pola gdzie

| Pole | Globalny | Kanał | Kanał × język |
| --- | --- | --- | --- |
| Nazwa, opis | tak | tak | tak |
| Atrybuty tekstowe oznaczone jako *zakresowe* | tak | tak | tak |
| Pozostałe atrybuty zakresowe (liczby, listy wyboru, wartości logiczne) | tak | tak | — |
| Atrybuty nieoznaczone jako zakresowe | tak | — | — |
| Status | tak | tak | tak |
| Okno publikacji, odbiorcy, minimalna ilość zamówienia, możliwość zwrotu | tak | tak | — |
| Klucz URL | tak | tak | tak |
| Tekst alternatywny w galerii, ukrycie zdjęcia, role w galerii | tak | tak | tak |
| Nazwa, opis i ukrycie załącznika | tak | tak | tak |
| Nazwa jednostki opakowania | tak | tak | tak |
| Tytuł SEO, opis, pola Open Graph (należą do modułu `seo`) | tak | tak | tak |

SKU, typ, zestaw atrybutów, kategorie, ustawienia magazynowe i plik do pobrania mają jedną wartość dla całego
produktu i edytuje się je tylko na poziomie globalnym. Zapis jednego z nich w innym zakresie jest odrzucany kodem
`GLOBAL_ONLY_FIELD`; zapis pola na poziomie, którego ono nie obsługuje — kodem `FIELD_NOT_AT_SCOPE`.

## Dziedziczenie, wartość albo celowo pusto

Na poziomach kanał oraz kanał × język każde pole jest w jednym z trzech stanów:

- **Dziedziczy** — edytor pokazuje „Użyj wartości z *zakresu nadrzędnego*”, a wartość pochodzi z poziomu wyżej;
- **Własna wartość** — wartość zapisana w tym zakresie;
- **Celowo pusto** — nadpisanie, które jest puste z zamierzenia. Zatrzymuje łańcuch: opis wyczyszczony dla jednego
  kanału pozostaje tam pusty, choć poziom globalny ma opis. Pola wymaganego (nazwy, wymaganego atrybutu) nie można
  wyczyścić.

## Kodowanie zapisu

Każdy zapis — zapis w edytorze, pliki importu i port konektora PIM — używa jednego kodowania:

| Zamiar | JSON | Komórka CSV |
| --- | --- | --- |
| Bez zmian | pole nieobecne albo `""` | pusta komórka |
| Celowo pusto | `null` | `NULL` (cała komórka) |
| Usuń własną wartość i dziedzicz | `{ "inherit": true }` | `INHERIT` (cała komórka) |
| Wartość | wartość | tekst; `\NULL` i `\INHERIT` to dosłowne słowa |

To **nie jest** JSON Merge Patch, w którym `null` usuwa pole: tutaj `null` zapisuje puste nadpisanie, a usuwa je
tylko `{ "inherit": true }`. Nie jest to też znacznik `__EMPTY__VALUE__` z Magento. `INHERIT` na poziomie globalnym
i puste pole wymagane są odrzucane kodem `SCOPED_VALUE_INVALID`.

## Odczyt i zapis zakresu

- `GET /api/v1/admin/catalog/products/:id/scoped-values?channelId=&languageCode=` (`catalog:read`) zwraca dla
  każdego pola wartość obowiązującą w zakresie, jej źródło (`set`, `set_empty`, `inherited_channel`,
  `inherited_global`, `absent`), obsługiwane poziomy, braki wykryte przez kontrolę kompletności w tym zakresie oraz
  `version` produktu.
- `PUT /api/v1/admin/catalog/products/:id/scoped-values` (`catalog:write`) zapisuje jeden zakres jednym poleceniem
  z jednym wpisem audytu. Treść żądania niesie `version` odczytaną przez edytor; zapis wykonany na starszej wersji
  jest odrzucany kodem `409 VERSION_CONFLICT`, więc dwie osoby nigdy nie nadpiszą się po cichu.
- `POST …/scoped-values/copy` kopiuje jedną wartość kanał × język do innych kanałów produktu.

## Kanały, z których produkt znika

Wartość zapisana dla kanału, w którym produkt nie jest już sprzedawany, albo dla języka, którego kanał już nie
oferuje, zostaje zachowana, ale jest pomijana. Przegląd zakresów pokazuje takie wiersze, aby można je było usunąć;
zaczynają znów obowiązywać, gdy produkt wróci do tego kanału lub języka.

## Duplikowanie produktu

**Duplikuj** kopiuje wartości produktu we wszystkich zakresach — globalnym, kanału oraz kanał × język, łącznie
z celowo pustymi wartościami i stanami dziedziczenia — dla wszystkich rodzajów pól z tabeli powyżej, jednym
audytowanym poleceniem. Dwie rzeczy nie są kopiowane: klucze URL (kopia dostaje nowy klucz globalny, bo klucz
należy w kanale do jednego produktu) oraz status (kopia startuje wszędzie jako nieaktywna, aby sprawdzić ją przed
sprzedażą).

## Powiązane strony

- [Klucze URL i przekierowania](./url-keys-and-redirects.md) — unikalność kluczy w kanale i przekierowania.
- [Galeria i etykiety](./gallery-and-labels.md), [Załączniki](./attachments.md),
  [Jednostki opakowania](./packaging-units.md) — wartości mediów i opakowań w zakresach.

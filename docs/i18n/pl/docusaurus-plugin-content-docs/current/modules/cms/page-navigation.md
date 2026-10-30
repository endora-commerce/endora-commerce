---
title: Nawigacja po stronie
sidebar_label: Nawigacja po stronie
sidebar_position: 4
description: Blok Page Buildera z odnośnikami do sekcji tej samej strony, wyróżniający sekcję widoczną na ekranie, opcjonalnie przyklejony do góry
---

# Nawigacja po stronie

Blok **Nawigacja po stronie** to rząd odnośników do sekcji strony, na której
się znajduje — „odnośniki skoku”. Klient klika *Oferta* i strona przewija się
do sekcji z ofertą; podczas przewijania wyróżniony jest odnośnik sekcji
widocznej na ekranie. Przydaje się na górze długiej strony: strony o firmie,
strony rodziny produktów, poradnika.

Blok znajdziesz na liście bloków Page Buildera w grupie **Interaktywne**.

## Kierowanie odnośników do sekcji

Każdy odnośnik ma **Etykietę** (wyświetlany tekst) i **Kotwicę sekcji** (cel).

1. Nadaj kotwicę każdej sekcji, do której chcesz prowadzić: zaznacz
   **Sekcję** i wypełnij jej ustawienie **Kotwica**, na przykład `o-nas`,
   `oferta`, `kontakt`.
2. W bloku Nawigacja po stronie dodaj odnośnik dla każdej sekcji. Pole
   **Kotwica sekcji** pokazuje kotwice sekcji strony pod *Sekcje na tej
   stronie*; wybierz jedną. Możesz też wpisać kotwicę: zostanie uporządkowana
   po opuszczeniu pola (małe litery, cyfry i myślniki, na początku litera).

Prawidłowym celem jest każdy element strony o takim identyfikatorze, nie tylko
sekcja. Jeśli żaden element na kanwie nie ma kotwicy, do której prowadzi
odnośnik, blok pokazuje pod sobą ostrzeżenie w edytorze; odnośnik i tak jest
publikowany.

Odnośnik bez etykiety albo z kotwicą niezgodną z powyższymi zasadami nie jest
wyświetlany. Blok mieści najwyżej 20 odnośników. Bez żadnego prawidłowego
odnośnika blok nie pokazuje niczego w storefroncie, a w edytorze wyświetla
notatkę.

## Opcje

| Opcja | Działanie |
| --- | --- |
| **Nazwa dla czytników ekranu** | Nazwa nawigacji odczytywana przez czytniki ekranu. Pusta: „Na tej stronie”, w języku strony. |
| **Wygląd** | **Pigułka** (domyślnie): odnośniki leżą na jednym zaokrąglonym torze, a aktywny jest wypełniony kolorem głównym — wewnątrz sekcji ze schematem kolorów kolorem tekstu tego schematu. **Podkreślenie**: linia pod paskiem i grubsza linia pod aktywnym odnośnikiem. |
| **Przyklej do góry podczas przewijania** | Utrzymuje pasek pod nagłówkiem sklepu, gdy klient przewija stronę. |
| **Wyrównanie** | Do lewej, do środka lub do prawej, osobno dla rozmiaru ekranu (karta Responsywność). |
| Odstęp zewnętrzny i wewnętrzny, obramowanie | Jak w innych blokach, osobno dla rozmiaru ekranu. |
| **Ukryj na** | Ukrywa blok na wybranych rozmiarach ekranu. |

Kolory wynikają z ustawień marki i schematu kolorów sekcji, w której stoi blok;
blok nie ma własnej opcji koloru.

## Działanie w storefroncie

- **Bez JavaScriptu** blok jest zwykłą listą odnośników w punkcie orientacyjnym
  `nav`: każdy odnośnik i tak przenosi do swojej sekcji.
- **Z JavaScriptem** odnośnik sekcji widocznej na ekranie jest wyróżniony i
  oznaczony jako bieżący dla technologii wspomagających (`aria-current`).
  Wyróżniony jest zawsze dokładnie jeden odnośnik; po przewinięciu za ostatnią
  sekcję pozostaje wyróżniony jej odnośnik.
- **Płynne przewijanie**: przejście do sekcji jest płynne, chyba że urządzenie
  klienta prosi o ograniczenie ruchu — wtedy skok jest natychmiastowy.
- **Przyklejony pasek**: sekcja, do której prowadzi odnośnik, zaczyna się pod
  nagłówkiem sklepu i paskiem, więc jej nagłówek nigdy nie jest pod nimi
  ukryty.
- **Telefony**: gdy odnośniki się nie mieszczą, lista przewija się w bok
  wewnątrz bloku (sama strona nigdy nie przewija się w bok), a wyróżniony
  odnośnik jest przesuwany w pole widzenia.
- Użytkownicy klawiatury docierają do każdego odnośnika klawiszem Tab;
  zaznaczony odnośnik ma widoczny obrys.

## Umieszczanie w karcie, slajdzie lub sekcji

Blok może stać wszędzie tam, gdzie inne bloki, także w panelu karty albo w
slajdzie karuzeli. **Przyklejenie** działa tylko wewnątrz jego kontenera:
umieszczony bezpośrednio na stronie pozostaje widoczny na całej stronie;
wewnątrz sekcji, karty lub slajdu — tylko dopóki ten kontener jest na ekranie.
Aby pasek towarzyszył klientowi przez całą stronę, umieść blok bezpośrednio na
stronie, między sekcjami.

## Tłumaczenie

Etykiety odnośników i nazwa dla czytników ekranu są tłumaczone razem z resztą
strony (tłumaczenie Page Buildera); kotwice są identyfikatorami i nigdy nie są
tłumaczone.

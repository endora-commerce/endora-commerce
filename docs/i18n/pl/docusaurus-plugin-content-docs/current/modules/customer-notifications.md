---
title: Powiadomienia klientów
description: Centrum powiadomień na koncie kupującego w sklepie — wpisy, które inne moduły zapisują dla jednego konta klienta, czytane i oznaczane jako przeczytane w sklepie oraz usuwane po okresie przechowywania
---

# Powiadomienia klientów (`customer_notifications`)

Moduł Powiadomienia klientów prowadzi **centrum powiadomień** dla kupujących.
Inne moduły zapisują wpis dla jednego konta klienta, gdy wydarzy się coś, o
czym kupujący powinien wiedzieć — na przykład moduł *Zapytania ofertowe*
zapisuje wpis, gdy operator zatwierdzi lub zmieni zapytanie ofertowe. Kupujący
czyta wpisy na swoim koncie w sklepie, widzi, ile jest nieprzeczytanych,
otwiera wpis i oznacza jeden lub wszystkie jako przeczytane.

Moduł nie ma własnego ekranu w panelu administracyjnym. Jego ustawienia są na
ekranie **Ustawienia**, w grupie *Powiadomienia klientów*, a włącza się go i
wyłącza na ekranie **Platforma → Moduły**.

## Co widzi kupujący

- **Tylko własne wpisy.** Wpis jest adresowany do jednego konta klienta jednej
  organizacji. Inny członek tej samej organizacji go nie widzi; każda osoba
  dostaje powiadomienie osobno.
- **Wpisy sklepu, w którym jest.** Wpis dotyczący czegoś, co należy do jednego
  kanału sprzedaży, jest widoczny tylko w tym kanale; wpis, który nie należy do
  żadnego kanału, jest widoczny we wszystkich. Oznaczenie wszystkich wpisów jako
  przeczytanych w jednym sklepie pozostawia wpisy innego sklepu
  nieprzeczytane.
- **Wpisy w jego języku.** Każdy wpis jest wyświetlany w języku, o który prosi
  sklep. Gdy brakuje tłumaczenia, wyświetlany jest tekst angielski.
- **Tylko wpisy włączonych modułów.** Wpis zapisany przez moduł, który jest
  wyłączony, jest ukryty i wraca po ponownym włączeniu modułu.

Wpis może prowadzić do strony — na przykład do zapytania ofertowego. Otwarcie
wpisu oznacza go jako przeczytany.

## Impersonacja

Gdy operator działa w imieniu kupującego (impersonacja), centrum powiadomień
można czytać, ale nic nie jest oznaczane jako przeczytane: kupujący, logując
się sam, nadal zastaje swoje nieprzeczytane wpisy.

## Przechowywanie

Wpisy starsze niż okres przechowywania są usuwane. Okres określa ustawienie
**Przechowuj powiadomienia przez (dni)**, od 7 do 730 dni, domyślnie 90, i
obowiązuje we wszystkich kanałach sprzedaży. Usuwanie uruchamia się raz
dziennie.

To samo zadanie usuwa wpisy kont klientów, które zostały usunięte lub
zanonimizowane.

## Wyłączanie

**Powiadomienia klientów włączone** włącza lub wyłącza centrum. Gdy jest
wyłączone:

- sklep nie pokazuje ani strony powiadomień, ani liczby nieprzeczytanych, a
  API powiadomień odpowiada, że moduł jest niedostępny;
- moduły, które zapisałyby wpis, pomijają go — *Zapytania ofertowe* na
  przykład zapisują doręczenie jako pominięte, bo moduł jest wyłączony;
- zadanie usuwania się nie uruchamia.

Nic nie jest usuwane. Wpisy zapisane przed wyłączeniem modułu zostają
zachowane i pojawiają się ponownie po jego ponownym włączeniu.

## Dla programistów

Inne moduły zapisują wpisy przez opublikowany port
`customerNotificationRecordPort` (`CustomerNotificationRecordPort` w
`@endora-commerce/contracts`):

- `recordWithin(em, input)` utrwala wpis w jednostce pracy wywołującego, bez
  jej zapisywania (flush), więc wpis zostaje zatwierdzony albo wycofany razem ze
  zmianą wywołującego;
- `record(input)` zapisuje wpis samodzielnie i zwraca istniejący wpis, gdy wpis
  o tych samych `sourceModule` i `sourceKey` jest już zapisany.

Wpis zawiera angielskie zdanie (`title` i opcjonalnie `body`) obok
tłumaczalnego komunikatu (`titleMessage`, `bodyMessage`: identyfikator modułu
jako `scope`, klucz w pakiecie tłumaczeń tego modułu oraz `params` z napisami i
liczbami). Link jest ścieżką względną sklepu, zaczynającą się od pojedynczego
`/`; adres bezwzględny lub zaczynający się od `//` jest odrzucany. Wywołujący
sprawdza obecność modułu przed wywołaniem portu i nie przechwytuje odmowy,
którą port zwraca, gdy moduł jest wyłączony.

API sklepu, dla zalogowanego kupującego:

| Metoda | Ścieżka | Odpowiedź |
| --- | --- | --- |
| `GET` | `/api/v1/storefront/notifications?limit=1..50&cursor=` | wpisy od najnowszych, kursor następnej strony i liczba nieprzeczytanych |
| `GET` | `/api/v1/storefront/notifications/unread-count` | liczba nieprzeczytanych |
| `GET` | `/api/v1/storefront/notifications/:id` | jeden wpis, bez oznaczania go jako przeczytany; `404` dla wpisu, którego lista by nie pokazała |
| `POST` | `/api/v1/storefront/notifications/:id/read` | `204`; `404` dla wpisu, który nie należy do wywołującego |
| `POST` | `/api/v1/storefront/notifications/read-all` | liczba wpisów oznaczonych jako przeczytane |

Każda odpowiedź ma nagłówek `Cache-Control: private, no-store`.

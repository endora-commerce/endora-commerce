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

Dziś wpisy zapisuje jeden moduł, *Zapytania ofertowe*: autor zapytania i
członkowie organizacji, którzy mogą je otworzyć, dostają wpis, gdy zapytanie
zostaje złożone lub złożone ponownie, jego oferta zostaje zaakceptowana lub
odrzucona, pracownicy sklepu je przygotują, zmienią, zatwierdzą lub anulują
albo gdy wygaśnie. Kupujący, którego własne działanie wywołało zmianę, nie
dostaje o niej wpisu — właśnie patrzy na wynik, a potwierdza go e-mail. Kogo i
kiedy się powiadamia, opisuje strona modułu *Zapytania ofertowe*.

## W sklepie

- **Liczba nieprzeczytanych przy wejściu na konto.** W nagłówku nie ma
  osobnego dzwonka. Gdy zalogowany kupujący ma nieprzeczytane wpisy, wejście
  na konto pokazuje ich liczbę: przycisk konta na szerokich ekranach, a na
  wąskich zakładka konta w dolnym pasku zakładek, której menu boczne ma też
  wiersz *Powiadomienia* z liczbą. Jest widoczna na każdej stronie przy każdej
  szerokości ekranu, z wyjątkiem składania zamówienia. Plakietka pokazuje
  najwyżej `9+`; czytnik ekranu podaje dokładną liczbę po nazwie wejścia
  („Nieprzeczytane powiadomienia: 12”). Ani gość, ani kupujący bez
  nieprzeczytanych wpisów nie widzi plakietki. Liczba odświeża się przy każdym wczytaniu strony
  i zaraz po tym, jak kupujący otworzy wpis lub oznaczy wpisy jako
  przeczytane; nie odświeża się na bieżąco.
- **Strona Powiadomienia** (`/account/notifications`) jest drugą pozycją
  nawigacji konta, po profilu, z liczbą nieprzeczytanych obok („Powiadomienia
  (2)”). Przegląd konta pokazuje wiersz w rodzaju *Masz nieprzeczytane
  powiadomienia: 2*, prowadzący do niej.
- **Lista.** Wpisy są wymienione od najnowszych, po 20 na stronę, z *Pokaż
  starsze* dla następnej strony. Każdy pokazuje swoje zdanie i datę — względną
  („2 godz. temu”) przez ostatnie siedem dni, potem datę. Nieprzeczytany wpis
  jest oznaczony jako *Nowe* i pogrubiony, więc różnica nie opiera się na
  samym kolorze.
- **Otwarcie wpisu.** Wpis z odnośnikiem jest prawdziwym odnośnikiem: można go
  otworzyć w nowej karcie albo skopiować. Otwarcie oznacza go jako przeczytany
  i przenosi kupującego na stronę, której dotyczy; jeśli oznaczenie się nie
  uda, kupujący i tak tam trafia. Wpis bez odnośnika ma zamiast tego przycisk
  *Oznacz jako przeczytane*.
- **Oznacz wszystkie jako przeczytane** jest dostępne, gdy coś jest
  nieprzeczytane. Oznacza wpisy sklepu, w którym jest kupujący, ogłasza wynik
  obok nagłówka i przenosi fokus na nagłówek; gdy się nie uda, komunikat o
  błędzie to mówi i można spróbować ponownie.
- **Stan pusty i błąd.** Bez wpisów strona mówi, co się na niej pojawi, a gdy
  zapytania ofertowe są dla kupującego dostępne, oferuje *Przejdź do zapytań
  ofertowych*. Gdy listy nie da się wczytać, strona to mówi i oferuje *Spróbuj
  ponownie*.
- **Push.** Gdy powiadomienia push są w sklepie włączone, strona kończy się
  odnośnikiem *Zarządzaj powiadomieniami push*, który prowadzi do wyborów push
  kupującego w profilu konta. Same powiadomienia push należą do modułu *PWA*.

## Impersonacja

Gdy operator działa w imieniu kupującego (impersonacja), centrum powiadomień
można czytać, ale nic nie jest oznaczane jako przeczytane: kupujący, logując
się sam, nadal zastaje swoje nieprzeczytane wpisy. Otwarcie wpisu nadal
prowadzi do jego strony; *Oznacz wszystkie jako przeczytane* jest pokazane jako
nieaktywne, z powodem obok.

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

- sklep nie pokazuje ani strony powiadomień (pod jej adresem pokazuje stronę
  *nie znaleziono*), ani liczby nieprzeczytanych, pozycji w nawigacji
  konta czy wiersza w przeglądzie konta, a API powiadomień odpowiada, że moduł
  jest niedostępny;
- moduły, które zapisałyby wpis, pomijają go — *Zapytania ofertowe* na
  przykład zapisują doręczenie jako pominięte, bo moduł jest wyłączony;
- zadanie usuwania się nie uruchamia.

Nic nie jest usuwane. Wpisy zapisane przed wyłączeniem modułu zostają
zachowane i pojawiają się ponownie po jego ponownym włączeniu.

## Ustawienia

Oba są w grupie *Powiadomienia klientów* na ekranie **Ustawienia** i obowiązują
na całej platformie.

| Kod | Typ | Wartość domyślna | Działanie |
| --- | --- | --- | --- |
| `customer_notifications.enabled` | boolean | `true` | Przełącznik aktywacji modułu, dostępny także na ekranie **Platforma → Moduły**. |
| `customer_notifications.retention_days` | number | `90` | **Przechowuj powiadomienia przez (dni)**, od 7 do 730; wartość spoza zakresu jest odrzucana przy zapisie. |

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

Każda odpowiedź ma nagłówek `Cache-Control: private, no-store`. Każda pokazuje
tylko własne wpisy wywołującego, z kanału sprzedaży żądania i bez kanału, i
tylko te, których moduł źródłowy jest obecny; wpisy są wyświetlane w języku
żądania, a w razie braku tłumaczenia — angielskim zdaniem. Podczas impersonacji
odczyty działają, a oba zapisy niczego nie zmieniają. Gdy moduł jest wyłączony,
każda ścieżka odpowiada `503 MODULE_DISABLED`, a port odmawia z
`ModuleDisabledError`.

Usuwanie po okresie przechowywania to harmonogram zadań BullMQ na kolejce
`customer_notifications.retention.sweep`, raz dziennie, rejestrowany przez
`ctx.worker`. Bezczynne uruchomienie nie wchodzi w żaden zakres tenanta.

Część sklepowa jest w `storefront/`: strona, jej akcje serwerowe i ścieżka
otwierania w `app/(account)/account/notifications/` (`page.tsx`, `actions.ts`,
`[id]/open/route.ts` — `GET /account/notifications/<id>/open` odczytuje wpis po
identyfikatorze, oznacza go jako przeczytany i odpowiada `303` na jego
odnośnik), klient API `lib/api/customer-notifications.ts`, liczba przy wejściu
na konto w `components/Header.tsx`, `components/mobile/MobileTabBar.tsx` i
`components/Megamenu/MegamenuMobileDrawer.tsx` oraz teksty w
`lib/i18n/messages/account.ts` i `chrome.ts`. Każda z tych powierzchni jest
renderowana tylko wtedy, gdy `customer_notifications` jest obecny.

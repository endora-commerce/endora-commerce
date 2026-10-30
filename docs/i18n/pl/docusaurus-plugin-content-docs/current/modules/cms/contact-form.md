---
title: Formularz kontaktowy
sidebar_label: Formularz kontaktowy
sidebar_position: 5
description: Blok kreatora stron, który wysyła wiadomość odwiedzającego e-mailem na adresy ustawione dla kanału sprzedaży, z opcjonalnym zapisem do newslettera, i niczego nie zapisuje
---

# Formularz kontaktowy

Blok **Formularz kontaktowy** (`cms.ContactForm`) umieszcza formularz kontaktowy na dowolnej
stronie kreatora stron. Odwiedzający go wypełnia, a sklep otrzymuje wiadomość e-mailem na
adresy ustawione dla kanału sprzedaży. **Nic nie jest zapisywane**: w panelu nie ma listy
zgłoszeń ani tabeli wiadomości — e-mail w Twojej skrzynce jest jedyną kopią.

Blok różni się od **Formularza kontaktowego (osadzonego)** (`cms.ContactFormEmbed`), który
pokazuje w ramce formularz utrzymywany gdzie indziej.

## Zanim zaczniesz: kto otrzymuje wiadomości

Odbiorcy są ustawieniem, a nie częścią strony, więc adres nigdy nie pojawia się w treści
strony ani nigdzie w sklepie.

- **Gdzie**: **Ustawienia** → grupa **Formularz kontaktowy** → **Odbiorcy formularza
  kontaktowego**.
- **Paleta poleceń**: ⌘K / CTRL+K → „Odbiorcy formularza kontaktowego” (również po słowach
  *contact*, *form*, *recipients*, *kontakt* lub *formularz*).
- **Uprawnienia**: odczyt ekranu ustawień wymaga **Wyświetlanie ustawień** (`settings:read`);
  zmiana wartości wymaga **Edycja ustawień** (`settings:write`).
- **Dla kanału sprzedaży**: ustaw jedną listę dla wszystkich kanałów albo nadpisz ją dla
  jednego kanału. Formularz wysyła na listę kanału, w którym odwiedzający robi zakupy.
- **Zasady**: najwyżej 10 adresów, każdy musi być poprawnym adresem e-mail. Cokolwiek innego
  jest odrzucane przy zapisie.

Dopóki kanał nie ma odbiorców, formularz w tym kanale odpowiada, że jest niedostępny, a
odwiedzający widzi komunikat bloku „Niedostępny”.

## Budowa strony kontaktowej

Typowa strona kontaktowa składa się z istniejących bloków:

1. **Sekcja** z **Wierszem** o dwóch **Kolumnach**.
2. W pierwszej kolumnie **Nagłówek** i krótki wstęp jako **Treść sformatowana**, a pod nimi
   **Formularz kontaktowy**.
3. W drugiej kolumnie dane kontaktowe (adresy, numery telefonów, godziny otwarcia) jako
   **Treść sformatowana** albo **Mapa**.
4. Opcjonalnie blok **Zakładki** z dwiema zakładkami — „Formularz kontaktowy” z
   **Formularzem kontaktowym** i „Newsletter” z blokiem **Zapis do newslettera** (gdy moduł
   newslettera jest zainstalowany).

Nadaj sekcji kotwicę, jeśli linkujesz do formularza z innego miejsca strony; po wysłaniu
formularza bez JavaScriptu przeglądarka wraca do tej kotwicy.

## Pola

Zestaw pól jest stały — serwer zna każde pole, więc może sprawdzić, co przychodzi:

| Pole | Widoczne | Wymagane |
| --- | --- | --- |
| Imię i nazwisko | domyślnie | opcjonalnie |
| E-mail | zawsze | zawsze |
| Telefon | na życzenie | opcjonalnie |
| Firma | na życzenie | opcjonalnie |
| Temat | na życzenie | opcjonalnie |
| Lista wyboru (lista, którą definiujesz, np. regiony lub działy) | na życzenie | opcjonalnie |
| Wiadomość | zawsze | zawsze |
| Zgoda na przetwarzanie danych | zawsze | zawsze |
| Zgoda marketingowa | na życzenie | nigdy |

Dla każdego pola możesz zmienić **etykietę** i **podpowiedź w polu**; dla pól opcjonalnych
także **Pokaż** i **Wymagane**. Lista wyboru potrzebuje co najmniej jednej opcji — bez niej
nie jest pokazywana. Wybrana opcja jest wysyłana razem z etykietą listy, więc e-mail
brzmi na przykład „Region: Północ”.

Puste etykiety pokazują własne sformułowania sklepu w języku strony.

**Zgoda na przetwarzanie danych**: wpisz jej treść i podlinkuj politykę prywatności — edytor
pokazuje ostrzeżenie, dopóki tego nie zrobisz. Do tego czasu odwiedzający widzi krótkie
domyślne zdanie bez linku.

**Zgoda marketingowa**: włącz ją, aby zapytać, czy odwiedzający chce otrzymywać nowości i
oferty. Zobacz [Zapis do newslettera z formularza](#zapis-do-newslettera-z-formularza).

## Układ i wygląd

Blok dziedziczy schemat kolorów sekcji, w której się znajduje. Opcje są gotowymi
ustawieniami, więc strona wygląda dobrze bez mierzenia:

- **Kolumny** — jedna albo dwie od szerokości tabletu (na telefonach jedna). Przy dwóch
  kolumnach **Szerokość** każdego pola to połowa albo cała; wiadomość zajmuje całą
  szerokość, chyba że to zmienisz.
- **Etykiety** — nad polem albo ukryte. Ukryte etykiety nadal odczytują czytniki ekranu, a
  gdy nie wpiszesz podpowiedzi, etykieta pojawia się jako podpowiedź w polu.
- **Wygląd pól** — **W ramce**, **Podkreślenie** (linia pod polem) albo **Zaokrąglone
  (pigułka)**; pole wiadomości ma łagodniejsze narożniki.
- **Przycisk** — te same opcje wyglądu co każdy inny przycisk kreatora stron (styl,
  wypełnienie, rozmiar, ikona) i własna etykieta. **Wyrównanie przycisku** ustawia go do
  początku, do środka, do końca albo na całą szerokość.
- **Komunikaty** — teksty pokazywane po wysłaniu: **Wysłano**, **Nie przyjęto** (serwer
  odrzucił przesłane dane) i **Niedostępny** (brak odbiorców, zbyt wiele prób albo
  chwilowa awaria).
- **Nazwa formularza** — nazwa, którą czytniki ekranu ogłaszają dla formularza.
- Odstępy zewnętrzne i wewnętrzne, obramowanie oraz ukrywanie bloku na wybranych ekranach
  działają jak w każdym bloku.

## Co się dzieje, gdy odwiedzający wysyła formularz

1. Z JavaScriptem formularz najpierw sprawdza wymagane pola i adres e-mail, oznacza każde
   pole do poprawienia i przenosi fokus na pierwsze z nich. To, co odwiedzający wpisał,
   zostaje zachowane do chwili wysłania wiadomości.
2. Sklep przekazuje wiadomość do serwera, który sprawdza ją ponownie — niezależnie od
   ustawień bloku serwer zawsze wymaga adresu e-mail, wiadomości (do 5 000 znaków) i zgody
   na przetwarzanie danych.
3. Serwer wysyła **jeden e-mail do każdego odbiorcy** kanału sprzedaży odwiedzającego,
   przez platformowy transport poczty. E-mail jest napisany w domyślnym języku kanału i
   zawiera wypełnione pola, stronę, z której wysłano formularz, oraz obie zgody. Jego
   **Reply-To** to adres odwiedzającego, więc odpowiedź trafia do niego.
4. Odwiedzający widzi komunikat **Wysłano**. Bez JavaScriptu przeglądarka wraca na tę samą
   stronę, w tym samym języku, przewiniętą do formularza.

**Co jest zachowywane**: rejestr dostarczeń e-maili platformy odnotowuje, że wiadomość
rodzaju `cms.contact_form` trafiła do odbiorcy, ze stałym tematem (nazwą kanału, nigdy
tekstem odwiedzającego) i wynikiem. Nic, co wpisał odwiedzający, nie jest nigdzie zapisywane.

## Zapis do newslettera z formularza

Gdy zgoda marketingowa jest zaznaczona, a wiadomość została wysłana, sklep zapisuje też
adres do newslettera kanału sprzedaży odwiedzającego — jeśli moduł newslettera jest
zainstalowany i włączony. Obowiązują zasady potwierdzania zapisu danego kanału, więc przy
podwójnym potwierdzeniu odwiedzający najpierw otrzymuje e-mail z prośbą o potwierdzenie.
Zapis jest odnotowany ze źródłem `cms-contact-form`. Jeśli zapis się nie uda, wiadomość i
tak została wysłana.

Bez modułu newslettera zgoda jest tylko podana w e-mailu, który otrzymujesz.

## Ochrona przed nadużyciami

- **Limit zgłoszeń** — najwyżej 10 zgłoszeń z jednego adresu odwiedzającego w ciągu 10
  minut; jedenaste jest odrzucane, a odwiedzający widzi komunikat „Niedostępny”.
- **Ukryte pole-pułapka** — pole, którego ludzie nie widzą. Bot, który je wypełni, dostaje
  odpowiedź, że wiadomość wysłano, i nic nie jest wysyłane.
- **Za serwerem pośredniczącym** — sklep referencyjny wywołuje serwer w imieniu
  odwiedzającego i przekazuje jego adres w nagłówku `X-Forwarded-For`. Serwer liczy ten
  adres tylko wtedy, gdy ufa sklepowi jako serwerowi pośredniczącemu: ustaw
  `TRUSTED_PROXY_HOPS` albo `TRUSTED_PROXY_ADDRESSES` dla swojego wdrożenia. Bez tego
  wszyscy odwiedzający mają adres sklepu i limit obowiązuje ich łącznie.

## Dla programistów: punkt końcowy

Obsługą w sklepie jest `POST /forms/contact` (zwykłe wysłanie formularza z odpowiedzią `303`
z powrotem na stronę albo JSON, gdy żądanie go akceptuje). Wywołuje on publiczny punkt
końcowy:

`POST /api/v1/storefront/cms/contact-form` — treść sprawdzana schematem
`contactFormSubmissionSchema` z `@endora-commerce/contracts`; nieznane klucze są odrzucane.

| Wynik | Status |
| --- | --- |
| Wysłano (także gdy pole-pułapka jest wypełnione) | `200` `{ "data": { "status": "sent" } }` |
| Treść nie zgadza się z kontraktem | `400` `VALIDATION_FAILED` |
| Brak odbiorców dla kanału sprzedaży żądania | `409` `CMS_CONTACT_FORM_UNAVAILABLE` |
| Zbyt wiele zgłoszeń z jednego adresu | `429` |
| Każda wysyłka się nie powiodła | `500` `INTERNAL` |
| Moduł CMS jest wyłączony | `503` `MODULE_DISABLED` |

Odpowiedź nigdy nie zawiera odbiorców ani przesłanych wartości. Gdy moduł CMS jest wyłączony,
blok znika ze wszystkich stron, a obsługa w sklepie odpowiada `404`.

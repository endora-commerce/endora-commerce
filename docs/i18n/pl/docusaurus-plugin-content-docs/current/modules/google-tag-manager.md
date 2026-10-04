---
title: Google Tag Manager
description: Kontenery Google Tag Manager osobno dla każdego kanału sprzedaży, z udokumentowanymi zdarzeniami e-commerce w dataLayer i opcjonalnym przekazywaniem zdarzeń po stronie serwera
---

# Google Tag Manager

Moduł `google_tag_manager` umieszcza w storefroncie **kontener GTM**, osobny dla każdego kanału
sprzedaży, i publikuje w `dataLayer` udokumentowany zestaw zdarzeń e-commerce, na które mogą reagować
twoje tagi. Może też przekazywać te zdarzenia z backendu platformy do **kontenera GTM po stronie
serwera**.

## Co ten moduł robi, a czego nie

Google Tag Manager to *kontener tagów*, a nie narzędzie pomiarowe. Wszystkie tagi, reguły
uruchamiania (triggery) i zmienne są w konsoli Google Tag Manager, poza tą platformą. Zadanie modułu
jest więc celowo wąskie:

**Robi:**

- wczytuje właściwy kontener w storefroncie właściwego kanału, zależnie od jednej, wspólnej decyzji o
  zgodzie w storefroncie;
- publikuje w `window.dataLayer` stały, udokumentowany zestaw zdarzeń e-commerce;
- opcjonalnie przekazuje do kontenera serwerowego tę część zdarzeń, która się do tego nadaje —
  trwale i dokładnie raz.

**Nie robi:**

- nie modeluje, nie kopiuje i nie zarządza tagami, triggerami ani zmiennymi — to pozostaje w konsoli
  GTM;
- nie ma własnej tabeli w bazie ani własnej strony w panelu. Cała konfiguracja to sześć ustawień na
  ogólnym ekranie ustawień;
- nie decyduje, z jakimi dostawcami łączy się twój kontener.

## Konfiguracja (moduł ustawień)

Wszystkie wartości są w grupie ustawień **Google Tag Manager** i można je nadpisać dla każdego kanału
sprzedaży.

| Ustawienie | Typ | Wartość domyślna | Znaczenie |
| --- | --- | --- | --- |
| `google_tag_manager.enabled` | boolean | `false` | Główny przełącznik dla kanału. |
| `google_tag_manager.container_id` | string | `''` | Identyfikator kontenera, `GTM-XXXXXXX`. Pusty ⇒ kanał nie jest śledzony. |
| `google_tag_manager.require_consent` | boolean | `true` | Uruchamia kontener w trybie Consent Mode v2 z odmową i nie wysyła zdarzeń platformy, dopóki odwiedzający nie wyrazi zgody. |
| `google_tag_manager.server_side_enabled` | boolean | `false` | Przekazywanie zdarzeń e-commerce z backendu do kontenera serwerowego. |
| `google_tag_manager.server_container_url` | string | `''` | Bazowy adres kontenera serwerowego, np. `https://sgtm.example.com`. |
| `google_tag_manager.server_ingest_path` | string | `/data` | Ścieżka żądań obsługiwana przez klienta odbierającego dane w kontenerze. |

Kanał jest śledzony tylko wtedy, gdy główny przełącznik jest włączony **i** identyfikator kontenera ma
postać `GTM-…`. Pusty lub niepoprawny identyfikator oznacza „nie skonfigurowano”, a nigdy uszkodzony
tag skryptu — wyczyszczenie go to bezpieczny sposób wstrzymania kanału. Zmiany konfiguracji docierają
do storefrontu natychmiast — bez ponownego wdrożenia i bez czekania na pamięć podręczną.

Nie ma osobnej strony w panelu: przy sześciu ustawieniach i braku własnych danych ogólny ekran ustawień
robi wszystko, co mogłaby robić osobna strona. W palecie poleceń „Google Tag Manager” prowadzi właśnie
tam.

## Podwójne liczenie z wbudowanym modułem Google Analytics

> **Nie uruchamiaj w tym samym kanale tagu GA4 w kontenerze *i* wbudowanego modułu Google Analytics
> platformy.** Oba raportują te same działania zakupowe, więc każda metryka się podwoi.

Platforma nie potrafi tego wykryć: tag GA4 jest w kontenerze, do którego platforma nie ma wglądu.
Nie wymusza też wzajemnego wykluczania — obie integracje mają niezależne przełączniki, a wybór należy
do ciebie. Wybierz jedną ścieżkę pomiaru dla każdego kanału:

- **Tylko GTM** — wyłącz w danym kanale wbudowany moduł Google Analytics i zbuduj tag GA4 w
  kontenerze. Śledzenie przez GTM nie zależy od tamtego przełącznika.
- **Tylko wbudowany moduł** — używaj GTM do wszystkiego poza GA4.

## Działanie w storefroncie

Kontener jest wczytywany przez `next/script` w trybie `afterInteractive`, więc nigdy nie blokuje
wyświetlania strony. Wyświetlany jest też standardowy zastępczy iframe w `<noscript>`, dzięki czemu
kontener działa także bez JavaScriptu.

### Zgoda

Zgoda to jedna decyzja w storefroncie, wspólna z Google Analytics, LinkedIn Ads i Meta Ads: jeden
baner, jedna zapisana odpowiedź. Baner pojawia się, gdy zgody wymaga **którakolwiek** włączona w kanale
integracja — także wtedy, gdy Google Tag Manager jest jedyną włączoną.

Gdy włączone jest `Require analytics consent`:

1. zanim kontener zostanie wczytany, strona ustawia domyślne wartości Consent Mode v2 na `denied` dla
   `analytics_storage`, `ad_storage`, `ad_user_data` i `ad_personalization`;
2. sam kontener **jest** wczytywany. Kontener to nie tag: wstrzymanie go po cichu wyłączyłoby
   wszystkie zbudowane tagi, łącznie z tymi, które w ogóle nie wymagały zgody;
3. platforma **nie wysyła własnych zdarzeń** — ani odsłon, ani zdarzeń e-commerce, ani zdarzeń do
   przekazania — dopóki odwiedzający nie wyrazi zgody;
4. wyrażenie zgody w trakcie sesji wysyła do kontenera `update` Consent Mode i uruchamia zdarzenia
   platformy bez przeładowania strony.

> **Consent Mode dotyczy tagów Google, a nie wszystkich pozostałych.** Tagi Google odczytują stan
> zgody i same wstrzymują zapis i identyfikatory. Tag Meta, LinkedIn albo własny tag HTML w kontenerze
> **uruchamia się niezależnie od tego**, chyba że dodasz do niego w konsoli GTM **dodatkowy warunek
> zgody**. Platforma tego nie widzi i nie wymusza — to twoja odpowiedzialność.

## Zdarzenia

Uruchamiaj tagi na tych zdarzeniach własnych. Parametr `items` to **string w formacie JSON** o
postaci pozycji GA4 (`item_id`, `item_name`, `price`, `quantity`), bo praktycznie każdy kontener
przekazuje go do tagu GA4.

| Zdarzenie | Parametry | Można przekazać przez serwer |
| --- | --- | --- |
| `page_view` | `page_path`, `page_location`, `page_title` | tak |
| `view_search_results` | `search_term` | tak |
| `view_item` | `currency`, `value`, `items` | tak |
| `add_to_cart` | `currency`, `value`, `items` | tak |
| `add_to_quote_request` | `currency`, `value`, `items` | tak |
| `add_to_shopping_list` | `items` | tak |
| `begin_checkout` | `currency`, `value`, `items` | tak |
| `place_order_clicked` | pola wysyłane przy składaniu zamówienia | tak |
| `purchase` | `transaction_id`, `value`, `currency`, `items` | tak |
| `contact_form_submitted` | wartości pól formularza kontaktowego | tak |

Dane zdarzeń zawierają tylko wartości proste, więc nigdy nie może się w nich znaleźć przesłany plik
ani załącznik.

> **Uruchamiaj tagi na `page_view`, a nie na History Change.** Storefront wysyła dokładnie jedno
> `page_view` na każdą stronę docelową, łącznie z nawigacją bez przeładowania dokumentu. Jeśli kontener
> używa też wbudowanego triggera History Change z GTM, każda nawigacja zostanie policzona dwa razy.

### Zdarzenia tylko po stronie przeglądarki

Tych zdarzeń platforma **nie** publikuje i nie mają one ścieżki serwerowej — celowo:

| Trigger | Dlaczego platforma nie może go odtworzyć |
| --- | --- |
| Głębokość przewinięcia | Zależy od rozmiaru okna i bieżącej pozycji przewinięcia. |
| Kliknięcia linków wychodzących | Wymaga klikniętego elementu i działającego DOM. |
| Pobrania plików | Wymaga adresu i tekstu klikniętego linku. |
| `form_start` / `form_submit` | Zależy od momentów interakcji z DOM; `form_start` w ogóle nie ma momentu widocznego po stronie serwera. |
| Widoczność elementów | Stan `IntersectionObserver`, wewnętrzny dla kontenera. |
| Timery | Czas spędzony w sesji przeglądarki. |
| `gtm.js`, `gtm.dom`, `gtm.load`, zmiana historii | Generuje je sam kontener. |

Nie ma tu nic do konfiguracji i nic nie ginie: nawet przy tagowaniu po stronie serwera kontener
pozostaje wczytany w przeglądarce, więc jego własne triggery nadal obsługują wszystkie te zdarzenia.
Odbiór danych w backendzie odrzuca każdą nazwę zdarzenia spoza listy zdarzeń, które można przekazać,
więc nawet sfałszowane żądanie nie da zdarzeniu działającemu tylko w przeglądarce ścieżki serwerowej.

## Tagowanie po stronie serwera

Gdy włączone jest `Server-side tagging` i skonfigurowany jest adres kontenera serwerowego, dziesięć
powyższych zdarzeń przestaje trafiać do `dataLayer` w przeglądarce i jest wysyłanych z backendu
platformy. Każde zdarzenie jest raportowane dokładnie raz — nigdy obiema drogami.

> **To *przenosi* te zdarzenia poza kontener webowy.** Tagi uruchamiane na nich w kontenerze webowym
> trzeba odtworzyć w kontenerze **serwerowym**. Wszystko w kontenerze webowym, co obserwuje
> przeglądarkę — głębokość przewinięcia, kliknięcia linków, pobrania plików, interakcje z
> formularzami, widoczność elementów, timery — pozostaje bez zmian i nadal działa.

Pusty `Server container URL` utrzymuje kanał na ścieżce przeglądarkowej nawet przy włączonym
przełączniku, więc można bezpiecznie najpierw włączyć przełącznik.

### Jak działa wysyłka

Storefront wysyła żądanie `POST /api/v1/storefront/google-tag-manager/collect`, które **tylko dodaje
zadania**: sprawdza porcję zdarzeń, dodaje jedno zadanie na zdarzenie do trwałej kolejki BullMQ
`google_tag_manager.ss.relay` i odpowiada `202`. W trakcie żądania kupującego nie ma żadnego wywołania
na zewnątrz, więc wolny albo niedziałający kontener nigdy nie wpływa na sklep.

Dla kanału, w którym tagowanie po stronie serwera nie jest skonfigurowane — przełącznik jest
wyłączony albo pole `Server container URL` jest puste — trasa nie dodaje żadnego zadania i odpowiada
`202` z `accepted: 0`. Storefront w ogóle nie wysyła żądań dla takiego kanału; taką odpowiedź dostaje
żądanie ze strony, która wciąż ma starszą konfigurację.

Osobny worker (działający w procesie API, chyba że ustawiono `BACKEND_ROLE=api` — wtedy uruchamia go
tylko proces `worker`) wysyła każde zdarzenie do kontenera i ponawia próbę po błędzie: osiem prób z
wykładniczo rosnącym odstępem, zaczynając od sekundy. Wysyłki, którym zabrakło prób, pozostają jako
nieudane zadania, więc można je zobaczyć, a nie są po cichu porzucane.

### Żądanie, które dostaje kontener

```
POST {server_container_url}{server_ingest_path}
Content-Type: application/json
```

```json
{
  "event_name": "purchase",
  "client_id": "1234567890.1754006400",
  "event_id": "6b1f0ec4-0000-4000-8000-000000000001",
  "page_location": "https://shop.example.com/checkout/thank-you",
  "page_referrer": "https://shop.example.com/checkout",
  "page_title": "Thank you",
  "language": "pl",
  "consent": { "analytics_storage": "granted" },
  "ip_override": "203.0.113.7",
  "user_agent": "Mozilla/5.0 ...",
  "transaction_id": "ORD-2026-000123",
  "value": 1249.0,
  "currency": "PLN",
  "items": "[{\"item_id\":\"SKU-9\",\"item_name\":\"Widget 9\",\"price\":249,\"quantity\":5}]",
  "gtm_event_id": "6b1f0ec4-0000-4000-8000-000000000001"
}
```

Własne parametry zdarzenia są umieszczone bezpośrednio na najwyższym poziomie. `client_id`,
`ip_override` i `user_agent` celowo mają nazwy pól z GA4 Measurement Protocol, które klienci GTM po
stronie serwera już rozpoznają, więc nie trzeba pisać warstwy tłumaczącej. Nie są wysyłane żadne
dane uwierzytelniające: endpoint odbierający dane w sGTM jest z założenia publicznym endpointem
zbierającym dane.

### Co musisz zrobić po swojej stronie

1. **Obsłuż skonfigurowaną ścieżkę żądań.** **Data Client** Google domyślnie obsługuje `/data`;
   własny klient może obsługiwać dowolną ścieżkę — wtedy ustaw zgodną wartość w `Server container
   ingest path`.
2. **Odtwórz w kontenerze serwerowym tagi** uruchamiane na zdarzeniach e-commerce platformy. Te
   zdarzenia nie trafiają już do kontenera webowego.
3. **Odczytuj `items` jako JSON** — przychodzi jako string, a nie tablica.
4. **Usuwaj duplikaty według `event_id`** (dostępne też jako `gtm_event_id`). Jest takie samo przy
   każdym ponowieniu, więc ponowna wysyłka ma tę samą wartość.
5. **Obsłuż brak adresu IP i user agenta.** Gdy odwiedzający nie wyraził zgody, `ip_override` i
   `user_agent` są całkowicie pomijane, więc uzupełnienie danych o lokalizację i urządzenie nie zawsze
   jest możliwe.

### Czego przekazywane zdarzenia nigdy nie zawierają

Wyłącznie udokumentowane parametry e-commerce, kontekst strony, identyfikator klienta, stan zgody i
identyfikator zdarzenia. Bez `user_id`, adresu e-mail, identyfikatora organizacji, adresu pocztowego,
zahaszowanych identyfikatorów i nigdy z załącznikiem. Enhanced conversions i łączenie danych po
`user_id` są celowo poza zakresem — dodaj w kontenerze to, czego potrzebujesz.

## Uprawnienia

Moduł **nie deklaruje własnych kodów uprawnień**. Konfiguracja jest dostępna przez ogólny ekran
ustawień, więc chronią ją uprawnienia rdzenia `settings:read` / `settings:write`, a zmiany audytuje
moduł ustawień.

## Jeszcze nie zaimplementowane

- **Udostępnianie `gtm.js` z własnej domeny przez kontener serwerowy.** Kuszące ze względu na
  dłuższą ważność ciasteczek i odporność na programy blokujące reklamy, ale źle przygotowany kontener
  serwerowy zamieniłby ustawienie wysyłki w całkowitą awarię śledzenia. Wymaga osobnego ustawienia i
  osobnego testu akceptacyjnego.
- **`user_id` i enhanced conversions w przekazywanych zdarzeniach** — każde z nich wymaga osobnej
  analizy zgody i haszowania.

---
title: Google Tag Manager
description: Kontenery Google Tag Manager per kanał sprzedaży, z udokumentowanym commerce dataLayer i opcjonalnym relayem po stronie serwera
---

# Google Tag Manager

Moduł `google_tag_manager` umieszcza **kontener GTM** na
storefront, jeden per kanał sprzedaży, i publikuje udokumentowane słownictwo
commerce `dataLayer`, na którym Twoje tagi mogą się triggerować. Może też
relay'ować te zdarzenia z backendu platformy do **kontenera GTM po stronie
serwera**.

## Co ten moduł robi, a czego nie

Google Tag Manager to *kontener tagów*, nie produkt pomiarowy. Każdy tag,
trigger i zmienna żyje w konsoli Google Tag Manager, poza tą platformą. Rola
modułu jest więc celowo wąska:

**Robi:**

- ładuje właściwy kontener na storefront właściwego kanału, za jedną decyzją
  consent storefront;
- publikuje stabilny, udokumentowany zestaw zdarzeń commerce na
  `window.dataLayer`;
- opcjonalnie dostarcza podzbiór tych zdarzeń kwalifikujących się do relay
  do kontenera serwerowego, trwale i dokładnie raz.

**Nie robi:**

- nie modeluje, nie mirroruje ani nie zarządza tagami, triggerami ani
  zmiennymi — to zostaje w konsoli GTM;
- nie ma własnej tabeli w bazie ani własnej strony admina. Cała konfiguracja to
  sześć ustawień na generycznym ekranie Settings;
- nie decyduje, z jakimi vendorami łączy się Twój kontener.

## Konfiguracja (moduł Settings)

Wszystkie wartości żyją w grupie ustawień **Google Tag Manager** i są
nadpisywalne per kanał sprzedaży.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `google_tag_manager.enabled` | boolean | `false` | Master switch dla kanału. |
| `google_tag_manager.container_id` | string | `''` | ID kontenera, `GTM-XXXXXXX`. Pusty ⇒ kanał untracked. |
| `google_tag_manager.require_consent` | boolean | `true` | Uruchom kontener w Consent Mode v2 denied i nie wysyłaj zdarzeń platformy, dopóki visitor nie zaakceptuje. |
| `google_tag_manager.server_side_enabled` | boolean | `false` | Relay zdarzeń commerce z backendu do kontenera serwerowego. |
| `google_tag_manager.server_container_url` | string | `''` | Bazowy URL kontenera serwerowego, np. `https://sgtm.example.com`. |
| `google_tag_manager.server_ingest_path` | string | `/data` | Ścieżka requestu, którą claimuje ingest client kontenera. |

Kanał jest śledzony tylko gdy master switch jest włączony **i** ID kontenera ma
kształt `GTM-…`. Pusty lub źle uformowany ID oznacza „nie skonfigurowano”, nigdy
zepsuty tag skryptu — wyczyszczenie go to bezpieczny sposób wstrzymania kanału.
Zmiany konfiguracji docierają do storefront natychmiast — bez redeploy, bez
czekania na cache.

Nie ma strony admina: sześć ustawień i brak własnych wierszy oznacza, że
generyczny ekran Settings robi już wszystko, co mogłaby robić dedykowana strona.
W command palette „Google Tag Manager” prowadzi tam.

## Podwójne liczenie z natywnym modułem Google Analytics

> **Nie uruchamiaj tagu GA4 w kontenerze *i* natywnego modułu Google Analytics
> platformy na tym samym kanale.** Oba raportują te same akcje zakupowe, więc
> każda metryka się podwaja.

Platforma nie może tego wykryć: tag GA4 żyje w kontenerze, gdzie platforma nie
ma widoczności. Nie wymusza też wzajemnego wykluczenia — obie integracje to
niezależne przełączniki i wybór należy do Ciebie. Wybierz jedną ścieżkę pomiaru
per kanał:

- **GTM jako jedyna ścieżka** — wyłącz natywny moduł Google Analytics platformy
  dla kanału i zbuduj tag GA4 w kontenerze. Śledzenie GTM nie zależy od tego
  przełącznika.
- **Natywny moduł jako jedyna ścieżka** — zostaw GTM dla wszystkiego poza GA4.

## Zachowanie storefront

Kontener ładuje się przez `next/script` na `afterInteractive`, więc nigdy nie
blokuje critical rendering path. Renderowany jest też standardowy fallback
`<noscript>` iframe, więc kontener jest osiągalny bez JavaScript.

### Consent

Consent to jedna decyzja storefront, współdzielona z Google Analytics, LinkedIn
Ads i Meta Ads: jeden banner, jedna zapisana odpowiedź. Banner pokazuje się,
gdy **którakolwiek** włączona integracja na kanale wymaga consent — także gdy
Google Tag Manager jest jedyną włączoną.

Przy włączonym `Require analytics consent`:

1. przed załadowaniem kontenera strona publikuje domyślne Consent Mode v2
   `denied` dla `analytics_storage`, `ad_storage`, `ad_user_data` i
   `ad_personalization`;
2. sam kontener **jest** ładowany. Kontener to nie tag: wstrzymanie go cicho
   wyłączyłoby każdy zbudowany tag, w tym te, które consent w ogóle nie
   wymagały;
3. platforma **nie push'uje własnych zdarzeń** — ani page views, ani commerce,
   ani relay — dopóki visitor nie zaakceptuje;
4. akceptacja w trakcie sesji wysyła Consent Mode `update` do kontenera i
   uruchamia zdarzenia platformy bez przeładowania strony.

> **Consent Mode reguluje tagi Google, nie wszystkich innych.** Własne tagi
> Google czytają stan consent i automatycznie wstrzymują storage i identyfikatory.
> Tag Meta, LinkedIn lub custom HTML w kontenerze **odpala się niezależnie**, chyba
> że dodasz do niego **dodatkowy check consent** w konsoli GTM. Platforma nie
> widzi ani nie wymusza tego — to Twoja odpowiedzialność.

## Słownictwo zdarzeń

Triggeruj tagi na tych zdarzeniach niestandardowych. Parametr `items` to **JSON
string** w kształcie item GA4 (`item_id`, `item_name`, `price`, `quantity`), bo
praktycznie każdy kontener mapuje go na tag GA4.

| Event | Parameters | Relay-eligible |
| --- | --- | --- |
| `page_view` | `page_path`, `page_location`, `page_title` | yes |
| `view_search_results` | `search_term` | yes |
| `view_item` | `currency`, `value`, `items` | yes |
| `add_to_cart` | `currency`, `value`, `items` | yes |
| `add_to_quote_request` | `currency`, `value`, `items` | yes |
| `add_to_shopping_list` | `items` | yes |
| `begin_checkout` | `currency`, `value`, `items` | yes |
| `place_order_clicked` | the checkout submission fields | yes |
| `purchase` | `transaction_id`, `value`, `currency`, `items` | yes |
| `contact_form_submitted` | the contact-form field values | yes |

Payloady zdarzeń niosą tylko wartości skalarne, więc upload pliku lub załącznik
nigdy nie może się w nich pojawić.

> **Triggeruj `page_view`, nie History Change.** Storefront push'uje dokładnie
> jeden `page_view` na destination, w tym nawigacje bez przeładowania
> dokumentu. Jeśli kontener używa też wbudowanego triggera History Change GTM,
> każda nawigacja będzie liczona podwójnie.

### Zdarzenia tylko po stronie klienta

Te **nie są** publikowane przez platformę i nie mają ścieżki serwerowej — z zamierzeniem:

| Trigger | Dlaczego platforma nie może tego zrekonstruować |
| --- | --- |
| Scroll depth | Zależy od rozmiaru viewportu i bieżącej pozycji scrolla. |
| Outbound link clicks | Wymaga klikniętego elementu i żywego DOM. |
| File downloads | Wymaga href i tekstu klikniętego linku. |
| `form_start` / `form_submit` | Timing interakcji z DOM; `form_start` w ogóle nie ma momentu obserwowalnego po stronie serwera. |
| Element visibility | Stan `IntersectionObserver`, wewnętrzny dla kontenera. |
| Timers | Czas dwell w sesji przeglądarki. |
| `gtm.js`, `gtm.dom`, `gtm.load`, history change | Generowane przez sam kontener. |

Nie ma tu nic do konfiguracji i nic nie ginie: kontener pozostaje załadowany w
przeglądarce nawet przy server-side tagging, więc własne triggery nadal
obsługują wszystkie z nich. Backend ingest odrzuca każdą nazwę zdarzenia poza
listą kwalifikujących się do relay, więc sfałszowany request też nie da
zdarzeniu tylko klienckiemu ścieżki serwerowej.

## Server-side tagging

Przy włączonym `Server-side tagging` i skonfigurowanym URL kontenera
serwerowego dziesięć zdarzeń powyżej przestaje być push'owanych do
`dataLayer` w przeglądarce i jest dostarczanych z backendu platformy. Każde
logiczne zdarzenie raportowane jest dokładnie raz — nigdy obiema drogami.

> **To *przenosi* te zdarzenia poza kontener web.** Tagi triggerowane na nich w
> kontenerze web trzeba przebudować w kontenerze **serwerowym**. Wszystko
> skonfigurowane w kontenerze web, co obserwuje przeglądarkę — scroll depth,
> kliknięcia linków, pobrania plików, interakcje formularzy, widoczność
> elementów, timery — pozostaje nietknięte i dalej odpala.

Pusty `Server container URL` utrzymuje kanał na ścieżce przeglądarkowej nawet
przy włączonym przełączniku, więc włączenie przełącznika najpierw jest
nieszkodliwe.

### Jak działa dostawa

Storefront POST'uje do `POST /api/v1/storefront/google-tag-manager/collect`, co
jest **czystym producentem**: waliduje batch i enqueue'uje jeden job na zdarzenie
na trwałą kolejkę BullMQ `google_tag_manager.ss.relay`, potem odpowiada `202`.
Żadne wywołanie wychodzące nie dzieje się w requestcie shoppera, więc wolny lub
padający kontener nigdy nie wpływa na sklep.

Separowalny worker (co-located w procesie API, chyba że `BACKEND_ROLE=api`, wtedy
tylko proces `worker` go uruchamia) POST'uje każde zdarzenie do kontenera i
retry'uje przy failure: osiem prób z exponential backoff od jednej sekundy.
Wyczerpane dostawy zostają jako failed jobs, więc są obserwowalne, a nie cicho
porzucane.

### Request, który otrzymuje kontener

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

Własne parametry zdarzenia są spłaszczone na top level. `client_id`, `ip_override`
i `user_agent` celowo reużywają nazw pól GA4 Measurement Protocol, które
klienci server-side GTM już rozpoznają, więc nie piszesz warstwy tłumaczenia.
Żadne credentials nie są wysyłane: endpoint ingest sGTM to z założenia publiczny
endpoint kolekcji.

### Co musisz zrobić po swojej stronie

1. **Claim'uj skonfigurowaną ścieżkę requestu.** **Data Client** Google domyślnie
   claim'uje `/data`; custom client może claim'ować dowolną ścieżkę — wtedy ustaw
   `Server container ingest path` na zgodną.
2. **Przebuduj tagi** triggerowane na zdarzeniach commerce platformy w kontenerze
   serwerowym. Te zdarzenia nie docierają już do kontenera web.
3. **Parsuj `items` jako JSON** — przychodzi jako string, nie tablica.
4. **Deduplikuj po `event_id`** (obecne też jako `gtm_event_id`). Jest stabilne
   między retry, więc redelivery niesie tę samą wartość.
5. **Obsłuż brak IP i user agent.** Gdy visitor odmówił consent, `ip_override` i
   `user_agent` są całkowicie pominięte, więc wzbogacenie geo i urządzenia nie
   zawsze jest możliwe.

### Czego relay nigdy nie niesie

Tylko udokumentowane parametry commerce, kontekst strony, client id, stan consent
i event id. Bez `user_id`, bez adresu e-mail, bez organization id, bez adresu
pocztowego, bez zhashowanych identyfikatorów i nigdy załącznika pliku. Enhanced
conversions i user-id stitching są celowo poza zakresem — dodaj w kontenerze to,
czego potrzebujesz.

## Uprawnienia

Moduł **nie deklaruje własnych kodów uprawnień**. Konfiguracja jest osiągalna
przez generyczny ekran Settings i jest więc gate'owana core'owymi uprawnieniami
`settings:read` / `settings:write`, audytowanymi przez moduł Settings.

## Jeszcze nie zaimplementowane

- **Serwowanie `gtm.js` first-party z kontenera serwerowego.** Atrakcyjne dla
  lifetime cookie i odporności na ad-blockery, ale źle provisionowany kontener
  serwerowy zamieniłby ustawienie dostawy w całkowitą awarię śledzenia. Wymaga
  własnego ustawienia i własnego testu akceptacyjnego.
- **`user_id` i enhanced conversions w relay** — każde wymaga własnej analizy
  consent i hashowania.

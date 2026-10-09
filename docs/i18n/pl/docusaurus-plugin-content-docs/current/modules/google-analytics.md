---
title: Google Analytics
description: Google Analytics 4 dla storefrontu — Measurement ID dla każdego kanału, Enhanced Ecommerce, kreator zdarzeń własnych i opcjonalne tagowanie po stronie serwera
---

# Google Analytics

Moduł `google_analytics` łączy storefront z **Google Analytics 4**: aktywacja i Measurement ID osobno
dla każdego kanału sprzedaży, Enhanced Ecommerce, konfigurowany w panelu kreator zdarzeń własnych
oraz opcjonalne wysyłanie danych przez **tagowanie po stronie serwera**. To moduł oddzielny od
wewnętrznego dziennika zdarzeń `analytics` i zastępuje tamtejszy mechanizm przekazywania do GA4,
włączany zmienną środowiskową.

## Konfiguracja (moduł ustawień)

Cała konfiguracja dla kanałów znajduje się w module ustawień, w grupie `google_analytics.*`
(wartość globalna i nadpisanie dla kanału):

| Ustawienie | Typ | Znaczenie |
| --- | --- | --- |
| `google_analytics.enabled` | boolean | Główny przełącznik (można go nadpisać dla kanału). |
| `google_analytics.measurement_id` | string | GA4 `G-XXXXXXXXXX`. Pusty ⇒ kanał nie jest śledzony. |
| `google_analytics.enhanced_ecommerce_enabled` | boolean | Wysyłanie zdarzeń e-commerce GA4. |
| `google_analytics.server_side_enabled` | boolean | Wysyłanie zdarzeń przez workera po stronie serwera. |
| `google_analytics.server_side_endpoint` | string | Adres kontenera GTM po stronie serwera (pusty ⇒ GA4 Measurement Protocol). |
| `google_analytics.server_side_api_secret` | secret | Sekret API Measurement Protocol (wymaga `SETTINGS_SECRET_ENCRYPTION_KEY`). |
| `google_analytics.require_consent` | boolean | Ładuje GA w trybie Consent Mode v2 z domyślną odmową, dopóki użytkownik nie wyrazi zgody. |

Kanał z pustym Measurement ID niczego nie wysyła, niezależnie od głównego przełącznika.

## Działanie w storefroncie

- `gtag.js` jest wstawiany przez `next/script` (`afterInteractive`, bezpiecznie dla Core Web Vitals)
  i inicjalizowany z `send_page_view: false`.
- `page_view` jest wysyłane przy każdej nawigacji w App Routerze (pierwsze wczytanie i każda zmiana
  trasy po stronie klienta) — dokładnie jedno na stronę docelową.
- **Consent Mode v2**: gdy `require_consent` jest włączone, GA startuje z domyślną odmową. Baner
  cookie wywołuje `updateAnalyticsConsent(granted)`, aby przełączyć na zgodę. (Ten moduł dostarcza
  mechanizm obsługi zgody, a nie gotowy baner cookie).
- **Enhanced Ecommerce** (gdy włączone): `view_item` (strona produktu), `add_to_cart`,
  `begin_checkout` (checkout) i `purchase` (strona potwierdzenia zamówienia).

## Zdarzenia własne

Administratorzy definiują zdarzenia własne na ekranie `/google-analytics` w panelu. Każde zdarzenie
ma nazwę (w formacie nazw zdarzeń GA4), działanie, które je wywołuje, i wybrany podzbiór pól
dostępnych dla tego działania:

| Działanie | Dostępne pola |
| --- | --- |
| `contact_form_submitted` | wszystkie pola formularza kontaktowego **oprócz przesyłanych plików** |
| `place_order_clicked` | pola wysyłane przy składaniu zamówienia |
| `add_to_cart` / `add_to_quote_request` / `add_to_shopping_list` | `sku`, `name`, `price`, `quantity` |
| `button_click_by_id` | strona, na której nastąpiło kliknięcie, i atrybuty `data-*` przycisku (wymaga identyfikatora przycisku) |

Wysyłane są tylko wybrane pola; brakujące są pomijane (nigdy nie blokują zdarzenia). Przesyłane
pliki nigdy nie są dołączane. Zdarzenia własne mogą dotyczyć jednego kanału albo wszystkich, a do
jednego działania można przypisać wiele zdarzeń.

> Storefront nie ma jeszcze formularza kontaktowego; działanie `contact_form_submitted` jest
> dostarczane jako hook po stronie klienta (`trackContactFormSubmit`), który zacznie działać po
> dodaniu formularza.

## Tagowanie po stronie serwera (wyłącznie Measurement Protocol)

Gdy dla kanału włączone jest `server_side_enabled`, moduł realizuje **tagowanie wyłącznie po stronie
serwera, przez własny serwer platformy** — bez zewnętrznego kontenera i bez biblioteki Google w
przeglądarce:

- **gtag.js nie jest ładowany.** Każde zdarzenie (page_view, Enhanced Ecommerce, własne) jest
  wysyłane do `POST /api/v1/storefront/google-analytics/collect`, więc **żadne żądanie nie trafia z
  przeglądarki bezpośrednio do Google** (najlepsza odporność na programy blokujące reklamy, brak
  podwójnego liczenia przez klienta i serwer).
- Trasa **tylko dodaje zadania** — sprawdza każde zdarzenie i dodaje jedno zadanie na zdarzenie do
  trwałej kolejki BullMQ `google_analytics.ss.deliver`. Osobny worker (działający w procesie API,
  chyba że ustawiono `BACKEND_ROLE=api` — wtedy tylko w procesie `worker`) przekazuje każde zdarzenie
  do GA4 przez **Measurement Protocol** i ponawia próbę po błędzie. Każde zdarzenie ma stały klucz
  idempotencji `eventId`.
- **Nieskonfigurowany kanał nie dodaje żadnych zadań.** Dla kanału, w którym wysyłka po stronie
  serwera nie jest skonfigurowana — główny przełącznik albo `server_side_enabled` jest wyłączony
  albo Measurement ID jest pusty — trasa nie dodaje żadnego zadania i odpowiada `202` z
  `accepted: 0`. Storefront w ogóle nie wysyła żądań dla takiego kanału; taką odpowiedź dostaje
  żądanie ze strony, która wciąż ma starszą konfigurację.
- **Domyślne metryki GA4 działają bez dodatkowej pracy.** Przeglądarka utrzymuje własny `client_id`
  i odnawiany co 30 minut `session_id` (w ciasteczkach dopiero po wyrażeniu zgody, wcześniej tylko w
  pamięci) i wysyła `engagement_time_msec` z każdym zdarzeniem, więc GA4 sam wyznacza
  `first_visit`, `session_start`, sesje i aktywnych użytkowników ze strumienia Measurement Protocol.
- **Opcjonalny inny adres docelowy.** Domyślnie worker wysyła dane do endpointu GA4 Measurement
  Protocol. Ustaw `server_side_endpoint`, aby kierować zdarzenia pod inny adres (np. własny serwer
  pośredniczący albo kontener GTM po stronie serwera). `server_side_api_secret` (sekret API
  Measurement Protocol, tworzony w GA4 Admin → Data Streams → Measurement Protocol API secrets)
  uwierzytelnia wysyłkę.
- **Zgoda** jest przekazywana w danych Measurement Protocol (`analyticsStorage`) i odzwierciedla
  rzeczywistą decyzję odwiedzającego w banerze.
- **Enhanced Measurement** jest odtwarzane w przeglądarce (bo gtag.js nie jest ładowany) i
  przekazywane przez serwer: `scroll` (90%), wychodzące `click`, `file_download`, `form_start` /
  `form_submit` i `view_search_results` (wyszukiwanie w sklepie). Zaangażowanie w wideo nie jest
  obsługiwane — wymagałoby integracji z odtwarzaczem YouTube po stronie klienta. W trybie klienckim
  gtag.js wysyła to wszystko samodzielnie.

## Uprawnienia

`google_analytics:read` i `google_analytics:write` chronią ekrany w panelu administracyjnym
(zarządzanie zdarzeniami własnymi). Ustawieniami dla kanałów zarządza się na ogólnym ekranie
ustawień w panelu.

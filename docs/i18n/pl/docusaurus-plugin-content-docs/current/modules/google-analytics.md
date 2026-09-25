---
title: Google Analytics
description: Google Analytics 4 dla storefront — Measurement ID per kanał, Enhanced Ecommerce, builder zdarzeń niestandardowych i opcjonalne tagowanie po stronie serwera
---

# Google Analytics

Moduł `google_analytics` integruje storefront z
**Google Analytics 4**: aktywacja i Measurement ID per Sales Channel,
Enhanced Ecommerce, admin-configurable builder zdarzeń niestandardowych oraz
opcjonalna ścieżka dostawy **server-side tagging**. To osobny moduł od legacy
wewnętrznego logu zdarzeń `analytics` i zastępuje forwarder GA4 tego modułu
gated env.

## Konfiguracja (moduł Settings)

Cała konfiguracja per kanał żyje w module Settings pod grupą
`google_analytics.*` (global value + per-channel override):

| Setting | Type | Meaning |
| --- | --- | --- |
| `google_analytics.enabled` | boolean | Master switch (nadpisywalny per kanał). |
| `google_analytics.measurement_id` | string | GA4 `G-XXXXXXXXXX`. Pusty ⇒ kanał untracked. |
| `google_analytics.enhanced_ecommerce_enabled` | boolean | Emituj zdarzenia ecommerce GA4. |
| `google_analytics.server_side_enabled` | boolean | Kieruj zdarzenia przez server-side worker. |
| `google_analytics.server_side_endpoint` | string | URL kontenera GTM server-side (pusty ⇒ GA4 Measurement Protocol). |
| `google_analytics.server_side_api_secret` | secret | API secret Measurement Protocol (wymaga `SETTINGS_SECRET_ENCRYPTION_KEY`). |
| `google_analytics.require_consent` | boolean | Ładuj GA w Consent Mode v2 denied-by-default, dopóki consent nie zostanie udzielony. |

Kanał z pustym Measurement ID nie emituje nic, niezależnie od master switch.

## Zachowanie storefront

- `gtag.js` jest wstrzykiwany przez `next/script` (`afterInteractive`, Core-Web-Vitals
  safe) i inicjalizowany z `send_page_view: false`.
- `page_view` jest emitowany przy każdej nawigacji App Router (initial load plus
  każda client-side route change) — dokładnie jeden na destination.
- **Consent Mode v2**: gdy `require_consent` jest włączone, GA startuje w
  domyślnym denied. Cookie banner wywołuje `updateAnalyticsConsent(granted)`, aby
  przełączyć na granted. (Ten moduł dostarcza plumbing consent, nie pełny cookie
  banner.)
- **Enhanced Ecommerce** (gdy włączone): `view_item` (strona produktu),
  `add_to_cart`, `begin_checkout` (checkout) oraz `purchase` (strona
  potwierdzenia zamówienia).

## Zdarzenia niestandardowe

Admini definiują zdarzenia niestandardowe na ekranie admina `/google-analytics`.
Każde zdarzenie ma nazwę (kształt nazwy zdarzenia GA4), akcję triggera i
wybrany podzbiór pól dostępnych dla tej akcji:

| Trigger action | Available fields |
| --- | --- |
| `contact_form_submitted` | wszystkie pola formularza kontaktowego **oprócz uploadów plików** |
| `place_order_clicked` | pola submit checkout |
| `add_to_cart` / `add_to_quote_request` / `add_to_shopping_list` | `sku`, `name`, `price`, `quantity` |
| `button_click_by_id` | strona pochodzenia + atrybuty `data-*` przycisku (wymaga ID przycisku) |

Wysyłane są tylko wybrane pola; brakujące są pomijane (nigdy nie blokują
zdarzenia). Uploady plików nigdy nie są dołączane. Zdarzenia niestandardowe
mogą być scoped do jednego kanału lub wszystkich kanałów, a wiele zdarzeń może
wiązać się z tą samą akcją.

> Storefront nie ma jeszcze formularza kontaktowego; trigger `contact_form_submitted`
> jest dostarczany jako client hook (`trackContactFormSubmit`), który staje się
> aktywny, gdy formularz kontaktowy zostanie dodany.

## Server-side tagging (pure Measurement Protocol)

Gdy `server_side_enabled` jest włączone dla kanału, moduł uruchamia **pure
server-side tagging przez własny serwer platformy** — bez zewnętrznego kontenera
i bez biblioteki Google po stronie przeglądarki:

- **gtag.js nie jest ładowany.** Każde zdarzenie (page_view, Enhanced Ecommerce, custom)
  jest POST'owane do `POST /api/v1/storefront/google-analytics/collect`, więc **żaden hit
  nie dociera do Google bezpośrednio z przeglądarki** (najlepsza odporność na ad-blockery,
  brak double count client/server).
- Trasa jest **pure producer** — waliduje i enqueue'uje jeden job na zdarzenie
  na trwałą kolejkę BullMQ `google_analytics.ss.deliver`. Separowalny worker
  (co-located w procesie API, chyba że `BACKEND_ROLE=api`, wtedy tylko w procesie
  `worker`) forwarduje każde zdarzenie do GA4 przez **Measurement Protocol**,
  retry'ując przy failure. Każde zdarzenie niesie stabilny klucz idempotency `eventId`.
- **Domyślne metryki GA4 przychodzą za darmo.** Przeglądarka posiada first-party
  `client_id` i rolling 30-minutowy `session_id` (cookies dopiero po udzieleniu
  consent; ephemeral in-memory wcześniej) i wysyła `engagement_time_msec` z
  każdym zdarzeniem, więc GA4 auto-wyprowadza `first_visit`, `session_start`, sessions i
  active users ze strumienia MP.
- **Opcjonalny override destination.** Domyślnie worker wysyła do endpointu GA4
  Measurement Protocol. Ustaw `server_side_endpoint`, aby kierować zdarzenia na
  inny URL kolekcji (np. self-hosted proxy lub server-side GTM container).
  `server_side_api_secret` (GA4 Measurement Protocol API secret, utworzony w GA4
  Admin → Data Streams → Measurement Protocol API secrets) uwierzytelnia dostawę.
- **Consent** jest niesiony w payload MP (`analyticsStorage`) odzwierciedlając
  rzeczywistą decyzję bannera visitora.
- **Enhanced Measurement** jest replikowane w przeglądarce (ponieważ gtag.js nie
  jest ładowany) i routowane przez serwer: `scroll` (90%), outbound `click`,
  `file_download`, `form_start` / `form_submit` oraz `view_search_results` (site
  search). Video engagement nie jest objęte — wymagałoby client-side integracji
  YouTube player. W trybie client gtag.js emituje to wszystko sam.

## Uprawnienia

`google_analytics:read` i `google_analytics:write` gate'ują powierzchnię admina
(CRUD zdarzeń niestandardowych). Settings per kanał są zarządzane przez generyczny
ekran Settings admina.

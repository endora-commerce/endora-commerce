---
title: Meta Ads
description: Meta Pixel per kanał sprzedaży, ze standardowymi zdarzeniami commerce i opcjonalnymi zdarzeniami niestandardowymi
---

# Meta Ads

Umieszcza **Meta Pixel** na storefront per kanał sprzedaży i raportuje
standardowe zdarzenia commerce Meta, z opcjonalnymi zdarzeniami niestandardowymi
na wierzchu.

Id modułu `meta_ads`.

## Konfiguracja (moduł Settings)

Wszystkie wartości żyją w grupie ustawień **Meta Ads** i są nadpisywalne per
kanał sprzedaży.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `meta_ads.enabled` | boolean | `false` | Master switch dla kanału. |
| `meta_ads.pixel_id` | string | `''` | Pixel ID z Events Manager. |
| `meta_ads.require_consent` | boolean | `true` | Gate'uj całe zachowanie Meta decyzją z cookie bannera. |

Kanał jest śledzony tylko gdy master switch jest włączony **i** Pixel ID jest
niepusty. Pusty Pixel ID to „nie skonfigurowano”, nigdy błąd widoczny dla
visitora — wyczyszczenie pola to bezpieczny sposób wstrzymania kanału.

## Zachowanie storefront

Pixel ładuje się asynchronicznie i nigdy nie blokuje first paint. Nic
związanego z Meta nie działa — ani skrypt, ani cookie, ani request — dopóki
visitor nie zaakceptuje cookie bannera, chyba że operator wyłączy wymóg consent
dla tego kanału. Visitor akceptujący w trakcie sesji jest śledzony od tej
chwili bez przeładowania.

Consent to jedna decyzja storefront, współdzielona z Google Analytics i LinkedIn
Ads — zawsze jeden banner i jedna zapisana odpowiedź. Każda platforma gate'uje
się niezależnie: włączenie lub wyłączenie Meta nie wpływa na pozostałe.

## Zdarzenia standardowe

Te odpalają się automatycznie dla akcji storefront, które platforma już emituje,
z parametrami oczekiwanymi przez Meta do dopasowania katalogu i raportowania ROAS:

| Akcja storefront | Meta event |
| --- | --- |
| Product viewed | `ViewContent` |
| Added to cart | `AddToCart` |
| Checkout started | `InitiateCheckout` |
| Order completed | `Purchase` |
| Added to quote request | `Lead` |
| Contact form submitted | `Lead` |
| Added to shopping list | *(none)* |
| Place Order clicked | *(none)* |

Nazwy są ustalone w kodzie, nieedytowalne — optymalizacja Meta i dopasowanie
katalogu opierają się na tych dokładnych nazwach, więc ich zmiana cicho
obniżyłaby jakość raportowania.

## Zdarzenia niestandardowe

W **Admin → Meta Ads** możesz raportować którąkolwiek z tych akcji storefront
pod własną nazwą zdarzenia — na przykład „added to quote request” jako
`SubmitQuote` dla audience B2B.

Zdarzenie niestandardowe jest **addytywne**: zdarzenie standardowe nadal odpala,
a Twoje odpala obok niego. Nigdy nie zastępuje standardowego, więc dodanie
zdarzenia audience nie kosztuje raportowania `Purchase`. Dwie akcje bez
zdarzenia standardowego akceptują mapowania niestandardowe — dokładnie po to
są.

Mapowanie może targetować jeden kanał sprzedaży lub wszystkie i może być
wyłączone bez usuwania.

## Uprawnienia

| Code | Grants |
| --- | --- |
| `meta_ads:read` | Podgląd zdarzeń niestandardowych i strony modułu. |
| `meta_ads:write` | Tworzenie, edycja i usuwanie zdarzeń niestandardowych. |

Oba pojawiają się na `/admin-roles`. Zmiany są audytowane z operatorem.

## Jeszcze nie zaimplementowane

- **Conversions API (raportowanie po stronie serwera).** Piksele w przeglądarce
  są mocno blokowane przez ad-blockery, więc spodziewaj się niedoszacowania
  konwersji, dopóki to nie wyląduje. Wymaga access tokena i event ID współdzielonego
  ze zdarzeniem przeglądarkowym do deduplikacji — warto zrobić raz dla obu
  platform reklamowych.
- **Retracja konwersji** dla zwróconych lub anulowanych zamówień.

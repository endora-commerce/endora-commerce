---
title: LinkedIn Ads
description: LinkedIn Insight Tag per kanał sprzedaży, raportujący akcje storefront względem reguł konwersji Campaign Manager
---

# LinkedIn Ads

Umieszcza **LinkedIn Insight Tag** na storefront per kanał sprzedaży i raportuje
akcje storefront względem reguł konwersji zdefiniowanych w LinkedIn Campaign
Manager.

Id modułu `linkedin_ads`.

## Konfiguracja (moduł Settings)

Wszystkie wartości żyją w grupie ustawień **LinkedIn Ads** i są nadpisywalne
per kanał sprzedaży.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `linkedin_ads.enabled` | boolean | `false` | Master switch dla kanału. |
| `linkedin_ads.partner_id` | string | `''` | Partner ID Insight Tag z Campaign Manager. |
| `linkedin_ads.require_consent` | boolean | `true` | Gate'uj całe zachowanie LinkedIn decyzją z cookie bannera. |
| `linkedin_ads.server_side_enabled` | boolean | `false` | Zarezerwowane pod raportowanie Conversions API (jeszcze nie zaimplementowane). |
| `linkedin_ads.access_token` | secret | `''` | Token Conversions API. Szyfrowany at rest, write-only — nigdy nie zwracany przez żadne API. |

Kanał jest śledzony tylko gdy master switch jest włączony **i** Partner ID jest
niepusty. Pusty Partner ID traktowany jest jako „nie skonfigurowano”, nigdy jako
błąd widoczny dla visitora — wyczyszczenie pola to bezpieczny sposób wyłączenia
kanału.

## Zachowanie storefront

Insight Tag jest wstrzykiwany po stronie klienta, po interakcji, więc nigdy nie
blokuje first paint. Nic związanego z LinkedIn nie działa — ani skrypt, ani
cookie, ani request — dopóki visitor nie zaakceptuje cookie bannera, chyba że
operator wyłączy wymóg consent dla tego kanału. Visitor akceptujący w trakcie
sesji jest śledzony od tej chwili bez przeładowania strony.

Consent to jedna decyzja storefront, współdzielona z Google Analytics — zawsze
jeden banner i jedna zapisana odpowiedź.

## Mapowania konwersji

Najpierw zdefiniuj konwersje w Campaign Manager; każda dostaje numeryczne ID
konwersji. Następnie mapuj akcje storefront na te ID w **Admin → LinkedIn Ads**.

Obsługiwane akcje: product viewed, added to cart, added to quote request,
added to shopping list, checkout started, Place Order clicked, order completed,
contact form submitted. Lista jest dokładnie tym, co emituje storefront — nie
możesz mapować akcji, która nigdy nie mogłaby odpalić.

Mapowanie może targetować jeden kanał sprzedaży lub wszystkie i może być
wyłączone bez usuwania. Akcja bez włączonego mapowania po prostu nic nie
raportuje — to normalny stan, nie błędna konfiguracja. Jedna akcja może
mapować się na kilka ID konwersji; każde raportuje raz.

Mapowania są serwowane do storefront przez cache'owaną konfigurację per kanał;
utworzenie, edycja lub usunięcie mapowania natychmiast revaliduje ten cache,
zamiast czekać na TTL.

## Uprawnienia

| Code | Grants |
| --- | --- |
| `linkedin_ads:read` | Podgląd mapowań konwersji i strony modułu. |
| `linkedin_ads:write` | Tworzenie, edycja i usuwanie mapowań konwersji. |

Oba pojawiają się na `/admin-roles`. Zmiany mapowań są audytowane z operatorem.

Konwersje raportowane są z przeglądarki przez `lintrk` i tylko gdy visitor
wyraził zgodę. Akcja zmapowana więcej niż raz raportuje raz na mapowanie.

## Jeszcze nie zaimplementowane

- **Raportowanie po stronie serwera przez Conversions API.** Wyspecyfikowane i
  gotowe pod ustawienia, więc włączenie później nie wymaga zmiany kontraktu;
  `linkedin_ads.server_side_enabled` pozostaje wyłączone. Gdy zostanie włączone,
  ścieżka przeglądarkowa dla zmapowanych konwersji jest tłumiona, żeby każda
  konwersja miała dokładnie jeden transport.
- **Retracja konwersji** dla zwróconych lub anulowanych zamówień.

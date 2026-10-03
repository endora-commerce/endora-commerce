---
title: LinkedIn Ads
description: LinkedIn Insight Tag osobno dla każdego kanału sprzedaży, raportujący działania w storefroncie według reguł konwersji z Campaign Managera
---

# LinkedIn Ads

Umieszcza w storefroncie **LinkedIn Insight Tag**, osobno dla każdego kanału sprzedaży, i raportuje
działania w storefroncie według reguł konwersji zdefiniowanych w LinkedIn Campaign Managerze.

Identyfikator modułu: `linkedin_ads`.

## Konfiguracja (moduł ustawień)

Wszystkie wartości są w grupie ustawień **LinkedIn Ads** i można je nadpisać dla każdego kanału
sprzedaży.

| Ustawienie | Typ | Wartość domyślna | Znaczenie |
| --- | --- | --- | --- |
| `linkedin_ads.enabled` | boolean | `false` | Główny przełącznik dla kanału. |
| `linkedin_ads.partner_id` | string | `''` | Partner ID tagu Insight Tag z Campaign Managera. |
| `linkedin_ads.require_consent` | boolean | `true` | Uzależnia całe działanie LinkedIn od decyzji w banerze cookie. |
| `linkedin_ads.server_side_enabled` | boolean | `false` | Zarezerwowane dla raportowania przez Conversions API (jeszcze nie zaimplementowane). |
| `linkedin_ads.access_token` | secret | `''` | Token Conversions API. Szyfrowany w bazie, tylko do zapisu — nigdy nie jest zwracany przez żadne API. |

Kanał jest śledzony tylko wtedy, gdy główny przełącznik jest włączony **i** Partner ID nie jest
pusty. Pusty Partner ID oznacza „nie skonfigurowano” i nigdy nie powoduje błędu widocznego dla
odwiedzającego — wyczyszczenie tego pola to bezpieczny sposób wyłączenia kanału.

## Działanie w storefroncie

Insight Tag jest wstawiany po stronie klienta, po interakcji, więc nigdy nie opóźnia pierwszego
wyświetlenia strony. Dopóki odwiedzający nie zaakceptuje banera cookie, nic związanego z LinkedIn
nie działa — ani skrypt, ani ciasteczko, ani żądanie — chyba że operator wyłączył wymóg zgody dla
tego kanału. Odwiedzający, który wyrazi zgodę w trakcie sesji, jest śledzony od tej chwili, bez
przeładowania strony.

Zgoda to jedna decyzja w storefroncie, wspólna z Google Analytics — zawsze jest jeden baner i jedna
zapisana odpowiedź.

## Mapowanie konwersji

Najpierw zdefiniuj konwersje w Campaign Managerze; każda dostaje liczbowy identyfikator konwersji.
Potem przypisz działania w storefroncie do tych identyfikatorów w **Admin → LinkedIn Ads**.

Obsługiwane działania: obejrzenie produktu, dodanie do koszyka, dodanie do zapytania ofertowego,
dodanie do listy zakupów, rozpoczęcie checkoutu, kliknięcie Place Order, złożenie zamówienia,
wysłanie formularza kontaktowego. Ta lista to dokładnie to, co emituje storefront — nie da się
przypisać działania, które nigdy nie mogłoby wystąpić.

Przypisanie może dotyczyć jednego kanału sprzedaży albo wszystkich i można je wyłączyć bez
usuwania. Działanie bez włączonego przypisania po prostu niczego nie raportuje — to normalny stan,
a nie błąd konfiguracji. Jedno działanie może być przypisane do kilku identyfikatorów konwersji;
każdy jest raportowany raz.

Przypisania trafiają do storefrontu przez konfigurację kanału przechowywaną w pamięci podręcznej;
utworzenie, edycja lub usunięcie przypisania od razu ją odświeża, zamiast czekać na wygaśnięcie.

## Uprawnienia

| Kod | Daje dostęp do |
| --- | --- |
| `linkedin_ads:read` | Podglądu przypisań konwersji i strony modułu. |
| `linkedin_ads:write` | Tworzenia, edycji i usuwania przypisań konwersji. |

Oba są dostępne na `/admin-roles`. Zmiany przypisań są audytowane wraz z operatorem.

Konwersje są raportowane z przeglądarki przez `lintrk` i tylko wtedy, gdy odwiedzający wyraził
zgodę. Działanie przypisane wielokrotnie jest raportowane raz dla każdego przypisania.

## Jeszcze nie zaimplementowane

- **Raportowanie po stronie serwera przez Conversions API.** Opisane w specyfikacji i
  przygotowane w ustawieniach, więc późniejsze włączenie nie wymaga zmiany kontraktu;
  `linkedin_ads.server_side_enabled` pozostaje wyłączone. Po włączeniu raportowanie z przeglądarki
  dla przypisanych konwersji zostanie wstrzymane, aby każda konwersja miała dokładnie jeden kanał
  przekazania.
- **Wycofywanie konwersji** dla zwróconych lub anulowanych zamówień.

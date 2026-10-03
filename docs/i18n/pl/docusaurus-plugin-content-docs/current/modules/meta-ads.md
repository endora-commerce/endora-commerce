---
title: Meta Ads
description: Meta Pixel osobno dla każdego kanału sprzedaży, ze standardowymi zdarzeniami e-commerce i opcjonalnymi zdarzeniami własnymi
---

# Meta Ads

Umieszcza w storefroncie **Meta Pixel**, osobno dla każdego kanału sprzedaży, i raportuje
standardowe zdarzenia e-commerce Meta, opcjonalnie uzupełnione o zdarzenia własne.

Identyfikator modułu: `meta_ads`.

## Konfiguracja (moduł ustawień)

Wszystkie wartości są w grupie ustawień **Meta Ads** i można je nadpisać dla każdego kanału
sprzedaży.

| Ustawienie | Typ | Wartość domyślna | Znaczenie |
| --- | --- | --- | --- |
| `meta_ads.enabled` | boolean | `false` | Główny przełącznik dla kanału. |
| `meta_ads.pixel_id` | string | `''` | Pixel ID z Events Managera. |
| `meta_ads.require_consent` | boolean | `true` | Uzależnia całe działanie Meta od decyzji w banerze cookie. |

Kanał jest śledzony tylko wtedy, gdy główny przełącznik jest włączony **i** Pixel ID nie jest pusty.
Pusty Pixel ID oznacza „nie skonfigurowano” i nigdy nie powoduje błędu widocznego dla
odwiedzającego — wyczyszczenie tego pola to bezpieczny sposób wstrzymania kanału.

## Działanie w storefroncie

Piksel wczytuje się asynchronicznie i nigdy nie opóźnia pierwszego wyświetlenia strony. Dopóki
odwiedzający nie zaakceptuje banera cookie, nic związanego z Meta nie działa — ani skrypt, ani
ciasteczko, ani żądanie — chyba że operator wyłączył wymóg zgody dla tego kanału. Odwiedzający,
który wyrazi zgodę w trakcie sesji, jest śledzony od tej chwili, bez przeładowania.

Zgoda to jedna decyzja w storefroncie, wspólna z Google Analytics i LinkedIn Ads — zawsze jest
jeden baner i jedna zapisana odpowiedź. Każda platforma jest włączana niezależnie: włączenie lub
wyłączenie Meta nie wpływa na pozostałe.

## Zdarzenia standardowe

Są wysyłane automatycznie przy działaniach w storefroncie, które platforma już emituje, z
parametrami, których Meta oczekuje do dopasowania katalogu i raportowania ROAS:

| Działanie w storefroncie | Zdarzenie Meta |
| --- | --- |
| Obejrzenie produktu | `ViewContent` |
| Dodanie do koszyka | `AddToCart` |
| Rozpoczęcie checkoutu | `InitiateCheckout` |
| Złożenie zamówienia | `Purchase` |
| Dodanie do zapytania ofertowego | `Lead` |
| Wysłanie formularza kontaktowego | `Lead` |
| Dodanie do listy zakupów | *(brak)* |
| Kliknięcie Place Order | *(brak)* |

Nazwy są ustalone w kodzie i nie da się ich edytować — optymalizacja i dopasowanie katalogu w Meta
opierają się właśnie na tych nazwach, więc ich zmiana po cichu pogorszyłaby jakość raportowania.

## Zdarzenia własne

W **Admin → Meta Ads** możesz raportować dowolne z tych działań w storefroncie pod własną nazwą
zdarzenia — na przykład dodanie do zapytania ofertowego jako `SubmitQuote` dla grupy odbiorców B2B.

Zdarzenie własne jest **dodatkowe**: zdarzenie standardowe nadal jest wysyłane, a twoje — obok
niego. Nigdy go nie zastępuje, więc dodanie zdarzenia dla grupy odbiorców nie odbiera raportowania
`Purchase`. Dwa działania bez zdarzenia standardowego przyjmują zdarzenia własne — właśnie po to są.

Przypisanie może dotyczyć jednego kanału sprzedaży albo wszystkich i można je wyłączyć bez
usuwania.

## Uprawnienia

| Kod | Daje dostęp do |
| --- | --- |
| `meta_ads:read` | Podglądu zdarzeń własnych i strony modułu. |
| `meta_ads:write` | Tworzenia, edycji i usuwania zdarzeń własnych. |

Oba są dostępne na `/admin-roles`. Zmiany są audytowane wraz z operatorem.

## Jeszcze nie zaimplementowane

- **Conversions API (raportowanie po stronie serwera).** Piksele w przeglądarce są często
  blokowane przez programy blokujące reklamy, więc do czasu wprowadzenia tej funkcji spodziewaj się
  zaniżonej liczby konwersji. Wymaga tokenu dostępu i identyfikatora zdarzenia wspólnego ze
  zdarzeniem z przeglądarki, aby usuwać duplikaty — warto zrobić to raz dla obu platform
  reklamowych.
- **Wycofywanie konwersji** dla zwróconych lub anulowanych zamówień.

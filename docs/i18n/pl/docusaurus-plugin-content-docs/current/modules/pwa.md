---
title: PWA (Progressive Web App)
description: Funkcje Progressive Web App dla storefrontu i panelu administracyjnego — instalacja na ekranie głównym, opcjonalna pamięć podręczna zasobów, kontrolowane aktualizacje i opcjonalne powiadomienia push
---

# PWA (Progressive Web App)

Moduł `pwa` dodaje do storefrontu i panelu administracyjnego funkcje Progressive Web App: instalację
na ekranie głównym, tożsamość aplikacji konfigurowaną w ustawieniach osobno dla każdego kanału
sprzedaży, opcjonalną pamięć podręczną zasobów statycznych, kontrolowaną aktualizację service
workera oraz opcjonalne powiadomienia push za warstwą niezależną od dostawcy.

## Dla właściciela produktu

- **Instalacja na ekranie głównym** — kupujący mogą dodać storefront do ekranu głównego telefonu;
  uruchamia się jak natywna aplikacja, ze skonfigurowaną nazwą i ikoną. Pracownicy mogą w ten sam
  sposób zainstalować panel administracyjny jako osobną aplikację.
- **Konfiguracja w ustawieniach** — nazwę aplikacji, nazwę skróconą, kolory motywu i tła, ikonę oraz
  włączenie pamięci podręcznej i powiadomień push ustawia się w **Settings → PWA**. Każda wartość
  może być globalna albo nadpisana dla kanału sprzedaży. Zmiany zaczynają obowiązywać po około
  minucie, bez wdrożenia.
- **Szybszy storefront, odporniejszy na brak sieci** — przy włączonej pamięci podręcznej kolejne
  wizyty wczytują szkielet strony z urządzenia, a po utracie połączenia pojawia się czytelna strona
  offline. Ceny, stany magazynowe i koszyk nigdy nie trafiają do pamięci podręcznej — zawsze
  pokazują aktualne dane.
- **Powiadomienia push** — po włączeniu kupujący mogą sami zgodzić się na powiadomienia. W panelu
  administracyjnym można wysłać wiadomość do wszystkich albo do wybranych odbiorców. Dodatkowo
  klienci są automatycznie powiadamiani o swoich zamówieniach i zapytaniach ofertowych:
  - **Zmiany statusu zamówienia** — za każdym razem, gdy zamówienie klienta przechodzi do nowego
    statusu. Powiadomienie podaje numer zamówienia i status w brzmieniu nadanym przez sklep, a po
    kliknięciu otwiera to zamówienie.
  - **Zmiany statusu zapytania ofertowego** — gdy pracownik przygotuje ofertę dla klienta, gdy
    oferta zostanie zaktualizowana, zatwierdzona lub anulowana oraz gdy wygaśnie. Powiadomienie
    podaje numer zapytania i po kliknięciu otwiera to zapytanie. Złożenie zapytania przez samego
    klienta nie wysyła mu powiadomienia.

  Powiadamiany jest wyłącznie klient, który złożył zamówienie lub zapytanie, na urządzeniach
  zasubskrybowanych w danym kanale sprzedaży. Powiadomienia są pisane w języku kanału sprzedaży
  (po polsku albo po angielsku; dla każdego innego języka — po angielsku).
- **Wybór zmian statusu, o których wysyłamy powiadomienia** — w **Settings → PWA**, pod
  przełącznikiem powiadomień push, opcje *Powiadamiaj o zmianach statusu zamówienia* i
  *Powiadamiaj o zmianach statusu zapytań ofertowych* włączają lub wyłączają każdą kategorię,
  globalnie albo dla kanału sprzedaży. Obie są domyślnie włączone. Gdy powiadomienia push są
  wyłączone, obie opcje są nieaktywne; opcja dla zapytań ofertowych nie jest dostępna, gdy moduł
  zapytań ofertowych jest wyłączony; żadna z nich nie wpływa na wiadomości wysyłane ręcznie. Ekran
  jest też dostępny z palety poleceń (⌘K / CTRL+K → *Ustawienia PWA*).
- **Wybór po stronie klienta** — na stronie profilu konta, w sekcji *Powiadomienia push*,
  zalogowany klient może odznaczyć *Zmiany statusu zamówień* lub *Aktualizacje zapytań
  ofertowych*. Wybór dotyczy wszystkich urządzeń, na których klient włączył powiadomienia, a do
  czasu zmiany obie opcje są włączone. *Powiadomienia na tym urządzeniu* to nadal miejsce, w
  którym włącza się lub wyłącza powiadomienia w jednej przeglądarce; wylogowanie wyłącza je w tej
  przeglądarce, więc współdzielone lub przekazane dalej urządzenie nie otrzymuje dalej wiadomości
  kierowanych do konta.
- Panel administracyjny w tej wersji nie odbiera powiadomień push.

## Dla programisty

### Konfiguracja

Cała tożsamość aplikacji i przełączniki są w module ustawień, w grupie `pwa`, i są wyznaczane dla
każdego kanału sprzedaży przez standardowy łańcuch: wartość globalna, potem nadpisanie:

| Ustawienie | Typ | Uwagi |
|---------|------|-------|
| `pwa.app_name`, `pwa.short_name` | string | tożsamość w manifeście |
| `pwa.theme_color`, `pwa.background_color` | string | kod hex |
| `pwa.display_mode` | string | `standalone` / `fullscreen` / `minimal-ui` |
| `pwa.icon_asset_id` | string | identyfikator pliku źródłowego z biblioteki mediów |
| `pwa.caching_enabled`, `pwa.push_enabled` | boolean | domyślnie wyłączone |
| `pwa.push_order_status_enabled`, `pwa.push_quote_status_enabled` | boolean | domyślnie włączone; automatyczne powiadomienia o zmianie statusu dla każdej kategorii, działają tylko przy włączonym `pwa.push_enabled` |
| `pwa.vapid_public_key` | string | przekazywany do procesu subskrypcji |
| `pwa.vapid_private_key` | secret | podpis Web Push (szyfrowany AES-256-GCM w bazie) |
| `pwa.fcm_service_account` | secret | zarezerwowane dla dostawcy FCM opartego na tokenach |

### Automatyczne powiadomienia o zmianie statusu

Oba wyzwalacze obsługuje jeden wewnętrzny moduł składający (`status-push-composer.ts`), który
sprawdza warunki w stałej kolejności: obiekt (zamówienie złożone przez konto klienta albo zapytanie
ofertowe) → jego kanał (zapytanie utworzone poza kanałem używa domyślnego kanału systemu) →
`pwa.push_enabled` i ustawienie kategorii dla tego kanału → konto (konta nieistniejące, usunięte
lub zanonimizowane są pomijane) → wybór klienta. Treść `notification.*` z pakietu tłumaczeń
modułu jest renderowana przez `_i18n` w domyślnym języku kanału, a dla każdego zdarzenia trafia do
kolejki jedna wiadomość z `audience.customers = [konto]` i `sourceEventId = eventId`, więc
ponownie dostarczone zdarzenie nie tworzy drugiej wiadomości. Cała sekwencja działa w zakresie
systemowym: proces wygaszania zapytań emituje zdarzenie bez żadnego kontekstu dzierżawy.

| Zdarzenie (właściciel) | Powiadomienie |
|---------------|--------------|
| `order.status_changed.v1` (`orders`) | numer zamówienia i nazwa statusu z `orderReadPort.findStatusDefinition(to)` (nazwa w języku → nazwa domyślna → kod); otwiera `/orders/<id>` |
| `rfq.created_by_admin.v1` (`quote_requests`) | *przygotowano dla Ciebie*; otwiera `/quote-requests/<id>` |
| `rfq.modified.v1` | *czeka zaktualizowana oferta* |
| `rfq.approved.v1` | *zatwierdzone* |
| `rfq.canceled.v1` | *anulowane* |
| `rfq.expired.v1` | *wygasło* |

`rfq.created.v1` (złożenie zapytania przez samego klienta) nie jest obsługiwane. Część dotycząca
zapytań odczytuje `quoteRequestReadPort` przez niewiążącą zależność **`degrades-without`** od
`quote_requests`: przed wywołaniem portu sprawdza, czy ten moduł jest obecny, więc przy wyłączonych
zapytaniach ofertowych powiadomienia o zamówieniach działają dalej, a przełącznik i wybór dla
zapytań po prostu nie są oferowane. Błąd podczas tworzenia powiadomienia jest zapisywany w logu
(`pwa.push_enqueue_failed`), odmowa wyłączonego modułu-właściciela — osobnym wpisem
(`pwa.push_skipped_module_disabled`); żadne z nich nie wpływa na zmianę statusu, która je wywołała.

### Wybór klienta

`push_notification_preferences` przechowuje jeden wiersz na konto klienta
(`order_status_enabled`, `quote_status_enabled` oraz `organization_id` konta, zapisywany przy
każdej zmianie). **Brak wiersza oznacza obie kategorie włączone.**

- `GET /api/v1/storefront/pwa/preferences` → `{ data: { orderStatus, quoteStatus } }`
- `PUT /api/v1/storefront/pwa/preferences` z `{ orderStatus?, quoteStatus? }` (co najmniej jedno
  pole; nieznane klucze są odrzucane) → pełny wynikowy wybór.

Oba wymagają zalogowanego klienta (w przeciwnym razie 401) i zawsze odczytują lub zapisują tylko
jego własny wiersz. Zapis jest wykonywany jako polecenie `pwa.push_preference.update`, więc każda
zmiana trafia do dziennika audytu z klientem jako wykonawcą. `GET /api/v1/storefront/pwa/config`
zawiera `orderStatusPushEnabled` i `quoteStatusPushEnabled` — czy dana kategoria jest obecnie
oferowana w kanale — i na tej podstawie storefront pokazuje obie opcje.

### Warstwa powiadomień push

`PushProvider` (w `@endora-commerce/contracts`) to wymienny punkt rozszerzenia odpowiedzialny za
dostarczanie. Domyślny `WebPushProvider` wysyła standardowe powiadomienia Web Push podpisane VAPID
przez bibliotekę `web-push` (w Chrome endpointy przechodzą przez bezpłatny FCM Google). Oparty na
tokenach `FcmProvider` (`firebase-admin`) i `OneSignalProvider` to gotowe do podłączenia punkty
rozszerzenia — zarejestruj je w composition root i ustaw jako domyślne w rejestrze; proces
subskrypcji w storefroncie się nie zmienia.

Rozsyłanie obsługuje konsument kolejki BullMQ (`pwa.push.deliver`) z idempotentnym dostarczaniem
według `(message_id, subscription_id)`; martwe endpointy (`404`/`410`) są automatycznie usuwane.

### Aktualizacje service workera

Nazwy pamięci podręcznej zawierają identyfikator buildu. Przy każdym wdrożeniu ustaw
`NEXT_PUBLIC_BUILD_ID` (storefront) i `VITE_BUILD_ID` (panel). Service worker storefrontu nie wywołuje
sam `skipWaiting` — `PwaRegister` pokazuje komunikat „dostępna nowa wersja” i aktywuje ją dopiero po
kliknięciu użytkownika, więc aktualizacja nigdy nie przerywa trwającej pracy.

## Lista kontrolna przed publikacją w sklepach z aplikacjami

PWA storefrontu jest przygotowana do opakowania dla Google Play (Trusted Web Activity) i App Store
(aplikacja z WKWebView). Budowanie i publikacja natywnych aplikacji są poza zakresem; gotowość
techniczna:

- [x] Pełny manifest: `name`, `short_name`, `start_url`, `scope`, `display: standalone`,
  `theme_color`, `background_color` oraz ikony, w tym 512×512 `maskable` (udostępniane osobno dla
  każdego kanału pod `/manifest.webmanifest`).
- [x] Zarejestrowany service worker z obsługą `fetch` i stroną offline.
- [x] Na produkcji wyłącznie HTTPS (bezpieczny kontekst).
- [x] Brak wzorców blokujących instalację; łagodna degradacja w nieobsługiwanych przeglądarkach.
- [ ] **Android TWA**: udostępnij `/.well-known/assetlinks.json` (Digital Asset Links) z odciskiem
  klucza podpisującego aplikację opakowującą. *(Krok operatora przy pakowaniu).*
- [ ] **iOS**: powiadomienia web push działają dopiero po zainstalowaniu PWA na ekranie głównym —
  zgoda na powiadomienia już uwzględnia tę kolejność.

## Instrukcja dla operatora

1. Ustaw `SETTINGS_SECRET_ENCRYPTION_KEY` (dla sekretów VAPID i FCM) i uruchom
   `pnpm run migrate` w katalogu głównym instancji (wykonuje migracje tego modułu, w tym
   `push_notification_preferences`). W klonie repozytorium Endora Commerce ten sam krok to
   `pnpm --filter backend run migration:up`.
2. W **Settings → PWA** ustaw tożsamość aplikacji, prześlij ikonę, włącz pamięć podręczną i
   powiadomienia push oraz wybierz, czy zmiany statusu zamówień i zapytań ofertowych mają
   powiadamiać klientów.
3. Kliknij **Generate VAPID keys** (albo wywołaj `POST /api/v1/admin/pwa/vapid/generate`).
4. Ustaw `NEXT_PUBLIC_BUILD_ID` / `VITE_BUILD_ID` w procesie wdrożenia.
5. Przetestuj instalację i powiadomienia push przez HTTPS na urządzeniu.

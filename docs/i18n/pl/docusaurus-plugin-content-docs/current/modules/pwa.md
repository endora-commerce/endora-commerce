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
  administracyjnym można wysłać wiadomość do wszystkich albo do wybranych odbiorców, a zmiany statusu
  zamówienia i aktualizacje zapytań ofertowych automatycznie powiadamiają subskrybujących klientów.
  Panel administracyjny w tej wersji nie odbiera powiadomień push.

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
| `pwa.vapid_public_key` | string | przekazywany do procesu subskrypcji |
| `pwa.vapid_private_key` | secret | podpis Web Push (szyfrowany AES-256-GCM w bazie) |
| `pwa.fcm_service_account` | secret | zarezerwowane dla dostawcy FCM opartego na tokenach |

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
   `pnpm --filter backend run migration:up` (wykonuje `080_pwa_init`).
2. W **Settings → PWA** ustaw tożsamość aplikacji, prześlij ikonę, włącz pamięć podręczną i
   powiadomienia push.
3. Kliknij **Generate VAPID keys** (albo wywołaj `POST /api/v1/admin/pwa/vapid/generate`).
4. Ustaw `NEXT_PUBLIC_BUILD_ID` / `VITE_BUILD_ID` w procesie wdrożenia.
5. Przetestuj instalację i powiadomienia push przez HTTPS na urządzeniu.

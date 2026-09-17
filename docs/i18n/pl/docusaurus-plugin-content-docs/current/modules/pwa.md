---
title: PWA (Progressive Web App)
description: Możliwości Progressive Web App dla storefrontu i admina — instalowalność, opt-in cache zasobów, kontrolowana ścieżka aktualizacji i opt-in push
---

# PWA (Progressive Web App)

Moduł `pwa` (feature 046) dodaje możliwości Progressive Web App do
storefrontu i admina: instalowalność na ekranie głównym, tożsamość instalowalna
per Sales Channel sterowana przez Settings, opt-in cache zasobów statycznych,
kontrolowana ścieżka aktualizacji service workera oraz opt-in powiadomień push
za abstrakcją niezależną od dostawcy.

## Dla Product Ownera

- **Instalacja na ekranie głównym** — kupujący mogą dodać storefront na ekran
  główny telefonu; uruchamia się jak natywna aplikacja z skonfigurowaną nazwą
  i ikoną. Personel może analogicznie zainstalować panel admina jako osobną
  aplikację.
- **Konfiguracja w Settings** — ustaw nazwę aplikacji, krótką nazwę, kolory
  theme/background, wgraj ikonę i włącz/wyłącz cache oraz push w **Settings → PWA**.
  Każda wartość może być globalna lub nadpisana per Sales Channel. Zmiany
  obowiązują w ok. minutę, bez deployu.
- **Szybszy, odporniejszy na offline storefront** — przy włączonym cache
  powtórne wizyty ładują shell z urządzenia, a przy utracie sieci pokazuje się
  czytelna strona offline. Ceny, stock i koszyk nigdy nie są cache'owane —
  zawsze odzwierciedlają dane na żywo.
- **Powiadomienia push** — po włączeniu kupujący mogą opt-inować powiadomienia.
  Z admina możesz wysłać broadcast lub wiadomość targetowaną, a zmiany statusu
  zamówienia / aktualizacje quote request automatycznie powiadamiają
  subskrybowanych klientów. Panel admina w tej wersji nie odbiera push.

## Dla developerów

### Konfiguracja

Cała tożsamość + przełączniki żyją w module Settings, grupa `pwa`, rozwiązywana
per Sales Channel przez standardowy łańcuch global + override:

| Setting | Type | Notes |
|---------|------|-------|
| `pwa.app_name`, `pwa.short_name` | string | tożsamość manifestu |
| `pwa.theme_color`, `pwa.background_color` | string | hex |
| `pwa.display_mode` | string | `standalone` / `fullscreen` / `minimal-ui` |
| `pwa.icon_asset_id` | string | id źródła z biblioteki assets |
| `pwa.caching_enabled`, `pwa.push_enabled` | boolean | domyślnie off |
| `pwa.vapid_public_key` | string | serwowany do flow subskrypcji |
| `pwa.vapid_private_key` | secret | podpis Web-Push (AES-256-GCM at rest) |
| `pwa.fcm_service_account` | secret | zarezerwowane dla providera FCM opartego o token |

### Abstrakcja push

`PushProvider` (w `@endora-commerce/contracts`) to wymienialny seam dostarczania.
Domyślny `WebPushProvider` wysyła standardowy Web-Push podpisany VAPID przez
bibliotekę `web-push` (na Chrome endpointy idą przez darmowe FCM Google).
Tokenowy `FcmProvider` (`firebase-admin`) i `OneSignalProvider` to drop-in
punkty rozszerzenia — zarejestruj je w composition root i ustaw domyślny
registry; flow subskrypcji storefrontu się nie zmienia.

Fan-out dostarczania to consumer BullMQ (`pwa.push.deliver`) z idempotentnymi
dostawami `(message_id, subscription_id)`; martwe endpointy (`404`/`410`) są
automatycznie przycinane.

### Aktualizacje service workera

Nazwy cache są kluczowane po build id. Ustaw `NEXT_PUBLIC_BUILD_ID` (storefront)
i `VITE_BUILD_ID` (admin) per deploy. SW storefrontu sam nie robi `skipWaiting`
— `PwaRegister` pokazuje prompt „dostępna nowa wersja” i aktywuje dopiero po
kliknięciu użytkownika, więc aktualizacja nigdy nie odrzuca pracy w toku.

## Checklist opakowania pod sklepy (FR-029 / SC-008)

Storefront PWA jest przygotowany pod opakowanie pod Google Play (Trusted Web
Activity) i App Store (wrapper WKWebView). Produkcja/wysyłka binariów native
jest poza zakresem; gotowość techniczna:

- [x] Pełny web manifest: `name`, `short_name`, `start_url`, `scope`,
  `display: standalone`, `theme_color`, `background_color` oraz ikony w tym
  512×512 `maskable` (serwowane per kanał z `/manifest.webmanifest`).
- [x] Zarejestrowany service worker z handlerem `fetch` i fallbackiem offline.
- [x] Tylko HTTPS (secure context) w produkcji.
- [x] Brak wzorców blokujących instalację; graceful degradation na
  nieobsługiwanych przeglądarkach.
- [ ] **Android TWA**: hostuj `/.well-known/assetlinks.json` (Digital Asset Links)
  z fingerprintem klucza podpisującego aplikacji wrapper. *(Krok operatora przy pakowaniu.)*
- [ ] **iOS**: web push działa dopiero po instalacji PWA na ekranie głównym —
  opt-in już uwzględnia tę kolejność.

## Runbook operatora

1. Ustaw `SETTINGS_SECRET_ENCRYPTION_KEY` (dla sekretów VAPID/FCM) i uruchom
   `pnpm --filter backend run migration:up` (stosuje `080_pwa_init`).
2. W **Settings → PWA** ustaw tożsamość + wgraj ikonę, włącz cache/push.
3. Kliknij **Generate VAPID keys** (lub `POST /api/v1/admin/pwa/vapid/generate`).
4. Ustaw `NEXT_PUBLIC_BUILD_ID` / `VITE_BUILD_ID` w pipeline deploy.
5. Przetestuj instalację + push przez HTTPS na urządzeniu.

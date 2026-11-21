---
title: Weryfikacja dwuetapowa i logowanie federacyjne
description: Weryfikacja dwuetapowa TOTP z kodami odzyskiwania, logowanie przez Google i Microsoft oraz ich zasady dla poszczególnych zakresów.
---

# Weryfikacja dwuetapowa i logowanie federacyjne (`mfa`)

`mfa` dodaje do logowania klientów i administratorów dwie rzeczy: drugi składnik
(aplikacje uwierzytelniające TOTP z jednorazowymi kodami odzyskiwania) oraz
logowanie federacyjne przez konto Google lub Microsoft. Oba włącza się osobno dla
każdej powierzchni — sklepu i Admin UI — a w sklepie także osobno dla każdego
kanału sprzedaży. Organizacja może wymagać drugiego składnika od swoich członków,
a administrator platformy może zresetować drugi składnik wybranej osoby.

Administrator konfiguruje własny drugi składnik na karcie **Bezpieczeństwo**
w **Moim profilu** — otworzysz ją z awatara albo przez ⌘K / CTRL+K,
*Bezpieczeństwo konta*.

Ustawienia, uprawnienia i akcje palety poleceń, które moduł deklaruje, wymienia
jego wygenerowana strona referencyjna.

## Logowanie federacyjne

Kupujący albo administrator może zalogować się kontem Google lub Microsoft,
którego adres e-mail dostawca zweryfikował. Istniejące konto jest dopasowywane po
tym adresie; w sklepie nowe konto powstaje w organizacji prywatnej, jeśli kanał
sprzedaży pozwala na rejestrację bez organizacji. Potem zapada ta sama decyzja o
drugim składniku co przy logowaniu hasłem: konto z aktywnym drugim składnikiem
jest proszone o kod, a konto, które musi go najpierw skonfigurować, wraca do
logowania hasłem.

Dostawca jest proponowany tylko wtedy, gdy jest **skonfigurowany** (jego dane
klienta są w środowisku backendu) **i** **włączony** w ustawieniach danej
powierzchni — `mfa.storefront.google_enabled`, `mfa.storefront.microsoft_enabled`
dla każdego kanału sprzedaży, `mfa.admin.google_enabled`,
`mfa.admin.microsoft_enabled` dla Admin UI.

### Konfiguracja dostawcy

Zarejestruj klienta OAuth u każdego dostawcy i przekaż backendowi jego dane:

| Zmienna | Znaczenie |
| --- | --- |
| `MFA_OAUTH_GOOGLE_CLIENT_ID`, `MFA_OAUTH_GOOGLE_CLIENT_SECRET` | Klient OAuth w Google. |
| `MFA_OAUTH_MICROSOFT_CLIENT_ID`, `MFA_OAUTH_MICROSOFT_CLIENT_SECRET` | Aplikacja w Microsoft Entra ID. |
| `MFA_OAUTH_MICROSOFT_TENANT` | Dzierżawa Entra ID; `common` (domyślnie) przyjmuje konta służbowe, szkolne i prywatne. |

Dostawca zawsze wraca do **backendu**, nigdy do sklepu ani do Admin UI.
Zarejestruj u dostawcy te adresy przekierowania, gdzie `BACKEND_PUBLIC_URL` to
publiczny adres backendu:

```text
${BACKEND_PUBLIC_URL}/api/v1/auth/customer/oauth/google/callback
${BACKEND_PUBLIC_URL}/api/v1/auth/customer/oauth/microsoft/callback
${BACKEND_PUBLIC_URL}/api/v1/auth/admin/oauth/google/callback
${BACKEND_PUBLIC_URL}/api/v1/auth/admin/oauth/microsoft/callback
```

Rejestruj tylko te powierzchnie i tych dostawców, których włączasz. Adres musi
dokładnie odpowiadać `BACKEND_PUBLIC_URL` — schemat, host i port — inaczej
dostawca odrzuci logowanie.

### Adres sklepu każdego kanału sprzedaży

Logowanie w sklepie odsyła kupującego do sklepu tego kanału sprzedaży, na którym
logowanie się zaczęło: do ustawienia kanału **Storefront URL**
(`sales_channels.storefront_url`) albo do `STOREFRONT_BASE_URL`, jeśli kanał
nie podaje własnego. Ten adres musi być hostem, na którym kupujący tego kanału
faktycznie się logują. Kanał obsługiwany pod własną domeną z pustym ustawieniem
odeśle swoich kupujących do sklepu spod `STOREFRONT_BASE_URL`, gdzie logowania
nie da się dokończyć, bo ciasteczko wiążące przeglądarkę należy do innego hosta.

### Jak kończy się logowanie w sklepie

Sklep i backend mogą działać na różnych hostach (na przykład `shop.example.com`
i `api.example.com`). Ciasteczko ustawione przez backend należałoby do hosta
backendu i sklep nigdy by go nie zobaczył. Dlatego backend nie ustawia w imieniu
sklepu żadnego ciasteczka logowania:

1. Przycisk logowania prowadzi do własnej trasy sklepu `/auth/federated/start`.
   Sklep zapisuje losowy sekret w krótko żyjącym ciasteczku na swoim hoście i
   odsyła przeglądarkę do `start` w backendzie ze skrótem tego sekretu.
2. Dostawca wraca do `callback` w backendzie. Backend sprawdza transakcję,
   konto, regułę dostępu kanału sprzedaży i drugi składnik, po czym zapisuje
   jednorazowy kod na sześćdziesiąt sekund i odsyła przeglądarkę do
   `/auth/federated/complete?code=…` w sklepie danego kanału.
3. Sklep wymienia kod bezpośrednio z serwera przez
   `POST /api/v1/auth/customer/oauth/exchange`, przedstawiając sekret ze swojego
   ciasteczka. Dostaje sesję (albo oczekujący drugi krok) i ustawia własne
   ciasteczka, a koszyk z czasu przed zalogowaniem zostaje przeniesiony tak jak
   po logowaniu hasłem.

Kod można wymienić raz, tylko z sekretem przeglądarki, która zaczęła logowanie, i
tylko na kanale sprzedaży, na którym się zaczęło. Każda inna próba dostaje
odpowiedź `400 MFA_FEDERATED_HANDOFF_INVALID`, a sklep pokazuje komunikat o
wygaśnięciu logowania.

Admin UI nie jest tym objęty: rozmawia z backendem bezpośrednio, więc jego sesja
należy do hosta backendu i `callback` ustawia ją właśnie tam.

## Wymaganie drugiego składnika

Drugiego składnika wymaga od administratora ustawienie `mfa.admin.totp_enforced` albo rola, która
wymaga weryfikacji dwuetapowej, a od klienta ustawienie `mfa.storefront.totp_enforced` na kanale
sprzedaży żądania albo zasada jego organizacji. Logowanie i poniższe reguły odczytują wymaganie
w ten sam sposób.

- **Ostatni składnik zostaje.** Dopóki obowiązuje wymaganie, wyłączenie własnego ostatniego
  drugiego składnika (`POST /api/v1/admin/account/mfa/disable`, `POST /api/v1/account/mfa/disable`)
  jest odrzucane z `409 MFA_LAST_FACTOR_REQUIRED`, zanim zostanie sprawdzony kod lub hasło. Trasa
  stanu (`GET …/mfa/status`) zwraca `canDisable` i `disableBlockedReason` (`factor_required`),
  a karta **Mój profil → Bezpieczeństwo** w panelu oraz strona bezpieczeństwa konta w sklepie ukrywają
  formularz wyłączania i wyjaśniają dlaczego. Reset cudzego składnika przez administratora nie jest
  tym objęty.
- **Bez klucza szyfrowania nie ma wymagania.** Bez `MFA_SECRET_ENCRYPTION_KEY` nie da się
  skonfigurować drugiego składnika, więc żadne wymaganie nie obowiązuje i nic z powyższego nie jest
  odrzucane. Włączenie wymagania w takiej instalacji — któregokolwiek ustawienia albo zasady
  organizacji — jest odrzucane z `409 MFA_ENFORCEMENT_UNAVAILABLE`; wyłączenie jest zawsze
  przyjmowane. Ustawienie włączone przy braku klucza pokazuje *Nie obowiązuje: brak klucza
  szyfrowania*, a każde uruchomienie zapisuje to w logu na poziomie błędu.

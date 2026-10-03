---
title: organizations
description: Organizacje klientów, rejestracja, zaproszenia
---

# `organizations`

Organizacje klientów — rejestracja, weryfikacja e-mailem, zarządzanie członkami, zaproszenia i
zawieszanie. Pierwszy użytkownik rejestrujący organizację zostaje jej administratorem
(`organization_admin`).

## API publiczne

Trasy dostępne tylko dla administratora organizacji są chronione po stronie serwera funkcją
`assertOrganizationAdmin`. Trasy administracyjne platformy (`/api/v1/admin/*`) są chronione przez
`customers:manage`.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anonimowy | Rejestracja organizacji i jej pierwszego członka, wysłanie e-maila weryfikacyjnego |
| `POST /api/v1/auth/email-verification/verify` | anonimowy | Użycie tokenu weryfikacyjnego |
| `POST /api/v1/auth/customer/login` | anonimowy | Logowanie klienta → ustawia ciasteczko `b2b_session`; łączy koszyk anonimowy |
| `POST /api/v1/auth/customer/logout` | klient | Zakończenie sesji |
| `POST /api/v1/auth/password-reset/request` | anonimowy | Zawsze 202 (ochrona przed sprawdzaniem, czy konto istnieje) |
| `POST /api/v1/auth/password-reset/confirm` | anonimowy | Użycie tokenu resetu z e-maila |
| `GET /api/v1/me` | klient | Bieżący klient i jego organizacja oraz `impersonation: { impersonatorAdminUserId }`, gdy administrator działa jako kupujący |
| `POST /api/v1/me/password` | klient | Zmiana hasła (odrzucana przy błędnym `currentPassword`) |
| `GET /api/v1/organizations/mine/members` | administrator organizacji | Lista członków |
| `DELETE /api/v1/organizations/mine/members/:id` | administrator organizacji | Usunięcie członka (z ochroną ostatniego administratora) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | administrator organizacji | Nadanie lub odebranie roli administratora (z ochroną ostatniego administratora) |
| `GET /api/v1/organizations/mine/invitations` | administrator organizacji | Lista oczekujących zaproszeń |
| `POST /api/v1/organizations/mine/invitations` | administrator organizacji | Zaproszenie nowego użytkownika; e-mail z linkiem wysyła wstrzyknięty mechanizm poczty |
| `DELETE /api/v1/organizations/mine/invitations/:id` | administrator organizacji | Unieważnienie oczekującego zaproszenia |
| `POST /api/v1/organizations/invitations/:token/accept` | anonimowy | Przyjęcie zaproszenia, utworzenie konta klienta |
| `GET /api/v1/organizations/mine/addresses` | klient | Lista adresów dostawy i do faktury |
| `POST /api/v1/organizations/mine/addresses` | klient | Utworzenie adresu |
| `PATCH /api/v1/organizations/mine/addresses/:id` | klient | Aktualizacja |
| `DELETE /api/v1/organizations/mine/addresses/:id` | klient | Usunięcie |
| `GET /api/v1/admin/organizations` | administrator | Lista z `filter[status]` / `filter[vatStatus]` / `q` |
| `GET /api/v1/admin/organizations/:id` | administrator | Organizacja z listą członków (`updatedAt`, członkowie z `lastLoginAt`) |
| `PATCH /api/v1/admin/organizations/:id` | administrator | Zmiana nazwy, `status` lub `vatStatus`; opcjonalne `expectedUpdatedAt` → `409 VERSION_CONFLICT`, gdy dane są nieaktualne |
| `POST /api/v1/admin/organizations/:id/members/invite` | administrator | Zaproszenie e-mailem z rolą (z poziomu platformy) |
| `POST /api/v1/admin/organizations/:id/members` | administrator | Bezpośrednie utworzenie członka z hasłem |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | administrator | Zmiana roli; opcjonalne `expectedUpdatedAt` członka |
| `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` | administrator | Usunięcie miękkie członka (z ochroną ostatniego administratora) |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | administrator | Procedura awaryjna — nadanie istniejącemu członkowi roli `organization_admin` |

Ustaw **`SMTP_URL`** w środowisku backendu, aby poczta była wysyłana przez SMTP, a nie wypisywana do
konsoli.

## Encje

`Organization`, `OrganizationInvitation`, `EmailVerificationToken`. Unikalności NIP pilnuje baza
danych; powtórna rejestracja zwraca `409 ORGANIZATION_TAX_ID_EXISTS`.

## Emitowane zdarzenia

`organization.registered.v1`, `organization.verified.v1`, `organization.suspended.v1`,
`organization.member_invited.v1`, `organization.member_role_changed.v1`.

## Punkty rozszerzenia

- **Wysyłka weryfikacji** — `email-verification-service.ts` udostępnia wymienny interfejs wysyłki
  poczty; w kompozycji produkcyjnej zastąp wypisywanie do konsoli prawdziwym sterownikiem SMTP lub
  SendGrid.
- **Ochrona ostatniego administratora** — zapisana w `role-service.ts#changeRole` i
  `invitation-service.ts#revoke`; nowe miejsca, w których „musi zostać co najmniej jeden
  administrator”, dodawaj właśnie tam.

## Organizacja jako strona transakcji i jej moderacja

Organizacja jest pełnoprawną stroną transakcji handlowych. Ta sekcja opisuje, jak to działa.

### Status (`pending_verification` → `active` → `blocked` / `rejected`)

Każda nowo zarejestrowana organizacja zaczyna w stanie `pending_verification`. Ustawienie dla całej
platformy `organizations.moderation.mode` (`manual` / `auto`) decyduje, czy przed pierwszą
transakcją administrator musi ją ręcznie zatwierdzić. Gdy status jest inny niż `active`, platforma
odrzuca składanie zamówień, wysyłanie zapytań ofertowych i dodawanie pozycji do koszyka z HTTP 423.

Dawny status `suspended` zmieniono na `blocked` w migracji
`20260611T140349_organizations_consolidation.ts`, która w każdym przepisanym wierszu zapisuje
wyjaśniający `blocked_reason` (nie tworzy wpisu w dzienniku audytu).

Endpointy administracyjne:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/approve` | Przejście `pending_verification` → `active` |
| `POST /api/v1/admin/organizations/:id/reject` | Przejście `pending_verification` → `rejected` (końcowe) |
| `POST /api/v1/admin/organizations/:id/block` | Przejście `active` → `blocked` (decyzja operatora) |
| `POST /api/v1/admin/organizations/:id/unblock` | Przejście `blocked` → `active` |

Każda treść żądania zawiera `expectedVersion: number` (token blokady optymistycznej z kolumny
`organizations.version`), a operacja jest wykonywana w `em.transactional`. Nieaktualne
`expectedVersion` zwraca `409 VERSION_CONFLICT` z `currentVersion` w treści. Niedozwolone przejście
statusu (np. zatwierdzenie już aktywnej organizacji) zwraca `422 VALIDATION_FAILED`.

Po stronie klienta: storefront dostaje przetłumaczony komunikat „dlaczego nie możesz składać
zamówień” w polach `organization.canTransact` i `organization.moderationMessage` z `GET /api/v1/me`.
Strony koszyka i checkoutu wyświetlają nad formularzem `<OrganizationModerationBanner>`, gdy
`canTransact === false`.

### Powiadomienia w panelu

Za powiadomienia w panelu (ikonę dzwonka) odpowiada niewielki moduł `admin_notifications`. Przy
każdej nowej rejestracji organizacji `OrgRegistrationNotifier` zapisuje jedno powiadomienie dla
wszystkich (`audience='all_admins'`, `kind='organization.registered'`) i wysyła po jednym e-mailu na
każdy adres z ustawienia `organizations.notifications.new_registration_recipients`. Panel odpytuje
`GET /api/v1/admin/notifications` co 30 s.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/notifications` | Stronicowana lista z `isRead` wyznaczanym dla każdego administratora |
| `POST /api/v1/admin/notifications/:id/read` | Oznaczenie jednego powiadomienia jako przeczytanego |
| `POST /api/v1/admin/notifications/mark-all-read` | Oznaczenie wszystkich widocznych jako przeczytane |

### Ograniczenia handlowe organizacji

Trzy listy dozwolonych wartości określają, z czego organizacja może korzystać w checkoucie:

- `organization_payment_methods` (tabela łącząca `(organization_id, payment_method_id)`)
- `organization_delivery_methods` (tabela łącząca `(organization_id, delivery_method_id)`)
- `organization_warehouses` (tabela łącząca `(organization_id, warehouse_id)`)

**Pusta lista ⇒ obowiązują ustawienia domyślne platformy.** Niepusta lista filtruje w storefroncie
`GET /api/v1/payment-methods`, `GET /api/v1/delivery-methods` oraz endpointy stanów magazynowych,
ograniczając je do części wspólnej z przypisaniami organizacji wywołującego.

Endpointy administracyjne:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/restrictions` | Odczyt trzech list i `version` organizacji |
| `PUT /api/v1/admin/organizations/:id/restrictions` | Atomowa zamiana wszystkich trzech |
| `PATCH .../restrictions/payment-methods` | Wybiórcza zmiana `{ add?, remove? }` |
| `PATCH .../restrictions/delivery-methods` | To samo |
| `PATCH .../restrictions/warehouses` | To samo |

Wstępne sprawdzenie w storefroncie:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/storefront/checkout/preflight` | Zwraca `{ canTransact, allowedPaymentMethodIds, allowedDeliveryMethodIds, assignedWarehouseIds }` albo 423, gdy organizacja nie może składać zamówień |

### Cenniki obowiązujące organizację i promocje dla organizacji

`OrganizationEffectivePriceListsService.listApplicable(orgId)` korzysta z istniejącego
`application-rule-evaluator` z modułu `price_lists`, aby wyliczyć wszystkie cenniki obecnie
obowiązujące organizację, każdy z tablicą `reasons[]` (`direct_organization_match` /
`customer_group_match` / `sales_channel_inheritance` / `segment_rule_match`). Wynik jest dostępny pod
`GET /api/v1/admin/organizations/:id/applicable-price-lists` i wyświetlany jako tabela tylko do
odczytu na stronie szczegółów organizacji w panelu.

Promocje: gdy promocja jest skierowana do konkretnej organizacji (`promotions.organization_id` jest
ustawione), platforma stosuje ją tylko wtedy, gdy organizacja koszyka ma status `active`. Sprawdzenie
jest podłączone przez wymagany argument konstruktora `resolveOrganizationStatus` w
`PromotionService`, który moduł `promotions` podłącza do
`organizationReadPort.loadEffectiveOrganization`.

### Przypisanie handlowców

`organization_sales_rep_assignments` (tabela łącząca `(organization_id, admin_user_id)`) wiąże
handlowców z organizacjami. Gdy rola administratora wywołującego to `sales_representative`, listy
zamówień i zapytań ofertowych w panelu są ograniczane do organizacji przypisanych temu handlowcowi.
Administratorzy platformy widzą wszystko.

Tę relację obsługują trzy endpointy, należące do tego modułu i przez niego rejestrowane:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/sales-reps` | Lista handlowców przypisanych do organizacji. |
| `POST /api/v1/admin/organizations/:id/sales-reps` | Przypisanie handlowca. |
| `DELETE /api/v1/admin/organizations/:id/sales-reps/:adminUserId` | Usunięcie przypisania. |

Są chronione przez `organizations:assign-sales-rep`. Do 2026-08 rejestrował je moduł zapytań
ofertowych i chronił je `rfqs:handle`, co oznaczało, że wyłączenie zapytań ofertowych odbierało też
możliwość przypisywania handlowców — a kod chroniący ten ekran znikał z macierzy ról. Przypisanie
handlowca dotyczy organizacji, więc należy do tego modułu, z kodem, który ten moduł deklaruje. Po
stronie zapytań ofertowych pozostał jeden endpoint, listowanie w odwrotnym kierunku,
`GET /api/v1/admin/sales-reps/:adminUserId/organizations`: podaje, ile zapytań ofertowych jest
otwartych w każdej organizacji — a to fakt dotyczący tamtego modułu.

Inne moduły odczytują tę relację przez `organizationSalesRepScopePort` tego modułu, nigdy przez
bezpośrednie zapytanie do tabeli łączącej.

### Walidacja numeru VAT i NIP

Port `VatValidator` mają dwie produkcyjne implementacje klienta HTTP:

- `ViesClient` → `POST` na endpoint REST VIES (`/check-vat-number`). Limit czasu 5 s; jedno
  przerwanie przy błędzie sieci.
- `MinisterstwoFinansowClient` → `GET` na `wl-api.mf.gov.pl/api/search/nip/{nip}`. Ograniczenie do
  10 żądań na sekundę w procesie; 7-dniowa pamięć podręczna z kluczem `(nip, today)`, oparta na
  historii w usłudze `OrganizationTaxIdValidation` (jeden wiersz na próbę).

`OrganizationTaxIdValidationService` sam wybiera dostawcę na podstawie przedrostka numeru (polski
10-cyfrowy → MF; inny dwuliterowy przedrostek ISO → VIES; pozostałe → tylko sprawdzenie formatu). Gdy
`applyAutoFill=true` ORAZ wynik to `validated`, `legalName` organizacji jest aktualizowane, a
`version` rośnie, aby następna edycja w panelu uwzględniała blokadę optymistyczną.

Wszystkie adaptery bezpiecznie obsługują awarię dostawcy: `outcome: 'deferred'`. Zapis organizacji
nigdy nie kończy się błędem z powodu problemu zewnętrznego.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/vat-validations` | Jedna próba walidacji (`providerHint`, `applyAutoFill`) |
| `GET /api/v1/admin/organizations/:id/vat-validations` | Historia, od najnowszych |

### Lista wyboru i wyszukiwanie bez polskich znaków

Panel dostarcza komponenty wielokrotnego użytku `<OrganizationPicker>` (wybór jednej organizacji) i
`<OrganizationPickerMulti>` (wybór wielu), zbudowane na istniejącym `<Combobox>`. Korzystają z
`GET /api/v1/admin/organizations?q=`, gdzie parametr `q` nie wymaga znaków diakrytycznych: zapytanie
`lodz` znajduje „Bauhaus Łódź” dzięki zdenormalizowanej kolumnie `name_search`, wypełnianej przez hooki
`@BeforeCreate` / `@BeforeUpdate` encji Organization. `normalizeOrganizationName` to usunięcie
diakrytyków i reguły dotyczące odstępów, których wymaga ta kolumna. Samo usuwanie diakrytyków to
`foldDiacritics` (`packages/contracts/src/text-normalization.ts`), wspólne z panelem: rozkład NFD,
usunięcie znaków łączących, a potem jawna tabela dla liter łacińskich, których NFD nie rozkłada
(`ł`/`Ł`, `ø`/`Ø`, `đ`/`Đ`, `ð`/`Ð`, `þ`/`Þ`, `ß`, `æ`, `œ`). Zmiana tej tabeli sprawi, że nowe
wiersze będą przekształcane inaczej niż stare, więc wymaga migracji `name_search`, a nie zwykłej
edycji.

### Nowe ustawienia (zadeklarowane w manifeście)

| Kod | Typ | Wartość domyślna | Przeznaczenie |
| --- | --- | --- | --- |
| `organizations.moderation.mode` | wyliczenie `string` | `'manual'` | `manual` ⇒ pending_verification; `auto` ⇒ active od razu po rejestracji |
| `organizations.notifications.new_registration_recipients` | tablica `json` | `[]` | Adresy e-mail powiadamiane o nowej organizacji |

### Migracje

- `20260611T140349_organizations_consolidation.ts` — dodaje `legal_name`, kolumny walidacji VAT, kolumny audytu
  blokady, odrzucenia i zatwierdzenia, `version` do blokady optymistycznej, zdenormalizowaną kolumnę
  `name_search`, trzy tabele list dozwolonych, tabelę historii walidacji, indeks B-Tree
  `organizations_name_search_idx` i zamienia każdy wiersz `suspended` na `blocked`.
- `20260611T140350_admin_notifications_init.ts` (należy do `admin_notifications`) — dodaje tabelę `admin_notifications` i tabelę łączącą
  `admin_notification_reads` dla każdego administratora.
- `20260611T140351_customer_accounts_organization_optional.ts` (należy do `customer_accounts`) — dopuściła `NULL` w
  `customer_accounts.organization_id` dla kont gościnnych. **To rozwiązanie jest martwe**: zastąpiły
  je organizacje prywatne, a kolumnę ponownie zaostrzono — zobacz
  `20260825T141659_customer_accounts_organization_required` w `customer_accounts`.
- `20260717T151403_organizations_personal_organizations.ts` — dodaje `organizations.is_personal` i tworzy organizację prywatną
  dla każdego wcześniej istniejącego konta bez organizacji (zobacz „Organizacje prywatne” niżej).

### Organizacje prywatne (B2C)

Organizacja jest jedynym pojęciem tenanta w platformie. Klient B2C, czyli osoba fizyczna, **nie** jest
przypadkiem „bez organizacji”: każda samodzielna rejestracja klienta tworzy jednoosobową
**organizację prywatną** (`is_personal = true`). Organizacja i konto są zapisywane **w jednej
transakcji**, przez moduł, który jest właścicielem wiersza konta, na obu ścieżkach tworzenia konta —
przy samodzielnej rejestracji i przy logowaniu przez zewnętrznego dostawcę tożsamości. Oznacza to, że:

- **Transakcje działają bez zmian.** `organization_id` ma `NOT NULL`, więc zamówienia, zapytania
  ofertowe, limity kredytowe, faktury i adresy nie potrzebują ścieżki „bez organizacji” — a odmowę
  zapewnia kolumna, a nie zabezpieczenie w kodzie: MikroORM stosuje filtr tenanta do `SELECT` /
  `UPDATE` / `DELETE`, ale nie do `INSERT`.
- **Izolacja wynika ze struktury.** Zabezpieczenie izolacji tenantów traktuje każdą organizację
  prywatną jako osobnego tenanta — dwóch klientów B2C nigdy nie widzi swoich danych, bez żadnego
  szczególnego przypadku dla braku organizacji.
- **Wartości domyślne dla osób fizycznych.** `status = active`, `vat_status = vat_exempt`, `name` z
  imienia i nazwiska klienta (albo z części adresu e-mail przed `@`) oraz syntetyczny 32-znakowy
  szesnastkowy `tax_id` utworzony z identyfikatora konta (kolumna ma globalne `UNIQUE`, a osoba
  fizyczna nie ma firmowego NIP).
- **Niewidoczne na ekranach B2B w panelu.** Organizacje prywatne są domyślnie pomijane na listach i
  listach wyboru w panelu, nie można przypisać do nich handlowca i nie trafiają do kolejki moderacji
  (powstają jako `active`). Lista organizacji w panelu przyjmuje `?includePersonal=true`, aby je w
  razie potrzeby pokazać.
- **Dostępność zależna od kanału.** Samodzielną rejestrację (B2C) w każdym kanale sprzedaży włącza
  ustawienie `customers.allow_registration_without_organization`; kanał tylko dla B2B odrzuca
  rejestrację i niczego nie tworzy. Nazwa ustawienia to pozostałość po wcześniejszym rozwiązaniu —
  dotyczy rejestracji poza organizacją *firmową*, a nie rejestracji bez organizacji.
- **Odłączenie członka od firmy przenosi go tutaj.** `DELETE /api/v1/admin/customers/:id/organization`
  w panelu zapisywało kiedyś `organization_id = NULL`; teraz tworzy (albo odnajduje) organizację
  prywatną klienta i przenosi go do niej, zachowując w audycie akcję
  `customer_account.organization_unassigned`.

Organizacje firmowe (B2B) pozostają bez zmian — reguła jednoosobowości (`assertMembershipAllowed`)
odrzuca tylko dodanie drugiego członka do organizacji prywatnej.

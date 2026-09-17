---
title: organizations
description: Customer Organizations, rejestracja, zaproszenia
---

# `organizations`

Customer Organizations — rejestracja, weryfikacja e-mail, zarządzanie członkami,
zaproszenia i stan suspension. Pierwszy użytkownik rejestrującej Organization
staje się jej `organization_admin`.

## Publiczne API

Trasy tylko dla Org-Admin wymuszane są po stronie serwera przez helper
`assertOrganizationAdmin`. Trasy admin (`/api/v1/admin/*`) są gated przez
`customers:manage`.

| Verb + Path | Audience | Cel |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anon | Rejestracja Org + pierwszego członka, wysyłka weryfikacji e-mail |
| `POST /api/v1/auth/email-verification/verify` | anon | Realizacja tokenu weryfikacji |
| `POST /api/v1/auth/customer/login` | anon | Logowanie klienta → ustawia cookie `b2b_session`; scala anonimowy cart |
| `POST /api/v1/auth/customer/logout` | customer | Zniszczenie sesji |
| `POST /api/v1/auth/password-reset/request` | anon | Zawsze 202 (obrona przed enumeracją kont) |
| `POST /api/v1/auth/password-reset/confirm` | anon | Realizacja tokenu resetu z e-maila |
| `GET /api/v1/me` | customer | Bieżący klient + jego organization, plus `impersonation: { impersonatorAdminUserId }`, gdy admin działa jako kupujący (T194) |
| `POST /api/v1/me/password` | customer | Zmiana hasła (odmowa przy złym `currentPassword`) |
| `GET /api/v1/organizations/mine/members` | org admin | Lista członków |
| `DELETE /api/v1/organizations/mine/members/:id` | org admin | Usunięcie członka (guard last-admin) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | org admin | Promote / demote (guard last-admin) |
| `GET /api/v1/organizations/mine/invitations` | org admin | Lista oczekujących zaproszeń (T177) |
| `POST /api/v1/organizations/mine/invitations` | org admin | Zaproszenie nowego użytkownika; e-mail z linkiem realizacji przez wstrzyknięty Mailer |
| `DELETE /api/v1/organizations/mine/invitations/:id` | org admin | Unieważnienie oczekującego zaproszenia (T177) |
| `POST /api/v1/organizations/invitations/:token/accept` | anon | Realizacja zaproszenia, utworzenie Customer Account |
| `GET /api/v1/organizations/mine/addresses` | customer | Lista adresów dostawy / rozliczeniowych |
| `POST /api/v1/organizations/mine/addresses` | customer | Utworzenie adresu |
| `PATCH /api/v1/organizations/mine/addresses/:id` | customer | Aktualizacja |
| `DELETE /api/v1/organizations/mine/addresses/:id` | customer | Usunięcie |
| `GET /api/v1/admin/organizations` | admin | Lista z `filter[status]` / `filter[vatStatus]` / `q` |
| `GET /api/v1/admin/organizations/:id` | admin | Org + skład członków (`updatedAt`, members z `lastLoginAt`) |
| `PATCH /api/v1/admin/organizations/:id` | admin | Aktualizacja name / `status` / `vatStatus`; opcjonalne `expectedUpdatedAt` → `409 VERSION_CONFLICT` gdy nieaktualne |
| `POST /api/v1/admin/organizations/:id/members/invite` | admin | Zaproszenie e-mailem + rola (platform-scope) |
| `POST /api/v1/admin/organizations/:id/members` | admin | Bezpośrednie utworzenie członka z hasłem |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | admin | Zmiana roli; opcjonalne `expectedUpdatedAt` per member |
| `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` | admin | Soft-remove członka (guard last-admin) |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | admin | Break-glass — awans istniejącego członka do `organization_admin` |

Skonfiguruj **`SMTP_URL`** w środowisku backend, aby poczta wychodząca używała SMTP
zamiast loggera konsoli.

## Encje

`Organization`, `OrganizationInvitation`, `EmailVerificationToken`. Unikalność
Tax-ID wymuszana jest na poziomie DB; duplikaty rejestracji zwracają
`409 ORGANIZATION_TAX_ID_EXISTS`.

## Emitowane eventy

`organization.registered.v1`, `organization.verified.v1`,
`organization.suspended.v1`, `organization.member_invited.v1`,
`organization.member_role_changed.v1`.

## Punkty rozszerzenia

- **Verification dispatch** — `email-verification-service.ts` wystawia
  wymienialny interfejs mailera; zamień dev-mode console mailer na prawdziwy
  driver SMTP/SendGrid w produkcyjnym composition.
- **Last-admin guard** — zakodowany w `role-service.ts#changeRole` i
  `invitation-service.ts#revoke`; dodawaj tu nowe miejsca wywołań „musi zostać
  co najmniej jeden admin”.

## Feature 026 — Commercial party + moderation

Feature 026 awansuje Organization do first-class commercial party. Specyfikacja
jest w `specs/026-organizations/spec.md`. Ta sekcja opisuje powierzchnię runtime;
kolejność migracji udokumentowana jest w `data-model.md` tej specyfikacji.

### Status cyklu życia (`pending_verification` → `active` → `blocked` / `rejected`)

Każda nowo zarejestrowana Organization startuje w `pending_verification`.
Platform-wide setting `organizations.moderation.mode` (`manual` /
`auto`) kontroluje, czy admin musi ręcznie zatwierdzić przed transakcją.
Gdy status jest inny niż `active`, platforma odmawia składania Order, wysyłki RFQ
i dodawania linii do koszyka z HTTP 423.

Legacy status `suspended` przemianowano na `blocked` migracją 047
z breadcrumb audytu na każdym przepisanym wierszu.

Endpointy admin:

| Verb + Path | Cel |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/approve` | Przejście `pending_verification` → `active` |
| `POST /api/v1/admin/organizations/:id/reject` | Przejście `pending_verification` → `rejected` (terminal) |
| `POST /api/v1/admin/organizations/:id/block` | Przejście `active` → `blocked` (dźwignia operatora) |
| `POST /api/v1/admin/organizations/:id/unblock` | Przejście `blocked` → `active` |

Każde body niesie `expectedVersion: number` (token optimistic-lock z kolumny
`organizations.version`) i jest owinięte w
`em.transactional`. Nieaktualne `expectedVersion` zwraca `409
VERSION_CONFLICT` z `currentVersion` w body. Naruszenie guard statusu (np.
approve już active org) zwraca `422
VALIDATION_FAILED`.

Bramka po stronie klienta: storefront dostaje zlokalizowany komunikat
„dlaczego nie możesz transakcjonować” przez pola
`organization.canTransact` + `organization.moderationMessage` z `GET /api/v1/me`.
Strony cart i checkout renderują `<OrganizationModerationBanner>`
nad formularzem, gdy `canTransact === false`.

### Powiadomienia admin

Mały moduł `admin_notifications` posiada powierzchnię dzwonka. Przy każdej nowej
rejestracji Organization `OrgRegistrationNotifier` zapisuje jedno broadcast
notification (`audience='all_admins'`,
`kind='organization.registered'`) i wysyła jeden e-mail per wpis w ustawieniu
`organizations.notifications.new_registration_recipients`.
Dzwonek odpytuje co 30 s przez
`GET /api/v1/admin/notifications`.

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/notifications` | Stronicowany feed, per-admin `isRead` resolution |
| `POST /api/v1/admin/notifications/:id/read` | Oznaczenie jednego wpisu jako read |
| `POST /api/v1/admin/notifications/mark-all-read` | Oznaczenie wszystkich widocznych jako read |

### Per-organization commercial scoping (US4)

Trzy allow-list bridges kontrolują, czego Organization może użyć przy
checkout:

- `organization_payment_methods` (pivot: `(organization_id, payment_method_id)`)
- `organization_delivery_methods` (pivot: `(organization_id, delivery_method_id)`)
- `organization_warehouses` (pivot: `(organization_id, warehouse_id)`)

**Pusta lista ⇒ obowiązują domyślne platformy.** Niepusta filtruje storefront
`GET /api/v1/payment-methods`, `GET /api/v1/delivery-methods`
oraz endpointy stock inventory przecięte z przypisaniem Organization
wywołującego.

Endpointy admin:

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/restrictions` | Odczyt trzech allow-list + `version` org |
| `PUT /api/v1/admin/organizations/:id/restrictions` | Atomowa zamiana wszystkich trzech |
| `PATCH .../restrictions/payment-methods` | Chirurgiczne `{ add?, remove? }` |
| `PATCH .../restrictions/delivery-methods` | To samo |
| `PATCH .../restrictions/warehouses` | To samo |

Storefront preflight:

| Verb + Path | Cel |
| --- | --- |
| `POST /api/v1/storefront/checkout/preflight` | Zwraca `{ canTransact, allowedPaymentMethodIds, allowedDeliveryMethodIds, assignedWarehouseIds }` albo 423, gdy org nie może transakcjonować |

### Applicable price lists + promotion targeting (US5)

`OrganizationEffectivePriceListsService.listApplicable(orgId)` ponownie używa
istniejącego `application-rule-evaluator` z modułu `price_lists`
do wyliczenia każdego Price List aktualnie stosowanego do Organization,
każdego z tablicą `reasons[]`
(`direct_organization_match` / `customer_group_match` /
`sales_channel_inheritance` / `segment_rule_match`). Udostępnione na
`GET /api/v1/admin/organizations/:id/applicable-price-lists` i
renderowane jako tabela read-only na stronie szczegółów Organization w admin.

Promotions: gdy promocja targetuje konkretną Organization
(`promotions.organization_id` jest ustawione), platforma stosuje regułę
tylko gdy Organization koszyka jest `active`. Sprawdzenie podpięte jest przez
opcjonalny argument konstruktora `resolveOrganizationStatus` w
`PromotionService`; composition.ts przekazuje raw SQL lookup.

### Sales-rep ownership (US6)

`organization_sales_rep_assignments` (pivot: `(organization_id,
admin_user_id)`) wiąże sales reps z organizations. Gdy rola admin
wywołującego to `sales_representative`, listy admin Orders i RFQ
filtrowane są do org, które rep posiada. Platform admins
widzą wszystko.

Trzy endpointy utrzymują relację, a ten moduł je posiada i
rejestruje:

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/sales-reps` | Lista rep przypisanych do organization. |
| `POST /api/v1/admin/organizations/:id/sales-reps` | Przypisanie rep. |
| `DELETE /api/v1/admin/organizations/:id/sales-reps/:adminUserId` | Usunięcie przypisania. |

Są gated przez `organizations:assign-sales-rep`. Do 2026-08 były
rejestrowane przez moduł quote-requests i gated przez
`rfqs:handle`, co oznaczało, że wyłączenie quote requests usuwało też
możliwość przypisania sales representative — a kod gating ekranu znikał z
macierzy ról. Przypisanie rep kwalifikuje organization, więc należy tu, z kodem,
który ten moduł deklaruje. Jeden endpoint, który został po stronie quote-requests,
to odwrotne listowanie,
`GET /api/v1/admin/sales-reps/:adminUserId/organizations`:
raportuje, ile quote requests jest otwartych per organization — to fakt tamtego
modułu.

Inne moduły czytają relację przez
`organizationSalesRepScopePort` tego modułu,
nigdy przez bezpośrednie zapytanie do pivot.

### Walidacja VAT-ID / NIP (US7)

Dwa produkcyjne klienty HTTP implementują port `VatValidator`:

- `ViesClient` → `POST` na endpoint VIES REST
  (`/check-vat-number`). Timeout 5 s; pojedynczy abort przy błędzie sieci.
- `MinisterstwoFinansowClient` → `GET` na `wl-api.mf.gov.pl/api/search/nip/{nip}`.
  Throttle 10 rps in-process; 7-dniowy cache key na `(nip, today)` wbudowany
  w historię po stronie serwisu `OrganizationTaxIdValidation`
  (jeden wiersz per próba).

`OrganizationTaxIdValidationService` auto-wybiera provider per
prefix tax-id (polski 10-cyfrowy → MF; inny prefix ISO-2 → VIES;
reszta → tylko format). Gdy `applyAutoFill=true` ORAZ wynik to
`validated`, `legalName` org jest aktualizowane i `version`
rośnie, aby następna edycja admin respektowała optimistic-lock.

Wszystkie adaptery degradują bezpiecznie przy awarii providera:
`outcome: 'deferred'`. Zapis org nigdy nie pada przez problem zewnętrzny.

| Verb + Path | Cel |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/vat-validations` | Jedna próba walidacji (`providerHint`, `applyAutoFill`) |
| `GET /api/v1/admin/organizations/:id/vat-validations` | Lista historii, najnowsze pierwsze |

### Picker primitive + wyszukiwanie bez diakrytyków (US8)

Panel admin dostarcza wielokrotnego użytku `<OrganizationPicker>` (single-select)
i `<OrganizationPickerMulti>` (multi-select) na istniejącym
`<Combobox>`. Korzystają z `GET /api/v1/admin/organizations?q=`, gdzie
parametr `q` jest bez diakrytyków: zapytanie `lodz` znajduje
„Bauhaus Łódź” przez zdenormalizowaną kolumnę `name_search` wypełnianą
hookami `@BeforeCreate` / `@BeforeUpdate` encji Organization.
`normalizeOrganizationName` to fold plus polityka whitespace, której wymaga
kolumna. Sam fold to `foldDiacritics`
(`packages/contracts/src/text-normalization.ts`), współdzielony z panelem admin
od issue #240: dekompozycja NFD, strip combining marks, potem jawna tabela dla
precomposed Latin letters, których NFD nie rozdziela (`ł`/`Ł`, `ø`/`Ø`, `đ`/`Đ`, `ð`/`Ð`, `þ`/`Þ`, `ß`, `æ`,
`œ`). Zmiana tej tabeli składa nowe wiersze inaczej niż stare,
więc to migracja `name_search`, nie edycja.

### Nowe ustawienia (zadeklarowane w manifeście)

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `organizations.moderation.mode` | `string` enum | `'manual'` | `manual` ⇒ pending_verification; `auto` ⇒ active przy rejestracji |
| `organizations.notifications.new_registration_recipients` | `json` array | `[]` | Odbiorcy e-mail powiadomień o nowej Organization |

### Migracje

- `047_organizations_consolidation.ts` — dodaje `legal_name`, kolumny walidacji VAT,
  kolumny audytu blocked / rejected / approved, optimistic-lock `version`,
  zdenormalizowaną kolumnę `name_search`, trzy allow-list bridges,
  tabelę historii walidacji, indeks B-Tree `organizations_name_search_idx`
  i mapuje każdy wiersz `suspended` na `blocked`.
- `048_admin_notifications_init.ts` — dodaje tabelę `admin_notifications`
  + bridge per-admin `admin_notification_reads`.
- `049_customer_accounts_organization_optional.ts` — poluzowało
  `customer_accounts.organization_id` do nullable dla kont guest-style
  (FR-010 / FR-012). **Ten design jest martwy**: feature 051 go zastąpił, a D-178
  ponownie zaostrzył kolumnę — zobacz
  `customer_accounts`' `20260825T141659_customer_accounts_organization_required`.
- `089_personal_organizations.ts` — dodaje `organizations.is_personal`
  i backfill personal organization dla każdego wcześniejszego konta bez org
  (zobacz „Personal organizations” poniżej).

### Personal organizations (B2C) — feature 051

Organization to jedyny koncept tenant platformy. Klient B2C /
indywidualny **nie** jest przypadkiem null-org: każda samodzielna rejestracja
klienta provisionuje single-member **personal
organization** (`is_personal = true`). Od D-178 organization i
konto zapisywane są **w jednej transakcji**, przez moduł właściciela wiersza
konta, na obu ścieżkach tworzenia — self-registration i federated sign-in.
To oznacza:

- **Transakcje bez zmian.** `organization_id` jest `NOT NULL` od D-178,
  więc ordering, RFQ, credit, invoices i adresy nie potrzebują ścieżki null-org — a
  kolumna, nie guard, odmawia: MikroORM stosuje tenant filter do
  `SELECT` / `UPDATE` / `DELETE`, nie do `INSERT`.
- **Izolacja strukturalna.** Tenant guard z feature 050 izoluje każdą
  personal org jako własnego tenant — dwóch klientów B2C nigdy nie widzi
  swoich danych, bez specjalnego null-org case.
- **Domyślne dla indywidualnych.** `status = active`, `vat_status = vat_exempt`,
  `name` z imienia klienta (fallback na local-part e-maila),
  oraz syntetyczny 32-hex `tax_id` z id konta (kolumna
  globalnie `UNIQUE`; osoba fizyczna nie ma firmowego tax id).
- **Niewidoczne w admin B2B.** Personal org domyślnie wykluczone z
  listy/pickerów admin, nie mogą dostać sales rep i nie wchodzą
  w kolejkę moderacji (tworzone jako `active`). Lista admin org
  akceptuje `?includePersonal=true`, aby je pokazać w razie potrzeby.
- **Gate per channel.** Samodzielna (B2C) rejestracja kontrolowana per
  sales channel ustawieniem `customers.allow_registration_without_organization`;
  kanał tylko B2B odmawia rejestracji i nic nie provisionuje. Nazwa ustawienia
  to relikt z feature 026 US2 — gate'uje rejestrację poza *firmową* organization,
  nie rejestrację bez organization.
- **Odłączenie członka od firmy przenosi go tutaj.** Admin
  `DELETE /api/v1/admin/customers/:id/organization` kiedyś pisał
  `organization_id = NULL`; od D-178 provisionuje (lub odnajduje)
  personal organization klienta i przenosi go tam, zachowując
  audit verb `customer_account.organization_unassigned`.

Firmowe (B2B) organizations pozostają nietknięte — invariant single-member
(`assertMembershipAllowed`) odrzuca tylko dodanie drugiego członka do
personal org.

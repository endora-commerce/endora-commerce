---
title: customers
description: Cykl życia Klienta nad `customer_accounts` — company i personal Organizations, przypisanie sales-rep i powierzchnia admin
---

# `customers`

Logika biznesowa cyklu życia Klienta (Klienci) na warstwie modułu danych
`customer_accounts`. **Każdy klient należy do Organization** —
firmowej dla B2B, single-member *personal organization* dla osoby fizycznej
a `customer_accounts.organization_id` jest
`NOT NULL`. „Standalone” w całym tym dokumencie oznacza *poza firmową
organization*, nigdy *bez organization*: taki klient jest własnym tenantem, a
funkcje organization-scoped, które firma oferuje (wspólne adresy, zaproszenia,
limit kredytowy, przypisanie sales-rep), są po prostu nieobecne, zamiast być
wyłączane specjalnym przypadkiem.

## Możliwości

**Storefront (self-service)**

- Rejestracja standalone, gated przez ustawienie
  `customers.allow_registration_without_organization`. Po sukcesie konto i jego
  personal organization zapisywane są w jednej transakcji, a nowe konto loguje
  się automatycznie.
- Osobista książka adresowa (billing/delivery), jeden domyślny per rodzaj, plus
  możliwość wyboru wspólnych adresów Organization (klienci powiązani z org).
- Domyślna metoda płatności, dostawy i domyślne adresy.
- Zmiana hasła; historia własnych zamówień i quote requests tylko do odczytu.

**Admin (nadzór)**

- Lista klientów (wyszukiwanie + filtry status/organization/group) i widok
  szczegółów z datą utworzenia, grupą klienta, organization, statusem blocked i
  ostatnim logowaniem.
- Block / unblock i soft-delete / restore, z autorytetem opartym o rolę: Platform
  Administrator może działać na każdym; w przeciwnym razie uprawnionym
  sprzedawcą jest ten dziedziczony z Organization klienta. Personal organization
  nigdy nie ma przypisania sales-rep, więc fallback unassigned-organization
  pozostawia standalone klienta otwartego dla dowolnego sprzedawcy. Guard
  org-owner depletion odmawia block/delete ostatniego organization administrator.
- Impersonation; audytowane jako `impersonation.start` / `impersonation.end`.
- Reset hasła z poziomu admin (e-mail z linkiem set-password).
- Walidacja NIP/VAT (VIES / port Biała lista).
- Przypisanie Organization i detach-from-organization, które przenosi klienta do
  własnej personal organization zamiast zostawiać go bez organization.
  Bezpośrednie przypisanie customer-group (nadpisuje grupę Organization przy
  rozwiązywaniu pricing i promotions).
- Panele orders, quote-requests i (bieżące + abandoned) carts tylko do odczytu.
- Widok „online customers” oparty o ostatnią aktywność sesji.

## Usuwanie i anonimizacja

Usunięcie to soft-disable: logowanie jest odmawiane, konto ukryte, sesje
unieważnione, a orders, quote requests i historia audytu zachowane. W
konfigurowalnym oknie retencji (`customers.deletion_retention_days`,
default 365) uprawniony actor może przywrócić konto. Po oknie sweep
anonimizacji (`AnonymizationSweepWorker`) nieodwracalnie czyści dane osobowe,
a restore nie jest już możliwy.

## Publiczne API

Trasy admin są gated przez `customers:read` (odczyty), `customers:manage`
(mutacje) i `customers:impersonate` (impersonation).

| Verb + Path | Audience | Cel |
| --- | --- | --- |
| `POST /api/v1/customers/register` | anon | Rejestracja standalone (setting-gated) |
| `GET /api/v1/me/customer` | customer | Własny profil |
| `POST /api/v1/me/customer/change-password` | customer | Zmiana hasła |
| `GET /api/v1/me/customer/addresses` | customer | Adresy osobiste + współdzielone z org |
| `POST/PATCH/DELETE /api/v1/me/customer/addresses[/:id]` | customer | Zarządzanie adresami osobistymi |
| `PUT /api/v1/me/customer/addresses/:id/default` | customer | Ustawienie domyślnego adresu |
| `GET/PUT /api/v1/me/customer/defaults` | customer | Domyślna metoda płatności/dostawy + adresy |
| `GET /api/v1/me/customer/orders` | customer | Własna historia zamówień |
| `GET /api/v1/me/customer/quote-requests` | customer | Własna historia RFQ |
| `GET /api/v1/admin/customers` | admin | Lista (authority-scoped) |
| `GET /api/v1/admin/customers/:id` | admin | Szczegóły |
| `POST /api/v1/admin/customers/:id/block` · `/unblock` | admin | Block / unblock |
| `DELETE /api/v1/admin/customers/:id` · `POST .../restore` | admin | Soft-delete / restore |
| `POST /api/v1/admin/customers/:id/impersonate` | admin | Start impersonation |
| `POST /api/v1/admin/customers/:id/password-reset` | admin | E-mail z linkiem set-password |
| `POST/DELETE /api/v1/admin/customers/:id/organization` | admin | Assign / unassign organization |
| `PUT /api/v1/admin/customers/:id/customer-group` | admin | Set / clear customer group |
| `GET/POST/PATCH/DELETE /api/v1/admin/customers/:id/addresses[/:addressId]` | admin | Zarządzanie adresami |
| `POST /api/v1/admin/customers/:id/vat-validate` | admin | Walidacja numeru NIP/VAT |
| `GET /api/v1/admin/customers/:id/orders` · `/quote-requests` · `/carts` | admin | Panele historii tylko do odczytu |
| `GET /api/v1/admin/customers/online` | admin | Aktualnie online klienci |

## Ustawienia

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `customers.allow_registration_without_organization` | boolean | `false` | Gate rejestracji standalone |
| `customers.deletion_retention_days` | number | `365` | Okno restore przed trwałą anonimizacją |
| `customers.presence_freshness_minutes` | number | `10` | Próg „online” |

## Schema

- `060_customer_accounts_lifecycle` — dodaje `customer_group_id`, stan block
  (`blocked_at`, `block_reason`, `block_source`, `blocked_by_*`) oraz stan
  deletion/anonymization (`deletion_requested_by_admin_user_id`,
  `anonymized_at`) do `customer_accounts`.
- `061_customer_addresses_init` — tabela `customer_addresses` (jeden default
  per `(customer, kind)`).

Domyślne preferencje płatności/dostawy używają ponownie tabeli
`quick_order_default_preferences`; nie wprowadza się nowej tabeli.

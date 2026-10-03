---
title: customers
description: Cykl życia klienta na bazie `customer_accounts` — organizacje firmowe i prywatne, przypisanie handlowca i obsługa klientów w panelu administracyjnym
---

# `customers`

Logika biznesowa cyklu życia klienta, zbudowana na module danych `customer_accounts`. **Każdy klient
należy do organizacji** — firmowej w przypadku B2B albo jednoosobowej *organizacji prywatnej* w
przypadku osoby fizycznej — a `customer_accounts.organization_id` ma ograniczenie `NOT NULL`.
„Samodzielny” oznacza w tym dokumencie *poza organizacją firmową*, a nigdy *bez organizacji*: taki
klient jest osobnym tenantem, a funkcje związane z organizacją, które oferuje firma (wspólne adresy,
zaproszenia, limit kredytowy, przypisanie handlowca), po prostu w jego przypadku nie występują,
zamiast być wyłączane jako przypadek szczególny.

## Możliwości

**Storefront (samoobsługa)**

- Samodzielna rejestracja, dostępna zależnie od ustawienia
  `customers.allow_registration_without_organization`. Po udanej rejestracji konto i jego organizacja
  prywatna są zapisywane w jednej transakcji, a nowe konto jest automatycznie logowane.
- Prywatna książka adresowa (adresy do faktury i dostawy), jeden adres domyślny każdego rodzaju, oraz
  możliwość wyboru wspólnych adresów organizacji (dla klientów należących do organizacji firmowej).
- Domyślna metoda płatności, metoda dostawy i domyślne adresy.
- Zmiana hasła; historia własnych zamówień i zapytań ofertowych tylko do odczytu.

**Panel administracyjny (nadzór)**

- Lista klientów (wyszukiwanie oraz filtry statusu, organizacji i grupy) i widok szczegółów z datą
  utworzenia, grupą klientów, organizacją, stanem blokady i ostatnim logowaniem.
- Blokowanie i odblokowanie oraz usunięcie miękkie i przywrócenie, z uprawnieniami zależnymi od roli:
  administrator platformy może działać na każdym kliencie; poza nim uprawniony jest handlowiec
  przypisany do organizacji klienta. Organizacja prywatna nigdy nie ma przypisanego handlowca, więc
  reguła dla nieprzypisanych organizacji sprawia, że samodzielnym klientem może zająć się dowolny
  handlowiec. Zabezpieczenie odmawia zablokowania lub usunięcia ostatniego administratora organizacji.
- Logowanie jako klient; audytowane jako `impersonation.start` / `impersonation.end`.
- Reset hasła z poziomu panelu (e-mail z linkiem do ustawienia hasła).
- Walidacja NIP/VAT (VIES, port Białej listy).
- Przypisanie do organizacji i odłączenie od organizacji, które przenosi klienta do jego własnej
  organizacji prywatnej, zamiast zostawiać go bez organizacji. Bezpośrednie przypisanie grupy
  klientów (zastępuje grupę organizacji przy wyznaczaniu cen i promocji).
- Panele zamówień, zapytań ofertowych i koszyków (bieżących i porzuconych), tylko do odczytu.
- Widok „klienci online” oparty na ostatniej aktywności sesji.

## Usuwanie i anonimizacja

Usunięcie to miękkie wyłączenie konta: logowanie jest odrzucane, konto ukryte, sesje unieważnione, a
zamówienia, zapytania ofertowe i historia audytu zachowane. W konfigurowalnym okresie
(`customers.deletion_retention_days`, domyślnie 365 dni) uprawniona osoba może przywrócić konto. Po
jego upływie zadanie anonimizacji (`AnonymizationSweepWorker`) nieodwracalnie usuwa dane osobowe i
przywrócenie nie jest już możliwe.

## API publiczne

Trasy administracyjne są chronione przez `customers:read` (odczyt), `customers:manage` (zmiany) i
`customers:impersonate` (logowanie jako klient).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/customers/register` | anonimowy | Samodzielna rejestracja (zależna od ustawienia) |
| `GET /api/v1/me/customer` | klient | Własny profil |
| `POST /api/v1/me/customer/change-password` | klient | Zmiana hasła |
| `GET /api/v1/me/customer/addresses` | klient | Adresy prywatne i wspólne adresy organizacji |
| `POST/PATCH/DELETE /api/v1/me/customer/addresses[/:id]` | klient | Zarządzanie adresami prywatnymi |
| `PUT /api/v1/me/customer/addresses/:id/default` | klient | Ustawienie adresu domyślnego |
| `GET/PUT /api/v1/me/customer/defaults` | klient | Domyślna metoda płatności i dostawy oraz adresy |
| `GET /api/v1/me/customer/orders` | klient | Własna historia zamówień |
| `GET /api/v1/me/customer/quote-requests` | klient | Własna historia zapytań ofertowych |
| `GET /api/v1/admin/customers` | administrator | Lista (ograniczona uprawnieniami) |
| `GET /api/v1/admin/customers/:id` | administrator | Szczegóły |
| `POST /api/v1/admin/customers/:id/block` · `/unblock` | administrator | Blokowanie / odblokowanie |
| `DELETE /api/v1/admin/customers/:id` · `POST .../restore` | administrator | Usunięcie miękkie / przywrócenie |
| `POST /api/v1/admin/customers/:id/impersonate` | administrator | Rozpoczęcie logowania jako klient |
| `POST /api/v1/admin/customers/:id/password-reset` | administrator | E-mail z linkiem do ustawienia hasła |
| `POST/DELETE /api/v1/admin/customers/:id/organization` | administrator | Przypisanie do organizacji / odłączenie |
| `PUT /api/v1/admin/customers/:id/customer-group` | administrator | Ustawienie / usunięcie grupy klientów |
| `GET/POST/PATCH/DELETE /api/v1/admin/customers/:id/addresses[/:addressId]` | administrator | Zarządzanie adresami |
| `POST /api/v1/admin/customers/:id/vat-validate` | administrator | Walidacja numeru NIP/VAT |
| `GET /api/v1/admin/customers/:id/orders` · `/quote-requests` · `/carts` | administrator | Panele historii tylko do odczytu |
| `GET /api/v1/admin/customers/online` | administrator | Klienci obecnie online |

## Ustawienia

| Kod | Typ | Wartość domyślna | Przeznaczenie |
| --- | --- | --- | --- |
| `customers.allow_registration_without_organization` | boolean | `false` | Włącza samodzielną rejestrację |
| `customers.deletion_retention_days` | number | `365` | Okres, w którym można przywrócić konto przed trwałą anonimizacją |
| `customers.presence_freshness_minutes` | number | `10` | Próg uznania klienta za „online” |

## Schemat

- `20260611T140403_customer_accounts_lifecycle.ts` (należy do `customer_accounts`) — dodaje do `customer_accounts` kolumny `customer_group_id`,
  stan blokady (`blocked_at`, `block_reason`, `block_source`, `blocked_by_*`) oraz stan usunięcia i
  anonimizacji (`deletion_requested_by_admin_user_id`, `anonymized_at`).
- `20260611T140404_customers_customer_addresses_init.ts` — tabela `customer_addresses` (jeden adres domyślny dla każdej pary
  `(customer, kind)`).

Domyślne preferencje płatności i dostawy korzystają z istniejącej tabeli
`quick_order_default_preferences`; nowa tabela nie jest tworzona.

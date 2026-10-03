---
title: credit_limits
description: Przyznawanie limitów kredytowych i atomowa rezerwacja
---

# `credit_limits`

Metoda płatności „limit kredytowy”. Administratorzy przyznają limit organizacji, a klienci
korzystają z niego przy składaniu zamówienia. Rezerwacje są atomowe i zwalniane idempotentnie po
opłaceniu faktury albo anulowaniu zamówienia.

## API publiczne

Wszystkie trasy administracyjne wymagają uprawnienia `credit_limits:manage`.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/me/credit-limit` | klient | Podgląd przyznanego limitu i kwoty obecnie zarezerwowanej (404 `CREDIT_LIMIT_NOT_GRANTED`, gdy limitu nie ma) |
| `GET /api/v1/admin/credit-limits` | administrator | Zestawienie wszystkich przyznanych limitów z aktywnymi rezerwacjami |
| `GET /api/v1/admin/organizations/:id/credit-limit` | administrator | Limit jednej organizacji z rezerwacjami |
| `POST /api/v1/admin/organizations/:id/credit-limit` | administrator | Przyznanie początkowego limitu |
| `PATCH /api/v1/admin/organizations/:id/credit-limit` | administrator | Korekta kwoty (odrzuca kwotę niższą niż aktywne rezerwacje, chyba że ustawiono `allowOverAllocation`) |

W storefroncie profil konta i strona checkoutu wyświetlają `CreditLimitWidget` (limit przyznany,
dostępny i rozbicie rezerwacji), gdy limit istnieje; metody płatności typu `credit_limit` są
ukrywane w checkoucie, gdy limit nie został przyznany albo suma koszyka przekracza dostępny kredyt.

## Współbieżność

`CreditLimitService.reserve()` wykonuje `SELECT … FOR UPDATE` na wierszu `credit_limits`, a
następnie wstawia rezerwację. Dwa równoczesne zamówienia, które łącznie przekroczyłyby limit, są
wykonywane po kolei; jedno się udaje, a drugie dostaje `409 LIMIT_INSUFFICIENT`. Zobacz
`backend/test/contract/credit_limits/concurrent-race.test.ts`.

## Encje

`CreditLimit`, `CreditLimitReservation` (status: `active | released`). Indeks na
`(credit_limit_id, status)` sprawia, że zapytanie o dostępne saldo jest szybkie.

## Emitowane zdarzenia

`credit_limit.granted.v1`, `credit_limit.adjusted.v1`, `credit_limit.reservation_released.v1`.

## Punkty rozszerzenia

- **Powody zwolnienia** — `releaseByOrder(reason)` przyjmuje dziś `'invoice_paid'` i
  `'order_cancelled'`. Nowe powody (np. `'manual_override'`) dodaje się, rozszerzając wyliczenie i
  podłączając wywołanie.

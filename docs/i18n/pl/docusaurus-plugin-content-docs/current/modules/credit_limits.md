---
title: credit_limits
description: Przyznanie limitu kredytowego + atomowa rezerwacja
---

# `credit_limits`

Metoda płatności Credit Limit. Administratorzy przyznają limit per Organization;
Klienci konsumują go przy checkout. Rezerwacje są atomowe i idempotentnie
zwalniane przy opłaceniu faktury lub anulowaniu zamówienia.

## Publiczne API

Wszystkie trasy admin są chronione uprawnieniem `credit_limits:manage`.

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/me/credit-limit` | customer | Podgląd przyznanego limitu + aktualnie zarezerwowanego (404 `CREDIT_LIMIT_NOT_GRANTED`, gdy brak) |
| `GET /api/v1/admin/credit-limits` | admin | Rejestr wszystkich przyznanych limitów z aktywnymi rezerwacjami |
| `GET /api/v1/admin/organizations/:id/credit-limit` | admin | Limit jednej organization + rezerwacje |
| `POST /api/v1/admin/organizations/:id/credit-limit` | admin | Przyznanie początkowego limitu |
| `PATCH /api/v1/admin/organizations/:id/credit-limit` | admin | Korekta kwoty (odrzuca poniżej aktywnych rezerwacji, chyba że `allowOverAllocation`) |

UX storefront: profil konta i strona Checkout renderują
`CreditLimitWidget` (przyznany / dostępny / rozbicie rezerwacji), gdy
limit istnieje; metody płatności typu `credit_limit` są filtrowane z
Checkout, gdy limit nie jest przyznany lub suma koszyka przekracza
dostępny kredyt.

## Model współbieżności

`CreditLimitService.reserve()` otwiera `SELECT … FOR UPDATE` na wierszu
`credit_limits`, następnie wstawia rezerwację. Dwa równoczesne zamówienia,
które łącznie przekroczyłyby limit, są serializowane; jedno kończy się sukcesem, a
drugie otrzymuje `409 LIMIT_INSUFFICIENT`. Zobacz
`backend/test/contract/credit_limits/concurrent-race.test.ts`.

## Encje

`CreditLimit`, `CreditLimitReservation` (status: `active | released`).
Indeks na `(credit_limit_id, status)` utrzymuje szybkie zapytanie o dostępne saldo.

## Emitowane zdarzenia

`credit_limit.granted.v1`, `credit_limit.adjusted.v1`,
`credit_limit.reservation_released.v1`.

## Punkty rozszerzenia

- **Powody zwolnienia** — `releaseByOrder(reason)` akceptuje dziś
  `'invoice_paid'` i `'order_cancelled'`. Nowe powody (np.
  `'manual_override'`) dodaje się przez rozszerzenie enumu i podłączenie
  wywołującego.

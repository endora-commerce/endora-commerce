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

`credit_limit.granted.v1`, `credit_limit.adjusted.v1`. Są to zdarzenia działającej w procesie szyny
zdarzeń. `credit_limit.adjusted.v1` jest też oferowane webhookom wychodzącym (następna sekcja);
`credit_limit.granted.v1` nie jest. Zwolnienie rezerwacji nie emituje zdarzenia.

## Zdarzenie oferowane webhookom wychodzącym

Moduł wnosi jeden typ zdarzenia do rejestru `webhookEventRegistry` modułu `webhooks`, więc
subskrypcja webhooka może go wskazać, dopóki oba moduły są włączone. Treść zdarzenia jest wysyłana
w całości; ścisły schemat to `CreditLimitAdjustedEventV1Schema` w `@endora-commerce/contracts`.

| Zdarzenie | Kiedy jest wysyłane | Treść, poza `eventId` i `occurredAt` |
| --- | --- | --- |
| `credit_limit.adjusted.v1` | Administrator zmienia limit organizacji albo na limit zostaje zaliczony rozliczony zwrot. | `organizationId` (UUID) — organizacja, która ma limit; `amount` (liczba) — przyznany limit **po** zmianie. |

- **`amount` to nowa suma**, a nie różnica, w walucie limitu. W treści nie ma waluty ani kwot
  zarezerwowanej i dostępnej, podanego powodu ani informacji, kto dokonał zmiany.
- **Dane jednej organizacji.** Subskrypcja obejmująca całą platformę dostaje zdarzenia wszystkich
  organizacji. Subskrypcja powiązana z organizacją dostaje tylko zdarzenia, których
  `organizationId` wskazuje tę organizację — nigdy innej. Organizacja, która *dziedziczy* limit
  organizacji nadrzędnej, nie jest wskazywana: zdarzenie wskazuje organizację, której limit
  przyznano.
- **Po zatwierdzeniu zapisu.** Zdarzenie jest wysyłane dla zmiany, która została zatwierdzona.
  Zmiana odrzucona (poniżej aktywnych rezerwacji) albo wycofana nie wysyła niczego, a zwrot już
  raz zaliczony nie jest ogłaszany po raz drugi.
- **Gdy moduł jest wyłączony**, typ nie jest oferowany, a nowa subskrypcja na niego jest
  odrzucana; zapisane subskrypcje zostają i nic nie dostają, dopóki moduł nie zostanie włączony
  ponownie.

## Punkty rozszerzenia

- **Powody zwolnienia** — `releaseByOrder(reason)` przyjmuje dziś `'invoice_paid'` i
  `'order_cancelled'`. Nowe powody (np. `'manual_override'`) dodaje się, rozszerzając wyliczenie i
  podłączając wywołanie.

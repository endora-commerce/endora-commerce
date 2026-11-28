---
title: Limity kredytowe
description: Przyznawanie limitów kredytowych i atomowa rezerwacja
---

# Limity kredytowe (`credit_limits`)

Metoda płatności „limit kredytowy”. Administratorzy przyznają limit organizacji, a klienci
korzystają z niego przy składaniu zamówienia. Rezerwacje są atomowe i zwalniane idempotentnie po
opłaceniu faktury albo anulowaniu zamówienia.

## API publiczne

Wszystkie trasy administracyjne wymagają uprawnienia `credit_limits:manage`.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/me/credit-limit` | klient | Podgląd przyznanego limitu i kwoty obecnie zarezerwowanej (404 `CREDIT_LIMIT_NOT_GRANTED`, gdy limitu nie ma) |
| `GET /api/v1/admin/credit-limits?page=&pageSize=` | administrator | Jedna strona przyznanych limitów z aktywnymi rezerwacjami, od najnowszego przyznania, z `meta: { page, pageSize, total }`; bez `pageSize` całe zestawienie (issue #1664) |
| `GET /api/v1/admin/organizations/:id/credit-limit` | administrator | Limit jednej organizacji z rezerwacjami |
| `POST /api/v1/admin/organizations/:id/credit-limit` | administrator | Przyznanie początkowego limitu |
| `PATCH /api/v1/admin/organizations/:id/credit-limit` | administrator | Korekta kwoty (odrzuca kwotę niższą niż aktywne rezerwacje, chyba że ustawiono `allowOverAllocation`) |

W storefroncie profil konta i strona checkoutu wyświetlają `CreditLimitWidget` (limit przyznany,
dostępny i rozbicie rezerwacji), gdy limit istnieje; metody płatności typu `credit_limit` są
ukrywane w checkoucie, gdy limit nie został przyznany albo suma koszyka przekracza dostępny kredyt.

W panelu ekran **Limity kredytowe** zawiera wszystkie przyznane limity; *Przyznaj limit
kredytowy* oraz *Koryguj limit* w wierszu otwierają jedno okno dialogowe. Zakładka **Handel** na
ekranie organizacji zawiera podsumowanie *Limit kredytowy* tylko do odczytu — kwotę przyznaną,
zarezerwowaną i dostępną oraz liczbę aktywnych rezerwacji albo informację, że limitu nie
przyznano — z odnośnikiem *Koryguj limit* / *Przyznaj limit kredytowy*, który otwiera to okno dla
tej organizacji (`/credit-limits?organizationId=<id>`). Podsumowanie widzi tylko osoba
z uprawnieniem `credit_limits:manage`, a gdy moduł jest wyłączony, nie ma go wcale (issue #1544).

Które rezerwacje widzi klient: limit jest wspólny, więc kwota przyznana, kwota dostępna
i `activeReservationCount` to zawsze wartości dla całej organizacji. Lista `activeReservations`
zawiera tylko rezerwacje zamówień, które klient może odczytać: jego własnych albo wszystkich
zamówień organizacji, gdy jego rola w organizacji ma uprawnienie `orders.view_organization`
(rola Administrator ma je domyślnie). Trasy administracyjne zawsze pokazują wszystkie rezerwacje.

Każda wymieniona rezerwacja ma `orderBusinessId`, numer zamówienia widoczny dla klienta (`null`
dla zamówienia, którego moduł `orders` nie zwrócił), zarówno w trasie klienta, jak i w trzech
widokach administracyjnych. Ekran limitów kredytowych w panelu pokazuje ten numer w tabeli
rezerwacji, z odnośnikiem do zamówienia.

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

## Zamówienia opłacane przez płatnika powiązanego {#orders-paid-by-a-related-payer}

Zamówienie złożone z płatnikiem powiązanym (moduł *Related payers*) rezerwuje kredyt **płatnika**,
albo właściciela jego kredytu, gdy płatnik korzysta ze wspólnej puli organizacji nadrzędnej; kredyt
kupującego pozostaje nietknięty. `credit_limits` publikuje `creditAvailabilityReadPort`, przez który
checkout odczytuje dostępny kredyt płatnika, żeby zdecydować, czy oferować metodę płatności w ramach
limitu kredytowego.

## W dzienniku audytu

Przyznanie, zmiana i zaliczenie limitu ze zwrotu to każde jeden wpis w dzienniku audytu całej
platformy (`credit_limit.grant`, `credit_limit.adjust`, `credit_limit.credit_from_return`),
zapisany dla organizacji. Dziennik audytu czyta każdy, kto ma `audit_log:read`, bez względu na
to, które organizacje widzi, dlatego wpis mówi, co się zmieniło — `changedFields: ['grantedAmount']`,
a przy zaliczeniu identyfikator sprawy zwrotu — i nie zawiera żadnej kwoty. Bieżący limit jest na
ekranie limitu kredytowego organizacji. Wpisy zapisane przed tą zmianą zachowują kwoty, z którymi
zostały zapisane.

## Punkty rozszerzenia

- **Powody zwolnienia** — `releaseByOrder(reason)` przyjmuje dziś `'invoice_paid'`,
  `'order_cancelled'` i `'admin_revocation'`. Nowe powody (np. `'manual_override'`) dodaje się, rozszerzając wyliczenie i
  podłączając wywołanie.

## Po scaleniu organizacji {#when-organizations-are-merged}

Organizacja, która zostaje, zachowuje własny limit kredytowy; jeśli go nie ma, przejmuje limit
duplikatu. Otwarte rezerwacje i zasilenia ze zwrotów przechodzą do jej zaangażowania, które może
przekroczyć limit: podgląd scalania o tym ostrzega, ale scalanie nie jest z tego powodu
odrzucane. Zobacz *Scalanie zduplikowanych organizacji* w dokumentacji modułu Organizacje.

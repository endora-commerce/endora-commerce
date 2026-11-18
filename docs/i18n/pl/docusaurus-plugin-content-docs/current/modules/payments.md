---
title: Płatności
description: Obsługa sterowników płatności i zdarzenia rozliczeń
---

# Płatności (`payments`)

Obsługa sterowników płatności i zdarzenia rozliczeń. Moduł jest właścicielem rekordu `Payment`
i czterech wbudowanych adapterów płatności (`src/backend/adapters/built-in-adapters.ts`), które
przekazuje do `paymentAdapterRegistry` modułu `payment_methods`; adaptery poszczególnych dostawców
znajdują się w osobnych modułach bramek płatności.

## Sterowniki

| Klucz adaptera | Zachowanie |
| --- | --- |
| `bank_transfer` | Zwraca `NextAction.kind='awaiting_transfer'` z referencją `ORDER-…`; rozliczenie następuje poza systemem, gdy operator oznaczy zamówienie jako opłacone |
| `pickup` | `NextAction.kind='none'` przy płatności przy odbiorze |
| `credit_limit` | `NextAction.kind='none'`; samą rezerwację wykonuje moduł `orders` (`order-service.ts#placeOrder()` wywołuje `CreditLimitService.reserve` modułu `credit_limits`) w transakcji składania zamówienia |
| `gateway` | Zaślepka zwracająca `NextAction.kind='none'`; moduł bramki płatności rejestruje własny adapter, który zwraca przekierowanie |

## API publiczne

Trzy trasy administracyjne, chronione własnymi kodami uprawnień modułu:

| Metoda i ścieżka | Uprawnienie | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/orders/:id/payments` | `payments:read` | Pełna historia płatności jednego zamówienia, łącznie z danymi od operatora płatności dla każdej próby |
| `POST /api/v1/admin/orders/:id/payments/retry` | `payments:write` | Otwiera kolejną próbę płatności (`Payment`) dla zamówienia |
| `POST /api/v1/payments/receive` | `payments:write` | Przyjęcie rozliczenia `receive_payment`: zgłasza, że płatność się udała albo nie |

Podział na dwa kody jest celowy. Odczyt historii płatności zamówienia to praca działu obsługi
klienta i finansów; otwarcie kolejnej próby i zgłoszenie rozliczenia to operacje na pieniądzach, a
organizacja operatora rozdziela te role. Dla przyjęcia rozliczenia nie ma trzeciego kodu, choć to
najbardziej ryzykowna z trzech tras, bo jest to trasa przejściowa, która zostanie zastąpiona
podpisanym uwierzytelnianiem webhooków od operatorów płatności — zobacz uzasadnienie w
`manifest.ts`.

Zanim `payments` zadeklarował własne kody, wszystkie trzy trasy chronione były przez
`catalog:read` i `catalog:write`, więc operator, który mógł edytować produkt, mógł też czytać dane
od operatora płatności dla każdej płatności i oznaczać dowolną płatność jako rozliczoną. **Po
aktualizacji rola, która odczytywała dane płatności dzięki `catalog:read`, musi jawnie dostać
`payments:read` na `/admin-roles`** — nie ma migracji, bo przyznanie `payments:read` każdemu, kto ma
`catalog:read`, odtworzyłoby dokładnie te nadmierne uprawnienia, które ta zmiana usuwa.

Treść żądania przyjęcia rozliczenia ogranicza `providerDetails` do płaskiej mapy wartości prostych
(`operatorProviderDetailsSchema`): kolumna jest zapisywana dosłownie i zwracana w całości, więc to,
co operator może w niej zapisać, ogranicza nasz schemat, a nie treść przesłana przez wywołującego.
Integracje bramek płatności budują te dane w kodzie i to ograniczenie ich nie dotyczy.

Poza tymi trasami zamówienia wywołują adaptery przez `order-service.ts#placeOrder()`, a
zmiany statusu płatności w panelu administracyjnym przechodzą przez
`/api/v1/admin/orders/:id/payment-status`, którego właścicielem jest `orders`.

Ponowienie płatności przez kupującego (`POST /api/v1/orders/:orderId/payments/retry`) to trasa
klienta i jest autoryzowane przez `requireCustomer`, a nie przez uprawnienie.

## Odmowy

Ponowienie albo rozliczenie, którego nie pozwala stan samej płatności, ma własny kod i zdanie po
angielsku i po polsku, czytane w języku operatora (przy ponowieniu przez kupującego — w języku
kupującego). Do zgłoszenia #630 były to odpowiedzi `409 VALIDATION_FAILED`; status się nie zmienił.

| Kod | Status | Kiedy | `details` |
| --- | --- | --- | --- |
| `PAYMENT_ALREADY_PAID` | `409` | ponowienie płatności opłaconego zamówienia (`code` `retry`) albo `POST /api/v1/payments/receive` z `outcome: "failure"` dla opłaconej płatności (`code` `mark_failed`; status nie jest obniżany) | `orderId`, `paymentId`, `status` |
| `PAYMENT_REFUNDED` | `409` | ponowienie płatności zwróconej w całości lub w części | `orderId`, `paymentId`, `status` |
| `PAYMENT_SETTLED_OUT_OF_BAND` | `409` | ponowienie płatności zamówienia rozliczanego poza bramką (`deferred`) | `orderId`, `paymentId` |

Ponowienie przez kupującego najpierw odpowiada z własnych sprawdzeń kodem `PAYMENT_NOT_DUE`,
`PAYMENT_ORDER_CLOSED` albo `PAYMENT_ADAPTER_UNAVAILABLE`; do trzech powyższych dochodzi tylko wtedy,
gdy ostatnia próba zmieniła się po tym, jak te sprawdzenia odczytały zamówienie.

## Gdy zamówienie odmawia zmiany

Status płatności zamówienia podlega grafowi przejść opisanemu przy module `orders` i rozliczenie
również go przestrzega. Gdy bramka zgłosi coś, na co bieżący status płatności zamówienia nie
pozwala — odrzucenie płatności zamówienia, które operator już oznaczył jako opłacone, powodzenie dla
zwróconego zamówienia, pełny zwrot zamówienia, które nigdy nie zostało opłacone — płatność i tak
zapisuje to, co zgłosiła bramka, a zamówienie zachowuje swój status płatności. Status metody na
wypadek powodzenia lub niepowodzenia nie jest wtedy stosowany, więc spóźnione odrzucenie nie
wstrzymuje opłaconego zamówienia. Odmowa trafia do logu z płatnością, zamówieniem i oboma statusami.
Pełny zwrot nieopłaconego zamówienia nadal wstrzymuje zamówienie do sprawdzenia przez operatora.

Zdarzenia `payment.received.v1` i `payment.failed.v1` są nadal emitowane, bo opisują płatność.
E-mail do kupującego o statusie płatności jest wysyłany tylko wtedy, gdy zgadza się z zamówieniem:
„opłacone”, gdy zamówienie jest opłacone, „nieudane”, gdy jest nieudane.

## Zwroty przez bramkę płatności

Bramka zgłasza każdy zwrot — wykonany w jej panelu albo przy rozliczeniu zwrotu towaru — przez swój
webhook, z łączną zwróconą kwotą, a płatność ją zapisuje. Kwota z więcej niż dwoma miejscami po
przecinku jest **odrzucana, a nie zaokrąglana**: zwrócona kwota i status płatności pozostają bez
zmian, odmowa trafia do logu z płatnością, zamówieniem, zgłoszoną kwotą i identyfikatorem zwrotu w
bramce, a płatność zostaje oznaczona do ręcznego sprawdzenia (`providerDetails.refundAnomaly` w
historii płatności). Webhook i tak zostaje potwierdzony, więc bramka nie wysyła go ponownie; operator
sprawdza zwrot w bramce i rozlicza go ręcznie.

## Emitowane zdarzenia

`payment.received.v1`, `payment.failed.v1`, `payment.refunded.v1`. Są to zdarzenia działającej w
procesie szyny zdarzeń; żadne z nich nie jest dostarczane do webhooków wychodzących.

## Punkty rozszerzenia

- **Nowa bramka płatności** — dostarcz moduł, który implementuje `PaymentAdapter` i przekazuje go
  do `paymentAdapterRegistry` w swoim hooku startowym, jak opisuje strona modułu `payment_methods`
  (*Jak zbudować własny moduł metody płatności*).
- **Ochrona przed nadużyciami i 3DS** — wstaw je przed wywołaniem startu płatności przez adapter, zanim
  zostanie zatwierdzona transakcja składania zamówienia.

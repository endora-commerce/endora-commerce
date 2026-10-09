---
title: payments
description: Obsługa sterowników płatności i zdarzenia rozliczeń
---

# `payments`

Obsługa sterowników płatności i zdarzenia rozliczeń. Moduł jest właścicielem portu sterownika
(`gateway-adapter-port.ts`) i wbudowanych sterowników; adaptery poszczególnych dostawców znajdują
się w osobnych modułach integracyjnych.

## Sterowniki

| Sterownik | Zachowanie |
| --- | --- |
| `bank-transfer-driver.ts` | Zwraca `NextAction.kind='awaiting_transfer'`; rozliczenie następuje poza systemem, gdy operator oznaczy zamówienie jako opłacone |
| `pickup-driver.ts` | `NextAction.kind='none'` przy płatności przy odbiorze |
| `credit-limit-driver.ts` | Wywołuje `CreditLimitService.reserve` w transakcji składania zamówienia |
| `gateway-adapter-port.ts` | Interfejs dla zewnętrznych bramek płatności; implementacje poszczególnych dostawców są poza rdzeniem |

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

Poza tymi trasami sterowniki są używane przez zamówienia, przez `order-service.ts#placeOrder()`, a
zmiany statusu płatności w panelu administracyjnym przechodzą przez
`/api/v1/admin/orders/:id/payment-status`, którego właścicielem jest `orders`.

Ponowienie płatności przez kupującego (`POST /api/v1/orders/:orderId/payments/retry`) to trasa
klienta i jest autoryzowane przez `requireCustomer`, a nie przez uprawnienie.

## Emitowane zdarzenia

`payment.received.v1`, `payment.failed.v1`, `payment.refunded.v1`. Są to zdarzenia działającej w
procesie szyny zdarzeń; żadne z nich nie jest dostarczane do webhooków wychodzących.

## Punkty rozszerzenia

- **Nowa bramka płatności** — zaimplementuj `gateway-adapter-port.ts`, zarejestruj sterownik w
  composition root i udostępnij konfigurację przez moduł `integrations`.
- **Ochrona przed nadużyciami i 3DS** — wstaw je przed wywołaniem `reserve` sterownika, zanim
  zostanie zatwierdzona transakcja składania zamówienia.

---
title: payments
description: Dispatch sterowników płatności + zdarzenia rozliczenia
---

# `payments`

Dispatch sterowników płatności + zdarzenia rozliczenia. Moduł posiada port
sterownika (`gateway-adapter-port.ts`) oraz konkretne sterowniki w drzewie;
adaptery per vendor żyją w dedykowanych modułach integracyjnych.

## Sterowniki

| Driver | Zachowanie |
| --- | --- |
| `bank-transfer-driver.ts` | Zwraca `NextAction.kind='awaiting_transfer'`; rozliczenie następuje poza systemem, gdy operator oznacza zamówienie jako opłacone |
| `pickup-driver.ts` | `NextAction.kind='none'` przy płatności przy odbiorze |
| `credit-limit-driver.ts` | Wywołuje `CreditLimitService.reserve` w transakcji składania zamówienia (US6) |
| `gateway-adapter-port.ts` | Interfejs stub dla zewnętrznych bramek; implementacje per vendor żyją poza rdzeniem |

## Publiczne API

Trzy trasy admina, chronione własnymi kodami uprawnień modułu:

| Verb + Path | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/orders/:id/payments` | `payments:read` | Pełna historia płatności jednego zamówienia, w tym payload providera każdej próby |
| `POST /api/v1/admin/orders/:id/payments/retry` | `payments:write` | Otwiera kolejną próbę `Payment` na zamówieniu |
| `POST /api/v1/payments/receive` | `payments:write` | Ingress rozliczenia `receive_payment`: deklaruje, że płatność się powiodła lub nie |

Para jest celowa. Odczyt historii płatności zamówienia to praca supportu i
finansów; otwarcie retry i deklaracja rozliczenia to operacje pieniężne,
a organizacja operatora rozdziela te dwie role. Nie ma trzeciego kodu dla
ingressu rozliczenia, mimo że to najbardziej niebezpieczna z trzech tras, bo
trasa jest przejściowa do momentu podpisanej ścieżki auth webhooków PSP — zobacz
uzasadnienie w `manifest.ts`.

Dopóki `payments` tego nie zadeklarował, wszystkie trzy trasy były chronione przez
`catalog:read` i `catalog:write`, więc operator, który mógł edytować produkt,
mógł też czytać payload providera każdej płatności i oznaczać dowolną płatność
jako rozliczoną. **Po aktualizacji: rola, która czytała dane płatności przez
`catalog:read`, musi dostać `payments:read` explicite na `/admin-roles`** — nie ma
migracji, bo nadanie `payments:read` każdemu posiadaczowi `catalog:read` odtworzyłoby
dokładnie nadmierne uprawnienie, które ta zmiana usuwa.

Ciało ingressu ogranicza `providerDetails` do płaskiej mapy skalarów
(`operatorProviderDetailsSchema`): kolumna jest persystowana verbatim i serwowana
w całości z powrotem, więc to, co operator może do niej zapisać, jest ograniczone
naszym schematem, a nie payloadem wywołującego. Integracje bramek budują payload
w kodzie i nie podlegają temu ograniczeniu.

Poza trasami zamówienia konsumują sterowniki przez
`order-service.ts#placeOrder()`, a mutacje statusu płatności w adminie idą przez
`/api/v1/admin/orders/:id/payment-status`, którego właścicielem jest `orders`.

Retry kupującego (`POST /api/v1/orders/:orderId/payments/retry`) to trasa
klienta i autoryzuje przez `requireCustomer`, nie przez uprawnienie.

## Emitowane zdarzenia

`payment.settled.v1`, `payment.failed.v1`, `payment.refunded.v1`.

## Punkty rozszerzenia

- **Nowa bramka** — zaimplementuj `gateway-adapter-port.ts`, zarejestruj
  sterownik w composition root, wystaw konfigurację przez moduł
  `integrations`.
- **Hooki fraud / 3DS** — włóż przed wywołaniem `reserve` sterownika,
  zanim transakcja składania zamówienia się zatwierdzi.

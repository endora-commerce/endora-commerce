---
title: shipments
description: Retryowalny rekord Shipment i jego cykl życia — odpowiednik dostawy po stronie płatności
---

# `shipments`

Rekord `Shipment` i jego cykl życia.
Odpowiednik dostawy po stronie `payments`: *katalog* metod dostawy i rejestr
adapterów żyją w [`delivery_methods`](./delivery_methods.md); ten moduł posiada
first-class, retryowalny `Shipment` oraz ingress `receive_shipment`.

## Encja

`Shipment` — jedna próba wygenerowania wysyłki wobec Order:
`orderId`, `deliveryMethodId`, `status` (`pending` → `success` | `failure`, plus
`pending_manual`), `externalReference`, `providerDetails` (JSONB),
`failureReason`, `attemptNo`, timestamps. Order może mieć wiele Shipment
(retry po nieudanym generowaniu; przyszły podział na wiele paczek). `status`
tutaj to status procesu wysyłki, odrębny od statusu Order, na który mapuje
metoda.

### `pending_manual` — przewoźnik nigdy nie został poproszony

Wysyłka otwiera się jako `pending_manual`, gdy adapter wskazany przez metodę
dostawy jest dostarczany przez moduł, którego **nie ma** — wyłączony przez
operatora lub niedostępny w tym wdrożeniu. Rejestr filtruje ten adapter przy
enumeracji (polityka contribution-point), więc nic nie jest wysyłane: brak
etykiety, numeru śledzenia, odbioru. Wiersz rejestruje, co się stało, zamiast
wyglądać jak każda inna wysyłka:

- `status = 'pending_manual'`, to samo słowo — i ta sama instrukcja dla tego
  samego operatora — co zwrot, którego platforma nie mogła rozliczyć
  automatycznie: *człowiek musi to dokończyć*;
- `failureReason` nazywa moduł, np. `The "my_carrier" module is not
  switched on here, so the carrier was never asked to create this shipment.
  Switch the module back on and generate the shipment again.`;
- wpis audytu `shipment.carrier_not_contacted` na wysyłce, zapisany
  współtransakcyjnie z wierszem;
- **brak** e-maila `shipment_created`. Notifier odpowiada
  `{ sent: false, reason: 'carrier_not_contacted' }` i loguje to — powiadomienie
  kupującego, że zamówienie wysłano, gdy nic nie przekazano nikomu, jest gorsze
  niż brak wiadomości, a to nie jest wiadomość, którą można wycofać.

Celowo **nie** jest to `failure` — nic nie zostało odrzucone, bo nic nie
wysłano — i celowo nie zwykłe `pending`, które oznacza przewoźnika, który wie o
wysyłce, ale jeszcze nie zgłosił wyniku.

Metoda dostawy, której klucz adaptera **nikt nigdy nie dostarczył**, pozostaje
nietknięta: nadal otwiera `pending`, bo nie ma modułu do włączenia, a metoda
offline zawsze była kończona ręcznie. Oba przypadki rozróżnia
`ShippingAdapterRegistry.absentOwnerFor`, nie `get()` — które dla obu zwraca
`undefined`.

**Odzyskanie to akcja operatora, nie automatyczny sweep.** Włączenie modułu
z powrotem nic nie zmienia w już otwartych wysyłkach; operator generuje wysyłkę
ponownie (`POST /api/v1/admin/orders/:id/shipments`), co dopisuje nową próbę i
pyta przewoźnika. Reagowanie na ustawienie aktywacji oznaczałoby, że platforma
woła przewoźnika o paczki, które operator mógł już obsłużyć ręcznie, bez
prośby kogokolwiek. Zakładka Delivery zamówienia pokazuje stan, powód i
przycisk.

Kiedyś był tu drugi endpoint, `POST .../shipments/retry`, i został
usunięty: dopisywał próbę n+1 i nie kontaktował adaptera w żadnym stanie, więc
operator, który go użył, dostawał świeży wiersz `pending`, o który nikt nie
został poproszony. Retry **to** ponowne generowanie — endpoint generate dopisuje
kolejną próbę, odmawia dopiero po sukcesie i pyta przewoźnika o nią.

## Cykl życia

| Zdarzenie | Wyzwalacz | Efekt |
| --- | --- | --- |
| `order_created` | Utworzenie zamówienia (storefront / admin / API) | Odpala się `onOrderCreated` adaptera wysyłki. Adaptery offline to no-op; **żaden** Shipment nie otwiera się tutaj. |
| `shipment_created` | Admin „Generate shipment” / API | Otwiera się `pending` Shipment (`attemptNo = max+1`); odpala się `onShipmentCreated` adaptera; emitowane jest `shipment.created.v1`, niosąc stan, w jakim otworzył się wiersz. Przy nieobecnym module adaptera wiersz otwiera `pending_manual` i adapter nie jest wołany — zobacz wyżej. |
| `receive_shipment` | Ingress przewoźnika/adaptera | Rozwiązywany jest Shipment; Order przechodzi na `statusOnSuccess` / `statusOnFailure` metody; emitowane jest `shipment.received.v1` / `shipment.failed.v1`. |

`receive_shipment` jest **idempotentny**: sukces po terminalnym `success` to
no-op; failure po sukcesie jest odrzucany (409, bez downgrade); brakująca /
już rozwiązana referencja jest odrzucana bez psucia rekordów. Nieudane
generowanie retryuje się przez ponowne generowanie, które otwiera kolejną próbę
Shipment i pyta przewoźnika, pozostawiając wcześniejsze próby nienaruszone.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `POST /api/v1/admin/orders/:id/shipments` | admin (`orders:write`) | Generuj wysyłkę (`shipment_created`) — i retry po nieudanej, generując kolejną próbę |
| `GET /api/v1/admin/orders/:id/shipments` | admin (`orders:read`) | Pełna historia wysyłek zamówienia |
| `POST /api/v1/shipments/receive` | ingress adaptera/przewoźnika (admin-guarded dla MVP) | Ingress wyniku `receive_shipment` |

## Mapowanie statusu zamówienia

Przy wyniku `receive_shipment` handler zapisuje `orders.status` bezpośrednio
(omijając graf stanów `transitionStatus`) na `statusOnSuccess` / `statusOnFailure`
metody, walidowane przez port `OrderStatusRegistry` należący do
`delivery_methods`. Emitowane zdarzenia płyną na in-process `EventBus` w
transakcyjnym zakresie handlera, więc wycofana transakcja nigdy nie dispatchuje.

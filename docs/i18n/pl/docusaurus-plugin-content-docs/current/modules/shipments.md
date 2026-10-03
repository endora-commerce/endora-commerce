---
title: shipments
description: Rekord przesyłki z możliwością ponowienia i jego cykl życia — odpowiednik modułu payments po stronie dostawy
---

# `shipments`

Rekord przesyłki (`Shipment`) i jego cykl życia. To odpowiednik modułu `payments` po stronie
dostawy: *katalog* metod dostawy i rejestr adapterów należą do
[`delivery_methods`](./delivery_methods.md), a ten moduł odpowiada za pełnoprawny, możliwy do
ponowienia `Shipment` oraz przyjmowanie wyniku `receive_shipment`.

## Encja

`Shipment` — jedna próba utworzenia przesyłki dla zamówienia: `orderId`, `deliveryMethodId`,
`status` (`pending` → `success` | `failure`, a także `pending_manual`), `externalReference`,
`providerDetails` (JSONB), `failureReason`, `attemptNo`, znaczniki czasu. Zamówienie może mieć wiele
przesyłek (ponowienie po nieudanym utworzeniu; w przyszłości podział na kilka paczek). `status`
oznacza tu stan procesu wysyłki i jest czymś innym niż status zamówienia, na który przekłada go
metoda dostawy.

### `pending_manual` — przewoźnik nigdy nie dostał zlecenia

Przesyłka powstaje w stanie `pending_manual`, gdy adapter wskazany przez metodę dostawy dostarcza
moduł, którego **nie ma** — wyłączony przez operatora albo niedostępny w tym wdrożeniu. Rejestr
pomija taki adapter przy przeglądaniu wpisów (zasada dla punktów wpięcia), więc nic nie zostaje
wysłane: nie ma etykiety, numeru śledzenia ani odbioru. Wiersz zapisuje, co się stało, zamiast
wyglądać jak każda inna przesyłka:

- `status = 'pending_manual'` — to samo słowo i ta sama instrukcja dla tego samego operatora co przy
  zwrocie, którego platforma nie mogła rozliczyć automatycznie: *człowiek musi to dokończyć*;
- `failureReason` wskazuje moduł, np. `The "my_carrier" module is not switched on here, so the
  carrier was never asked to create this shipment. Switch the module back on and generate the
  shipment again.`;
- wpis audytu `shipment.carrier_not_contacted` dla przesyłki, zapisany w tej samej transakcji co
  wiersz;
- **brak** e-maila `shipment_created`. Mechanizm powiadomień zwraca
  `{ sent: false, reason: 'carrier_not_contacted' }` i zapisuje to w logu — poinformowanie
  kupującego o wysłaniu zamówienia, gdy nic nikomu nie przekazano, jest gorsze niż brak wiadomości,
  a takiej wiadomości nie da się cofnąć.

Celowo **nie** jest to `failure` — nic nie zostało odrzucone, bo nic nie wysłano — i celowo nie
zwykłe `pending`, które oznacza przewoźnika, który wie o przesyłce, ale jeszcze nie zgłosił wyniku.

Metoda dostawy, której klucza adaptera **nikt nigdy nie dostarczył**, działa jak dotąd: nadal
tworzy przesyłkę `pending`, bo nie ma modułu do włączenia, a metodę offline zawsze kończyło się
ręcznie. Oba przypadki rozróżnia `ShippingAdapterRegistry.absentOwnerFor`, a nie `get()`, które dla
obu zwraca `undefined`.

**Odzyskanie to czynność operatora, a nie automatyczne zadanie.** Ponowne włączenie modułu nie
zmienia już utworzonych przesyłek; operator ponownie generuje przesyłkę
(`POST /api/v1/admin/orders/:id/shipments`), co dodaje nową próbę i zleca ją przewoźnikowi.
Reagowanie na zmianę ustawienia aktywacji oznaczałoby, że platforma bez niczyjej prośby zleca
przewoźnikowi paczki, które operator mógł już obsłużyć ręcznie. Zakładka Delivery zamówienia
pokazuje stan, powód i przycisk.

Kiedyś istniał tu drugi endpoint, `POST .../shipments/retry`, i został usunięty: dodawał próbę n+1,
ale w żadnym stanie nie kontaktował się z adapterem, więc operator, który go użył, dostawał nowy
wiersz `pending`, o który nikt nie został poproszony. Ponowienie **to** ponowne wygenerowanie —
endpoint generowania dodaje kolejną próbę, odmawia dopiero po sukcesie i zleca ją przewoźnikowi.

## Cykl życia

| Zdarzenie | Co je wywołuje | Skutek |
| --- | --- | --- |
| `order_created` | Utworzenie zamówienia (storefront / panel / API) | Wywoływane jest `onOrderCreated` adaptera wysyłki. Adaptery offline nic nie robią; przesyłka **nie** powstaje w tym momencie. |
| `shipment_created` | „Generate shipment” w panelu albo API | Powstaje przesyłka `pending` (`attemptNo = max+1`); wywoływane jest `onShipmentCreated` adaptera; emitowane jest `shipment.created.v1` ze stanem, w jakim powstał wiersz. Gdy modułu adaptera nie ma, wiersz powstaje jako `pending_manual`, a adapter nie jest wywoływany — zobacz wyżej. |
| `receive_shipment` | Wynik od przewoźnika lub adaptera | Przesyłka zostaje rozstrzygnięta; zamówienie przechodzi do `statusOnSuccess` / `statusOnFailure` metody dostawy; emitowane jest `shipment.received.v1` / `shipment.failed.v1`. |

`receive_shipment` jest **idempotentne**: sukces po końcowym `success` niczego nie zmienia; porażka
po sukcesie jest odrzucana (409, bez cofania statusu); brakujące lub już rozstrzygnięte odwołanie
jest odrzucane bez uszkadzania rekordów. Nieudane utworzenie ponawia się, generując przesyłkę
ponownie — powstaje kolejna próba, która trafia do przewoźnika, a wcześniejsze próby pozostają bez
zmian.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/admin/orders/:id/shipments` | administrator (`orders:write`) | Wygenerowanie przesyłki (`shipment_created`) — także ponowienie po nieudanej próbie, przez wygenerowanie kolejnej |
| `GET /api/v1/admin/orders/:id/shipments` | administrator (`orders:read`) | Pełna historia przesyłek zamówienia |
| `POST /api/v1/shipments/receive` | adapter lub przewoźnik (w MVP chronione jak trasa administracyjna) | Przyjęcie wyniku `receive_shipment` |

## Przekładanie na status zamówienia

Po otrzymaniu wyniku `receive_shipment` handler zapisuje `orders.status` bezpośrednio (z pominięciem
grafu przejść `transitionStatus`) jako `statusOnSuccess` / `statusOnFailure` metody dostawy,
sprawdzane przez port `OrderStatusRegistry` należący do `delivery_methods`. Emitowane zdarzenia
trafiają na działającą w procesie szynę `EventBus` w zakresie transakcji handlera, więc wycofana
transakcja nigdy niczego nie wysyła.

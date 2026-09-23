---
title: delivery_methods
description: Skonfigurowane opcje dostawy
---

# `delivery_methods`

**Framework metod wysyłki** platformy (feature 035 — _Metoda Dostawy_).
Moduł hostuje rejestr adapterów wtykanych nad katalogiem metod dostawy,
blizniaczy odpowiednik po stronie dostawy dla `payment_methods`. Rekord `Shipment`
pierwszej klasy i jego cykl życia żyją w sąsiednim module [`shipments`](./shipments.md).
Integracje przewoźników takie jak [`inpost`](./inpost.md) rejestrują adaptery w tym
frameworku.

Metoda dostawy nigdy nie jest hard-coded: platforma odkrywa metody z
**modułów adapterów**, które są zainstalowane i włączone. Włączenie rozpoznanego
modułu adaptera metody wysyłki auto-tworzy konfigurowalny wiersz
`delivery_methods` widoczny na `/delivery-methods`.

## Publiczne API

Trasy admin są chronione przez `delivery_methods:read` (odczyty) i
`delivery_methods:write` (mutacje) — własne kody modułu od 2026-08-28.
Wcześniej były to `catalog:read` / `catalog:write`, co oznaczało, że ktokolwiek mógł
edytować produkt, mógł też decydować, jak sklep wysyła, i usuwać metodę
dostawy wprost. Rola polegająca na kodach katalogu dla tego ekranu
musi dostać nowe na `/admin-roles`; nic nie nadaje ich automatycznie — celowo.

| Verb + Path | Odbiorca | Gate | Cel |
| --- | --- | --- | --- |
| `GET /api/v1/delivery-methods` | anon | — | Metody kwalifikujące się do checkout storefront (active ∩ sales-channel ∩ Organization allow-list ∩ adapter registered ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/delivery-methods` | admin | `delivery_methods:read` | Pełna lista z adapterem, mapowaniami statusów, sales channels, kluczem renderera |
| `PUT /api/v1/admin/delivery-methods/:code` | admin | `delivery_methods:write` | Upsert po kodzie (name, cost/`price`, status, `statusOnSuccess`/`statusOnFailure`, sales channels) |
| `DELETE /api/v1/admin/delivery-methods/:id` | admin | `delivery_methods:write` | Twarde usunięcie (chronione: odrzucone 409, gdy `Shipment` referencjonuje metodę — ustaw status `inactive` zamiast tego) |

Selektory statusów admin czytają opcje z `GET /api/v1/admin/order-statuses`
(należące do tras admin modułu payment-methods; współdzielony `OrderStatusRegistry`). Ta
trasa wymaga `payment_methods:read` **or** `delivery_methods:read` — any-of
nad dwoma edytorami, które ją czytają, więc kod otwierający ten ekran otwiera też
jego selektory statusów.

## Pola wpisu

Wiersz `delivery_methods` niesie: `code` (unikalny), `adapter` (klucz rejestru),
per-język `name` (domyślna + nadpisania), `cost` + `currency` (dopłata `price`
dodawana do sumy zamówienia), `status` (`active`/`inactive`),
`statusOnSuccess` / `statusOnFailure` (referencje statusów Order stosowane przy
sukcesie/porażce generowania przesyłki). **Nie ma** `statusOnPending` ani kolumny
`kind` — metoda wysyłki jest identyfikowana wyłącznie przez `adapter`.

`statusOnSuccess` / `statusOnFailure` referencjonują statusy Order rozwiązywane
przez port `OrderStatusRegistry` (oparte na enumie statusu order do czasu,
gdy moduł Orders dostarczy konfigurowalny rejestr). Domyślne seedy: `shipped` /
`in_fulfilment`.

Zakres sales channel reużywa generycznego `SalesChannelMembershipService`
(`'delivery-method'`); dostępność per Organization reużywa
`OrganizationRestrictionService` (`'delivery_method'`, opt-out blocklist).

## Jak zbudować moduł metody wysyłki

Moduł platformy jest rozpoznawany jako adapter metody wysyłki **wtedy i tylko wtedy, gdy**
rejestruje `ShippingAdapter` w procesowym `shippingAdapterRegistry`
z boot hooka (FR-001). Nie trzeba zmian w core.

1. **Zaimplementuj kontrakt `ShippingAdapter`** (`@endora-commerce/contracts`):

   ```ts
   import type { ShippingAdapter } from '@endora-commerce/contracts';

   export const myCarrierAdapter: ShippingAdapter = {
     adapterKey: 'my_carrier',
     // Dodatkowe warunki per powierzchnia; zwróć stałe true, gdy brak.
     validateUseOnStorefront: async () => true,
     validateUseOnAdmin: async () => true,
     validateUseInApi: async () => true,
     // order_created: może rozpocząć generowanie; bezpiecznie zostaw no-op.
     onOrderCreated: async () => {},
     // shipment_created: rozpocznij generowanie, zwróć następną akcję.
     onShipmentCreated: async () => ({ kind: 'pending' }),
     // receive_shipment: zmapuj ingress na wynik success/failure.
     onReceiveShipment: async (ctx) => ({
       result: 'success',
       externalReference: ctx.externalReference ?? null,
     }),
     // Opcjonalne klucze rendererów; brak ⇒ domyślna platformy.
     renderers: { storefront: 'my_carrier', email: 'my_carrier.email' },
   };
   ```

2. **Wnieś adapter z boot hooka**, nazywając moduł właściciela, i
   dostarcz wiersz metody jako migrację:

   ```ts
   import { shippingAdapterRegistry } from '.../delivery_methods/services/registry-singleton.js';

   ctx.onBoot(() => {
     shippingAdapterRegistry.register(myCarrierAdapter, 'my_carrier_module');
   });
   ```

   Id właściciela pozwala rejestrowi pominąć adapter, gdy jego moduł jest
   nieobecny, więc przewoźnik wyłączony przez operatora przestaje być oferowany zamiast
   być oferowany i padać (issue #96 — defekt bliźniaka payment, naprawiony po obu
   stronach). Sam wiersz `delivery_methods` to statyczne dane referencyjne i
   należy do migracji modułu; `DeliveryMethodReconciler` pozostaje
   dostępny z `installHook` dla wiersza tworzonego z kodu. Nie trzeba uninstall hooka,
   aby wycofać adapter — moduł nieobecny nie jest enumerowany.

   Skip nie odpowiada za zamówienie **już złożone** na twojej metodzie:
   przesyłka nadal może być wygenerowana, a od issue #250 otwiera się
   `pending_manual` z nazwą twojego modułu zamiast brzmieć jak zaakceptowana.
   Nie piszesz kodu pod to — zobacz *Kiedy rejestr jest czytany* poniżej.

   **Twój hook wpycha i wraca.** Nie sprawdza, co już jest w tabeli,
   nie sprawdza obecności `delivery_methods` i nie traktuje nieobecności jako błędu — bo
   nic nie czyta rejestru podczas komponowania modułów. Boot hooki działają w
   dowolnym skutecznym stanie modułu; *enumeracja* odpowiada obecności, nie rejestracji.
   Throw w boot hooku to nie jeden adapter wypadający: `runBootHooks` re-throwuje go jako
   `ModuleCompositionError`, a `index.ts` robi z tego `process.exit(1)`, więc
   następny start operatora pada przez przełącznik, z którego miał prawo skorzystać. Hook
   wnoszący też *nie może* sondować `effectiveState` (D-67/D-68) — host filtruje przy
   enumeracji, a sonda przy push sprawiłaby, że ponowne włączenie przewoźnika wymaga
   restartu. Jeśli hook też *robi pracę* (reconcile, zapis Redis lub Postgres),
   rozdziel to najpierw: połowa robocza sonduje, wnosząca nigdy.

3. **Opcjonalne renderery** — zarejestruj niestandardowe renderery pod zadeklarowanymi
   kluczami:
   - Storefront: `registerShippingMethodRenderer(key, fn)` w
     `storefront/lib/shipping-renderers/registry.tsx`.
   - E-mail: `registerShippingEmailRenderer(key, fn)` w
     `shipments/services/shipping-email-renderer.ts`.
   Gdy renderer brakuje dla powierzchni, używana jest domyślna platformy, więc
   metoda zawsze się renderuje (FR-016/FR-017).

4. **Włącz moduł** z ekranu cyklu życia modułu admin → konfigurowalna
   Delivery Method pojawia się na `/delivery-methods`.

Dwa wbudowane offline reference adaptery — `manual_courier` (_Wysyłka własna_)
i `personal_pickup` (_Odbiór osobisty_) — nie wymagają zewnętrznego przewoźnika i są
przepracowanym przykładem pełnego cyklu życia.

## Kiedy rejestr jest czytany

`shippingAdapterRegistry` to **singleton procesowy**
(`delivery_methods/services/registry-singleton.ts`): jedna tabela adapterów na
proces, niezależnie ile razy platforma jest komponowana. Wkłady są wpychane
**raz, podczas komponowania**. Każde odczytanie następuje **później, wewnątrz
żądania**:

| Odczyt | Gdzie | Co oznacza nieobecny adapter |
| --- | --- | --- |
| Kwalifikacja storefront | `GET /api/v1/delivery-methods` → `ShippingMethodEligibilityService.filter` | metoda nie jest oferowana (FR-003) |
| Strażnik upsert admin | `PUT /api/v1/admin/delivery-methods/:code` → `isRegistered` | jawnie podany klucz, którego nikt nie wniósł, jest odrzucany (400); wniesiony z wyłączonym właścicielem jest akceptowany, bo odczyt celowo nie widzi obecności |
| Składanie zamówienia | `orders` ponownie waliduje wybraną metodę, potem odpala `onOrderCreated` | metoda z wyłączonym właścicielem odpowiada 503 `MODULE_DISABLED`; nierzarejestrowana pomija hook |
| Generowanie przesyłki | `ShipmentService.create` → `onShipmentCreated` | hook adaptera jest pomijany, a `Shipment` otwiera **`pending_manual`** z nazwą nieobecnego modułu (issue #250) — nigdy zwykłe `pending`, które brzmiałoby jak zaakceptowana przez przewoźnika |
| E-mail potwierdzenia zamówienia | klucz `renderers.email` metody | używany jest domyślny renderer platformy |

Wynikają dwie rzeczy i dlatego ta sekcja istnieje, zamiast być domyślana. Po pierwsze,
**nie ma kolejności do trafienia** między wnoszącymi: twój adapter jest widoczny przy
pierwszym odczycie, niezależnie czy wszedł przed czy po czyimś, więc boot hook nie ma
czego czekać ani weryfikować. Po drugie, nieobecny lub wyłączony wnoszący jest
odpowiadany **przy odczycie**, przez zapisanego właściciela wpisu — nigdy przy push.
To czyni to punktem wkładu, a nie gated portem (D-39): push jest celowo ungated,
bo gating zamieniłby jeden flip operatora w boot failure wskazujący moduł, którego
nikt nie dotykał.

Filtr obecności dzieli powierzchnię według pytającego. `get`, `resolve`,
`list` i `isAvailable` pomijają wpis, którego moduł właściciel nie jest skutecznie
obecny — kupujący nigdy nie dostaje przewoźnika, który nie może przyjąć paczki, a
`resolve` podnosi zwykły `ModuleDisabledError`. `entry`, `ownerOf`,
`isRegistered` i `listAll` celowo nie, bo `/delivery-methods`
musi pokazywać metodę *i* powód niedostępności: wyłączenie modułu to nie deinstalacja.

`absentOwnerFor(adapterKey)` to piąty czytelnik i jedyny odpowiadający na
*pytanie* zamiast eksponować tabelę: nazywa moduł, który wniósł klucz i nie jest
obecny, i `null` w każdym innym przypadku. Istnieje, bo `get()` zwija dwie sytuacje,
na które operator nie może reagować identycznie — klucz, którego nikt nie wniósł, i klucz,
którego moduł przewoźnika jest wyłączony — a tylko druga nazywa coś, co można
włączyć z powrotem. `shipments` pyta o to, by zdecydować, w jakim stanie otworzyć
`Shipment`; bliźniak payment, `GatewayRefundRegistry.absentOwnerFor`, to ten sam
czytelnik z tego samego powodu (D-71).

## Cykl życia

Zobacz [`shipments`](./shipments.md) dla cyklu życia `order_created` → `shipment_created`
→ `receive_shipment`, encji `Shipment`, retry i mapowania statusów zamówienia.

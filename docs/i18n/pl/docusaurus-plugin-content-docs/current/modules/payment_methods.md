---
title: payment_methods
description: Skonfigurowane metody płatności
---

# `payment_methods`

CRUD nad skonfigurowanymi metodami płatności, które Klienci wybierają przy
checkout. Każdy wiersz `PaymentMethod` jest wspierany przez zarejestrowany **adapter**
(zobacz *Framework adapterów* poniżej) oraz listę widoczności per Sales Channel.

## Publiczne API

Trasy admin są chronione przez `payment_methods:read` (odczyty) i
`payment_methods:write` (mutacje) — własne kody modułu od 2026-08-28.
Wcześniej były to `catalog:read` / `catalog:write`, co oznaczało, że ktokolwiek mógł
edytować produkt, mógł też decydować, jak sklep przyjmuje płatności. Rola, która
polegała na kodach katalogu dla tego ekranu, musi dostać nowe na
`/admin-roles`; nic nie nadaje ich automatycznie — celowo.

`GET /api/v1/admin/order-statuses` to jeden wyjątek i to any-of,
a nie poszerzenie: trasa jest zarejestrowana tutaj, ale czytana przez dwa edytory —
ekran tego modułu i `delivery_methods` — więc akceptuje kod odczytu
któregokolwiek modułu. Drugi członek był `catalog:read`, dopóki
`delivery_methods` pożyczało uprawnienia katalogu; stał się
`delivery_methods:read`, gdy ten moduł wprowadził własną parę, więc posiadacz
katalogu nie dociera już do wspólnej listy.

| Verb + Path | Odbiorca | Gate | Cel |
| --- | --- | --- | --- |
| `GET /api/v1/payment-methods` | anon | — | Metody kwalifikujące się do checkout storefront (active ∩ org allow-list ∩ zarejestrowany adapter ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/payment-methods` | admin | `payment_methods:read` | Pełna konfiguracja (active + inactive) w tym `adapter`, `additionalPrice`, `statusOn*`, sales channels |
| `GET /api/v1/admin/payment-methods/adapters` | admin | `payment_methods:read` | Zarejestrowane klucze adapterów, dla pickera admin |
| `GET /api/v1/admin/order-statuses` | admin | `payment_methods:read` **or** `delivery_methods:read` | Opcje statusów zamówienia dla selektorów `statusOn*`, tutaj i na ekranie metody dostawy |
| `PUT /api/v1/admin/payment-methods/:code` | admin | `payment_methods:write` | Upsert po kodzie; `adapter` domyślnie `kind`, `statusOn*` walidowane względem rejestru statusów zamówienia |
| `PATCH /api/v1/admin/payment-methods/:id/status` | admin | `payment_methods:write` | Wyłącznie dostępność — jedyna mutacja, do której linkują cztery ekrany bramek |
| `DELETE /api/v1/admin/payment-methods/:id` | admin | `payment_methods:write` | Usunięcie — zablokowane (409), gdy `Payment` referencjonuje metodę; ustaw `inactive` zamiast tego |

## Encje

`PaymentMethod` — `code`, `kind`, **`adapter`** (klucz rejestru), domyślna +
per-język `name`, `status`, **`additionalPrice`** (stała dopłata w walucie
zamówienia) oraz trzy referencje statusów zamówienia
**`statusOnPending` / `statusOnSuccess` / `statusOnFailure`**. Zakres sales channel
przez `sales_channel_payment_methods`; dostępność per Organization przez
`organization_payment_methods`.

## Framework adapterów

Zachowanie metody płatności dostarcza **`PaymentAdapter`** zarejestrowany
w `PaymentAdapterRegistry`. Platforma rozpoznaje moduł jako dostawcę metody płatności
**wtedy i tylko wtedy, gdy rejestruje adapter** — nie ma innego warunku. Wbudowane
adaptery `bank_transfer`, `pickup`, `credit_limit` i
`gateway` to implementacje referencyjne
(`packages/modules/payments/src/backend/adapters/built-in-adapters.ts`).

### Kontrakt

`PaymentAdapter` (z `@endora-commerce/contracts`) niesie:

- `adapterKey` — stabilny id; odpowiada `payment_methods.adapter`.
- `type` — jeden z `bank_transfer | pickup | credit_limit | gateway`.
- `validateUseOnStorefront` / `validateUseOnAdmin` / `validateUseInApi` —
  dodatkowe warunki kwalifikacji per powierzchnia; zwracaj stałe `true`, gdy
  brak ograniczeń.
- `onStorefrontOrderCreated` — uruchamia się na **`storefront_order_created`**; zwraca
  `StartPaymentResult` (`awaiting_transfer | redirect | none`).
- `onReceivePayment` — interpretuje callback **`receive_payment`** na
  `PaymentOutcome` success/failure.
- `renderers?` — opcjonalne klucze rendererów `{ storefront?, admin?, email? }`;
  brak ⇒ używany jest domyślny renderer platformy.

### Cykl życia

1. **`storefront_order_created`** — `order-service.placeOrder` tworzy
   Order przy `statusOnPending` metody, dodaje `additionalPrice` do sumy,
   otwiera oczekujący `Payment` i wywołuje
   `adapter.onStorefrontOrderCreated`.
2. **`receive_payment`** — `POST /api/v1/payments/receive` rozwiązuje
   `Payment` (po `paymentId` lub `orderId + externalReference`), stosuje
   wynik i mapuje status Order przez `statusOnSuccess` /
   `statusOnFailure`. Idempotentne: ponowny sukces to no-op; failure po
   terminalnym `paid` jest odrzucany. Nieudana płatność jest ponawiana przez
   `POST /api/v1/admin/orders/:id/payments/retry`, otwierając nowy `Payment`
   (`attemptNo + 1`) przy zachowaniu wcześniejszych prób.

`Payment.status` (status procesu płatności: `awaiting_payment → paid |
failed`, plus `deferred` dla limitu kredytowego) jest **osobny** od
mapowania statusów zamówienia. `statusOn*` referencjonują *Order Statuses* rozwiązywane
przez port `OrderStatusRegistry` — dziś oparte na enumie, wymienialne na
konfigurowalny rejestr modułu Orders później bez zmian tutaj.

### Zbuduj własny moduł metody płatności

1. Utwórz pakiet modułu (`packages/modules/<your_module>/`) z
   `src/manifest.ts` deklarującym `dependencies: ['payment_methods']`, następnie uruchom
   `pnpm --filter backend run composer:generate`, aby wygenerowany rejestr manifestów
   go podłapał.
2. Zaimplementuj `PaymentAdapter`: ustaw `adapterKey`, `type`, trzy
   `validateUse*` (zwróć `true`, gdy brak ograniczeń), `onStorefrontOrderCreated`
   (zwróć `redirect` / `awaiting_transfer` / `none`) oraz
   `onReceivePayment` (zmapuj callback PSP na `success` / `failure`).
3. Wnieś adapter z **boot hooka** modułu, nazywając moduł jako
   właściciela:

   ```ts
   import { paymentAdapterRegistry } from '.../payment_methods/services/registry-singleton.js';

   ctx.onBoot(() => {
     paymentAdapterRegistry.register(myAdapter, 'my_module');
   });
   ```

   Id właściciela nie jest dekoracją: rejestr pomija adapter, którego moduł nie jest
   skutecznie obecny, więc bramka wyłączona przez operatora przestaje być
   oferowana przy checkout bez wyrejestrowywania. Boot hooki
   działają w dowolnym stanie modułu — *enumeracja* odpowiada na obecność, nie
   rejestrację.
4. Dostarcz wiersze metod jako **migrację** należącą do modułu. Kody,
   kindy i domyślne nazwy to stałe compile-time, więc to statyczne
   dane referencyjne, nie reconcile per boot: `insert … on conflict (code) do
   nothing`, seedowane `inactive`, aby operator optował. Cztery wbudowane bramki
   robią dokładnie to (`stripe/migrations/…_stripe_seed_payment_methods.ts`).
   `PaymentMethodReconciler.ensureMethodForAdapter` pozostaje dostępny z
   `installHook` dla modułu, który musi utworzyć wiersz z kodu; jest idempotentny,
   nigdy nie nadpisuje edycji admina i nie dotyka członkostwa sales channel.
5. (Opcjonalnie) zarejestruj renderery storefront / admin / email pod kluczami,
   które deklaruje adapter; inaczej domyślne go renderują.
6. Włącz moduł → konfigurowalna Payment Method pojawia się na
   `/payment-methods`. Bez zmian w core.

`paymentAdapterRegistry` to **singleton procesowy**
(`registry-singleton.ts`): jedna tabela adapterów na proces, niezależnie ile razy
platforma jest komponowana, podłączony do ścieżek eligibility, admin i
składania zamówienia. Każdy wpis rejestruje moduł, który go wniósł, a
każdy odczyt skierowany do kupującego (`get`, `resolve`, `list`) pomija wpis, którego właściciel
nieobecny. Odczyty admin (`entry`, `ownerOf`, `isRegistered`, `listAll`)
celowo nie: wyłączenie modułu to nie deinstalacja, więc ekran
`/payment-methods` zachowuje wiersz i pokazuje, dlaczego jest niedostępny.

## Dostępność per Organization

`organization_payment_methods` to **allow-list**: pusta ⇒ oferowane
są wszystkie aktywne metody; niepusta ⇒ tylko wymienione. Użyj do
filtrowania metod, których dana Organization może używać. Zarządzane przez
serwis restrykcji organizations / UI restrykcji admin.

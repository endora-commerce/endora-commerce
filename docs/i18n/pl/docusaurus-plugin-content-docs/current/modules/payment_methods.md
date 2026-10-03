---
title: payment_methods
description: Skonfigurowane metody płatności
---

# `payment_methods`

Zarządzanie skonfigurowanymi metodami płatności, które klienci wybierają w checkoucie. Za każdym
wierszem `PaymentMethod` stoi zarejestrowany **adapter** (zobacz *Mechanizm adapterów* niżej) oraz
lista kanałów sprzedaży, w których metoda jest widoczna.

## API publiczne

Trasy administracyjne są chronione przez `payment_methods:read` (odczyt) i
`payment_methods:write` (zmiany) — własne kody modułu od 2026-08-28. Wcześniej były to
`catalog:read` / `catalog:write`, co oznaczało, że każdy, kto mógł edytować produkt, mógł też
decydować o tym, jak sklep przyjmuje płatności. Rola, która korzystała z kodów katalogu przy tym
ekranie, musi dostać nowe kody na `/admin-roles`; nic nie przyznaje ich automatycznie — celowo.

Jedynym wyjątkiem jest `GET /api/v1/admin/order-statuses` i jest to warunek „jedno z”, a nie
poszerzenie uprawnień: trasa jest zarejestrowana w tym module, ale korzystają z niej dwa edytory —
ekran tego modułu i `delivery_methods` — więc akceptuje kod odczytu któregokolwiek z tych modułów.
Drugim kodem było `catalog:read`, dopóki `delivery_methods` korzystało z uprawnień katalogu; po
wprowadzeniu przez tamten moduł własnej pary kodów stało się nim `delivery_methods:read`, więc samo
uprawnienie do katalogu nie daje już dostępu do wspólnej listy.

| Metoda i ścieżka | Kto | Uprawnienie | Przeznaczenie |
| --- | --- | --- | --- |
| `GET /api/v1/payment-methods` | anonimowy | — | Metody dostępne w checkoucie storefrontu (aktywne ∩ lista dozwolonych dla organizacji ∩ zarejestrowany adapter ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/payment-methods` | administrator | `payment_methods:read` | Pełna konfiguracja (aktywne i nieaktywne), łącznie z `adapter`, `additionalPrice`, `statusOn*` i kanałami sprzedaży |
| `GET /api/v1/admin/payment-methods/adapters` | administrator | `payment_methods:read` | Zarejestrowane klucze adapterów, do listy wyboru w panelu |
| `GET /api/v1/admin/order-statuses` | administrator | `payment_methods:read` **albo** `delivery_methods:read` | Statusy zamówienia do list wyboru `statusOn*`, tutaj i na ekranie metod dostawy |
| `PUT /api/v1/admin/payment-methods/:code` | administrator | `payment_methods:write` | Utworzenie lub aktualizacja według kodu; `adapter` domyślnie przyjmuje wartość `kind`, a `statusOn*` jest sprawdzane względem rejestru statusów zamówienia |
| `PATCH /api/v1/admin/payment-methods/:id/status` | administrator | `payment_methods:write` | Wyłącznie dostępność — jedyna zmiana, do której odsyłają cztery ekrany bramek płatności |
| `DELETE /api/v1/admin/payment-methods/:id` | administrator | `payment_methods:write` | Usunięcie — zablokowane (409), gdy metoda jest używana przez płatność `Payment`; zamiast tego ustaw `inactive` |

## Encje

`PaymentMethod` — `code`, `kind`, **`adapter`** (klucz w rejestrze), `name` domyślne i dla
poszczególnych języków, `status`, **`additionalPrice`** (stała dopłata w walucie zamówienia) oraz
trzy odwołania do statusów zamówienia: **`statusOnPending` / `statusOnSuccess` / `statusOnFailure`**.
Przypisanie do kanałów sprzedaży przez `sales_channel_payment_methods`; dostępność dla organizacji
przez `organization_payment_methods`.

## Mechanizm adapterów

Działanie metody płatności zapewnia **`PaymentAdapter`** zarejestrowany w `PaymentAdapterRegistry`.
Platforma rozpoznaje moduł jako dostawcę metody płatności **wtedy i tylko wtedy, gdy rejestruje
adapter** — nie ma innego warunku. Wbudowane adaptery `bank_transfer`, `pickup`, `credit_limit` i
`gateway` to implementacje wzorcowe (`packages/modules/payments/src/backend/adapters/built-in-adapters.ts`).

### Kontrakt

`PaymentAdapter` (z `@endora-commerce/contracts`) zawiera:

- `adapterKey` — stały identyfikator; odpowiada `payment_methods.adapter`.
- `type` — jedno z `bank_transfer | pickup | credit_limit | gateway`.
- `validateUseOnStorefront` / `validateUseOnAdmin` / `validateUseInApi` — dodatkowe warunki
  dostępności dla poszczególnych miejsc; zwracaj stałe `true`, gdy nie ma ograniczeń.
- `onStorefrontOrderCreated` — wywoływane przy **`storefront_order_created`**; zwraca
  `StartPaymentResult` (`awaiting_transfer | redirect | none`).
- `onReceivePayment` — przekłada powiadomienie zwrotne **`receive_payment`** na wynik
  `PaymentOutcome` (sukces albo porażka).
- `renderers?` — opcjonalne klucze szablonów `{ storefront?, admin?, email? }`; brak ⇒ używany jest
  szablon domyślny platformy.

### Cykl życia

1. **`storefront_order_created`** — `order-service.placeOrder` tworzy zamówienie w statusie
   `statusOnPending` metody, dolicza `additionalPrice` do wartości zamówienia, otwiera oczekującą
   płatność `Payment` i wywołuje `adapter.onStorefrontOrderCreated`.
2. **`receive_payment`** — `POST /api/v1/payments/receive` odnajduje płatność `Payment` (po
   `paymentId` albo `orderId + externalReference`), zapisuje wynik i przestawia status zamówienia
   przez `statusOnSuccess` / `statusOnFailure`. Działa idempotentnie: ponowny sukces niczego nie
   zmienia; porażka po końcowym stanie `paid` jest odrzucana. Nieudaną płatność ponawia się przez
   `POST /api/v1/admin/orders/:id/payments/retry`, co otwiera nową płatność `Payment`
   (`attemptNo + 1`), a wcześniejsze próby pozostają bez zmian.

`Payment.status` (stan procesu płatności: `awaiting_payment → paid | failed`, a także `deferred` dla
limitu kredytowego) jest **niezależny** od przekładania na statusy zamówienia. `statusOn*` odwołują
się do *statusów zamówienia* wyznaczanych przez port `OrderStatusRegistry` — dziś opartego na
wyliczeniu, a później wymiennego na konfigurowalny rejestr modułu zamówień bez zmian w tym module.

### Jak zbudować własny moduł metody płatności

1. Utwórz pakiet modułu (`packages/modules/<your_module>/`) z plikiem `src/manifest.ts`
   deklarującym `dependencies: ['payment_methods']`, a następnie uruchom
   `pnpm --filter backend run composer:generate`, aby wygenerowany rejestr manifestów go uwzględnił.
2. Zaimplementuj `PaymentAdapter`: ustaw `adapterKey`, `type`, trzy funkcje `validateUse*` (zwracaj
   `true`, gdy nie ma ograniczeń), `onStorefrontOrderCreated` (zwracaj `redirect` /
   `awaiting_transfer` / `none`) oraz `onReceivePayment` (przełóż powiadomienie od operatora
   płatności na `success` / `failure`).
3. Dodaj adapter w **hooku startowym** modułu, podając moduł jako właściciela:

   ```ts
   import { paymentAdapterRegistry } from '.../payment_methods/services/registry-singleton.js';

   ctx.onBoot(() => {
     paymentAdapterRegistry.register(myAdapter, 'my_module');
   });
   ```

   Identyfikator właściciela to nie ozdobnik: rejestr pomija adapter, którego moduł nie jest
   faktycznie obecny, więc bramka wyłączona przez operatora przestaje być oferowana w checkoucie bez
   wyrejestrowywania. Hooki startowe wykonują się niezależnie od stanu modułu — na pytanie o
   obecność odpowiada *przeglądanie wpisów*, a nie rejestracja.
4. Wiersze metod dostarcz jako **migrację** należącą do modułu. Kody, rodzaje i domyślne nazwy są
   stałe w czasie kompilacji, więc to statyczne dane słownikowe, a nie uzgadnianie przy każdym
   starcie: `insert … on conflict (code) do nothing`, z wartością `inactive`, aby operator świadomie
   je włączył. Dokładnie tak robią cztery wbudowane bramki
   (`stripe/migrations/…_stripe_seed_payment_methods.ts`).
   `PaymentMethodReconciler.ensureMethodForAdapter` pozostaje dostępny w `installHook` dla modułu,
   który musi utworzyć wiersz w kodzie; jest idempotentny, nigdy nie nadpisuje zmian administratora i
   nie zmienia przypisań do kanałów sprzedaży.
5. (Opcjonalnie) zarejestruj szablony dla storefrontu, panelu i e-maili pod kluczami, które deklaruje
   adapter; w przeciwnym razie użyte zostaną szablony domyślne.
6. Włącz moduł → na `/payment-methods` pojawia się konfigurowalna metoda płatności. Zmiany w rdzeniu
   nie są potrzebne.

`paymentAdapterRegistry` to **singleton procesu** (`registry-singleton.ts`): jedna tabela adapterów
na proces, niezależnie od tego, ile razy platforma jest składana, podłączona do sprawdzania
dostępności, panelu administracyjnego i składania zamówień. Każdy wpis zapisuje moduł, który go
dodał, a każdy odczyt przeznaczony dla kupującego (`get`, `resolve`, `list`) pomija wpis, którego
właściciela nie ma. Odczyty dla panelu (`entry`, `ownerOf`, `isRegistered`, `listAll`) celowo tego
nie robią: wyłączenie modułu to nie jego odinstalowanie, więc ekran `/payment-methods` zachowuje
wiersz i pokazuje, dlaczego metoda jest niedostępna.

## Dostępność dla organizacji

`organization_payment_methods` to **lista dozwolonych**: pusta ⇒ oferowane są wszystkie aktywne
metody; niepusta ⇒ tylko wymienione. Służy do ograniczania metod, z których może korzystać dana
organizacja. Zarządza nią usługa ograniczeń modułu organizacji i odpowiedni ekran w panelu.

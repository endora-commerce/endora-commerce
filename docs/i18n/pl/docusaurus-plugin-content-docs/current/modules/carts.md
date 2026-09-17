---
title: carts
description: Koszyk klienta z scalaniem anonimowy→zalogowany
---

# `carts`

Anonimowe i przypisane do klienta koszyki zakupowe. Anonimowy koszyk identyfikowany
jest długowiecznym tokenem cookie; po logowaniu scala się z koszykiem Klienta
deterministycznie.

Feature 027 (konsolidacja Carts, maj 2026) rozszerzyła moduł koszyka bazowego
o pełny cykl życia (`active` / `abandoned` / `completed` /
`rejected`), ortogonalny podstan zatwierdzenia, zakres sales channel,
księgowanie ostatniej aktywności, stosowanie kuponów względem modułu Promotions,
sugestie up-sell, trzy konwersje (Cart ↔ Quote Request, Shopping List
→ Cart), widoczność Administratora Organization + bramkę zatwierdzenia,
sweep porzucenia oraz powierzchnię obserwowalności platform-admin.

## Cykl życia

```text
                ┌──────────────────────────────────────────────────────┐
                │                                                      │
[ active / not_required ] ──(qty/add/remove/coupon)──┐                 │
        │                                            ▼                 │
        │                                  [ active / pending ]        │
        │                                            │                 │
        │                                            ├──(org-admin     │
        │                                            │   approve)──▶   │
        │                                            │  [ active /     │
        │                                            │   approved ]    │
        │                                            │     │           │
        │                                            ▼     ▼           │
        │  (org-admin reject)                  [ rejected / rejected_by_org_admin ]
        │
        ▼
[ abandoned ] ◀──(sweep: last_activity_at < threshold)── [ active / * ]
        │                                                      ▲
        │                                                      │
        └────────────────(any buyer activity)──────────────────┘

[ active / approved ]    ──(checkout success)──▶ [ completed / approved ]
[ active / * ]           ──(Cart→QR conversion)─▶ [ completed / *; converted_to_quote_request_id set ]
```

Reguła re-arm: każda mutacja kupującego (add/remove/quantity/coupon) na koszyku
`approved` cicho resetuje `approval_status` do `pending` — zobacz invariant
bezpieczeństwa w `specs/027-carts/research.md` §R11.

Wyłączenie self-approval: koszyk utworzony przez Organization Administrator
rodzi się z `approval_status='not_required'` niezależnie od flagi polityki per Org.

## Publiczne API

### Storefront (kupujący)

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/cart` | Aktywny koszyk (lazy-create); payload feature-027 zawiera `status`, `approvalStatus`, `salesChannelId`, `grandTotal`, `discount`, `primaryCta`, `droppedLines`, `couponDroppedThisRead`, `lastActivityAt` |
| `POST /api/v1/cart/items` | Dodanie pozycji (limit 200 linii) |
| `PATCH /api/v1/cart/items/:itemId` | Aktualizacja ilości (akceptuje `0` do usunięcia) |
| `DELETE /api/v1/cart/items/:itemId` | Usunięcie linii |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | Przeniesienie linii na Purchase List |
| `POST /api/v1/cart/touch` | Jawny ping otwarcia strony; podbija `last_activity_at` i reaktywuje porzucony koszyk |
| `GET /api/v1/cart/upsells?limit=N` | Pasek up-sell z Catalog `product_links` (kind = `up_sell`) |
| `POST /api/v1/cart/coupon` | Zastosowanie (lub zamiana, lub wyczyszczenie) aktywnego kodu kuponu; 422 `CART_COUPON_REJECTED` z powodem przy odrzuceniu |
| `DELETE /api/v1/cart/coupon` | Alias dla `POST {code: null}` |
| `POST /api/v1/cart/convert-to-quote-request` | Cart → Quote Request; koszyk źródłowy staje się `completed` z ustawionym `converted_to_quote_request_id` |
| `POST /api/v1/cart/from-quote-request/:qrId` | Quote Request → Cart; linie ponownie wycenione z bieżącego cennika klienta |
| `POST /api/v1/cart/from-shopping-list/:listId` | Shopping List → Cart; linie ponownie wycenione |

### Storefront (Organization Administrator)

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/organization/carts` | Lista wszystkich koszyków w Organization wywołującego |
| `GET /api/v1/organization/carts/:id` | Szczegóły (koszyk należący do członka) |
| `PATCH /api/v1/organization/policies/cart-approval` | Przełączenie `requires_cart_approval` dla Organization |
| `POST /api/v1/cart/submit-for-approval` | Kupujący wysyła koszyk do zatwierdzenia Org-Admin (no-op gdy polityka wył.; odmowa dla samych Org-Adminów) |
| `POST /api/v1/organization/carts/:id/approve` | Zatwierdzenie oczekującego koszyka |
| `POST /api/v1/organization/carts/:id/reject` | Odrzucenie oczekującego koszyka z wymaganym powodem |

Bramka roli: `CustomerAccount.role === 'organization_admin'` dla każdej trasy
`organization/*`. Koszyki obcej organization zwracają 404
(symetria anti-enumeration).

### Admin

| Verb + Path | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/carts` | `carts:read` | Paginowana lista platform-wide (filtry status / approvalStatus / org / customer / channel / data) |
| `GET /api/v1/admin/carts/:id` | `carts:read` | Szczegóły koszyka tylko do odczytu |
| `GET /api/v1/admin/carts/:id/audit` | `carts:read` | Feed audytu szczegółów koszyka |
| `POST /api/v1/admin/carts/:id/reject` | `carts:reject` | Awaryjne terminalne odrzucenie (wymaga powodu) |

## Encje

- `Cart` (jeden aktywny per `(customer_account_id, sales_channel_id)`; częściowy
  unikalny indeks wymusza to w PostgreSQL).
- `CartItem` (linia z snapshotem `unit_price` przy dodaniu + cache'owane
  kolumny `recomputed_*`).
- `CartAuditEntry` (typowany feed per koszyk; indeks na `(cart_id, occurred_at
  DESC)`). Każde przejście stanu trafia też do istniejącej tabeli
  `audit_log_entries` przez `AuditPort` dla platformowej
  osi czasu audytu.

## Ustawienia (feature 027)

| Key | Default | Description |
| --- | --- | --- |
| `carts.abandonment.inactivity_minutes` | `10080` (7 days) | Minuty nieaktywności, po których koszyk `active` uznawany jest za `abandoned`. `0` wyłącza sweep. |
| `carts.abandonment.notification_recipient` | `` (empty) | Pojedynczy adres e-mail do powiadomienia o porzuceniu. Pusty = brak e-maila (zmiana statusu i tak następuje). |

Seedowane przez ManifestReconciler cyklu życia modułu przy starcie backendu (zobacz
`packages/modules/carts/src/manifest.ts`).

## Scalanie przy logowaniu

`cart-service.ts#mergeAnonymousIntoCustomer()` wywoływane przez hook `onLogin`
modułu `organizations`. Konfliktujące linie łączą ilości; cookie anonimowego
koszyka unieważniane atomowo. Koszyk anonimowy źródłowy dostaje `status`
`'completed'` (nie `'abandoned'`), aby sweep nie wysłał później zbędnego
powiadomienia o porzuceniu.

## Sweep porzucenia

`cart-abandonment-worker.ts` wystawia zwykły async `sweep(now?)` na wzór
wzorca `RfqExpiryWorker` z feature 008. Sweep:

1. Czyta `carts.abandonment.inactivity_minutes` (≤ 0 wyłącza).
2. Wybiera koszyki `active`, gdzie `last_activity_at < now - threshold` ORAZ
   `abandonment_notified_at IS NULL` (idempotencja).
3. Ustawia status na `abandoned`, stempluje `abandonment_notified_at = now`.
4. Zapisuje jeden wiersz `cart_audit_entries.abandonment_swept` na dotknięty koszyk.
5. Wysyła e-mail do skonfigurowanego odbiorcy **tylko** dla niepustych
   koszyków (puste koszyki zmieniają status, ale tłumią powiadomienie według
   edge case specyfikacji).
6. Błędy dispatchu powiadomień nie cofają zmiany statusu.

Reaktywacja: każda aktywność kupującego (touch, add/remove/qty/coupon) na koszyku
`abandoned` przywraca go do `active` i czyści
`abandonment_notified_at`, aby następny cykl porzucenia mógł ponownie powiadomić.

## Konwersje

- **Cart → Quote Request**: ponownie używa `RfqService.createForCustomer`; snapshotowane
  ceny jednostkowe kupującego z koszyka przenoszone są jako
  `desired_unit_price`, aby sprzedaż widziała cenę referencyjną koszyka. Pozycje
  koszyka źródłowego są usuwane, a koszyk przechodzi na `'completed'` z ustawionym
  `converted_to_quote_request_id`.
- **Quote Request → Cart**: iteruje pozycje QR przez
  `CartService.addItem`, który już kieruje przez `PricingService` do
  ponownego wycenienia. `desired_unit_price` QR jest celowo pomijane — bieżące
  ceny kontraktowe kupującego są źródłem prawdy. Niedostępne /
  bez ceny / nie do kupienia linie są pomijane i zwracane w
  `droppedLines[]` z typowanymi powodami.
- **Shopping List → Cart**: delegowane do istniejącego
  `ShoppingListService.convertToCart` (feature 010); moduł carts
  wystawia port, który composition podłącza do niego.

## Stosowanie kuponu

Moduł carts nigdy nie posiada logiki promocji — przekazuje kod kuponu kupującego
przez `PromotionService.applyToCart(snapshot)`. Metoda
`CartCouponService.apply(cart, code)`:

1. Wyszukuje wiersz `Promotion` o podanej nazwie.
2. Uruchamia lokalne pre-checki (istnienie, okno ważności, dopasowanie org, min
   subtotal koszyka) i emituje typowany `CouponDropReason` przy pierwszej porażce.
3. Gdy pre-checki przejdą, woła `applyToCart` i weryfikuje, że nazwana promocja
   jest w zwróconym `appliedPromotions[]`.
4. Przy sukcesie: zapisuje `cart.applied_promotion_code = code`, audytuje
   `coupon_applied`, re-armuje zatwierdzenie w razie potrzeby.
5. Przy każdej porażce: zwraca `{outcome: 'dropped', reason, shortfall?}` i
   nie zmienia koszyka.

`reevaluateOnRead(cart, items)` ma być wołane ze ścieżki odczytu GET-cart,
aby wcześniej zastosowany kod, który już nie pasuje (np. koszyk spadł poniżej
min spend po usunięciu linii), był cicho usuwany, a odpowiedź
pokazywała `couponDroppedThisRead`. Podłączenie do ścieżki odczytu to follow-up.

## Punkty rozszerzenia

- **Re-pricing-on-read** — `CartPricingRecompute` + `CartRecomputeCache`
  (30 s Redis TTL) istnieją i są testowane, ale jeszcze nie podłączone do `GET
  /api/v1/cart`; dziś zwracany jest snapshotowany `unit_price`.
- **Dispatch e-maili** — e-maile submit-for-approval / approve / reject / abandonment
  są rusztowane w powierzchniach serwisów; dedykowane szablony to follow-up.
- **Harmonogram abandonment** — worker jest konstruowany w produkcyjnym
  composition, ale jeszcze nie podłączony do cron / harmonogramu BullMQ. Ops CLI
  `pnpm --filter backend run cart:abandonment-sweep` uruchamia jeden tick ręcznie.
  To manifest-declared command, który host uruchamia, więc sweep idzie przez
  własny `cartAbandonmentWorker` composition — zobacz
  `packages/modules/carts/src/backend/cli/abandonment-sweep.ts` dla ciała oraz
  eksport `cliCommands` w `packages/modules/carts/src/manifest.ts` dla
  deklaracji.

## Retencja audytu

`cart_audit_entries` to **log akcji per koszyk** (dodano/usunięto linię,
zmiana ilości, kupon zastosowany/wyczyszczony/odrzucony, zatwierdzenie wysłane /
  zatwierdzone / odrzucone, sweep oznaczył koszyk jako porzucony, konwersja do /
  z Quote Request, konwersja z Shopping List). Każdy wiersz trafia też
  do platformowej tabeli `audit_log_entries` przez
  `CartAuditService.record`, więc tabela carts to kanoniczny
  zdenormalizowany widok używany przez panel „Historia koszyka” Org-Admin i platform-admin.

Polityka retencji (feature 027):

- **Nigdy nie auto-czyść `cart_audit_entries`.** Org admini i platform
  admin polegają na pełnej historii, aby bronić decyzji zatwierdzenia i
  odtwarzać spory kupujących. Tabela jest append-only — serwisy nigdy
  nie robią `UPDATE` ani `DELETE` wierszy.
- **Kaskada przy usunięciu koszyka.** `cart_audit_entries.cart_id` ma `ON DELETE
  CASCADE`. Obecnie nie usuwamy koszyków w produkcji; jeśli przyszły
  workflow GDPR / prawo do usunięcia to zrobi, ślad audytu podąża.
  Gdy ten workflow wyląduje, zmirroruj wiersz koszyka plus jego wpisy audytu
  do długoterminowej tabeli archiwum tylko-audytowego *przed* odpaleniem kaskady —
  nie trać historii po cichu.
- **Produkcyjne purge danych MUSZĄ wykluczać `cart_audit_entries`.** Każdy
  zaplanowany job czyszczący koszyki, konta klientów lub organizations
  dla higieny storage MUSI albo pominąć `cart_audit_entries`, albo najpierw
  zarchiwizować. Recenzenci: dodaj tę tabelę do listy wykluczeń w
  `packages/modules/audit_logs/src/backend/retention-policy.ts`, gdy ta polityka
  zostanie wprowadzona.
- **Platformowa tabela `audit_log_entries` podąża za polityką retencji modułu
  audit_logs** (kontrolowaną poza tym feature). Lustrzane wpisy po stronie carts
  w `cart_audit_entries` są źródłem prawdy dla UI koszyków nawet gdy
  platformowa tabela się zestarzeje.

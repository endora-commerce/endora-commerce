---
title: carts
description: Koszyk klienta z łączeniem koszyka anonimowego z koszykiem po zalogowaniu
---

# `carts`

Koszyki anonimowe i przypisane do klienta. Koszyk anonimowy jest identyfikowany długo ważnym tokenem
w ciasteczku; po zalogowaniu jest w przewidywalny sposób łączony z koszykiem klienta.

Porządkowanie koszyków z maja 2026 rozszerzyło podstawowy moduł koszyka o pełny cykl życia
(`active` / `abandoned` / `completed` / `rejected`), niezależny od niego stan akceptacji, przypisanie
do kanału sprzedaży, zapis ostatniej aktywności, stosowanie kuponów przez moduł promocji, propozycje
droższych zamienników, trzy rodzaje zamiany (koszyk ↔ zapytanie ofertowe, lista zakupów → koszyk),
wgląd administratora organizacji w koszyki i akceptację koszyków, wyszukiwanie porzuconych koszyków
oraz ekrany podglądu dla administratora platformy.

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

Ponowne wymaganie akceptacji: każda zmiana koszyka przez kupującego (dodanie, usunięcie, ilość,
kupon) w koszyku `approved` po cichu przywraca `approval_status` do `pending`.

Brak akceptowania własnych koszyków: koszyk utworzony przez administratora organizacji powstaje z
`approval_status='not_required'`, niezależnie od ustawienia akceptacji w organizacji.

## API publiczne

### Storefront (kupujący)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/cart` | Aktywny koszyk (tworzony przy pierwszym odczycie); odpowiedź zawiera `status`, `approvalStatus`, `salesChannelId`, `grandTotal`, `discount`, `primaryCta`, `droppedLines`, `couponDroppedThisRead`, `lastActivityAt` |
| `POST /api/v1/cart/items` | Dodanie pozycji (limit 200 pozycji) |
| `PATCH /api/v1/cart/items/:itemId` | Zmiana ilości (`0` usuwa pozycję) |
| `DELETE /api/v1/cart/items/:itemId` | Usunięcie pozycji |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | Przeniesienie pozycji na listę zakupów |
| `POST /api/v1/cart/touch` | Jawny sygnał otwarcia strony; aktualizuje `last_activity_at` i przywraca porzucony koszyk |
| `GET /api/v1/cart/upsells?limit=N` | Pasek droższych zamienników z `product_links` katalogu (kind = `up_sell`) |
| `POST /api/v1/cart/coupon` | Zastosowanie (albo zamiana, albo usunięcie) aktywnego kodu kuponu; przy odrzuceniu 422 `CART_COUPON_REJECTED` z powodem |
| `DELETE /api/v1/cart/coupon` | To samo co `POST {code: null}` |
| `POST /api/v1/cart/convert-to-quote-request` | Koszyk → zapytanie ofertowe; koszyk źródłowy przechodzi w stan `completed` z ustawionym `converted_to_quote_request_id` |
| `POST /api/v1/cart/from-quote-request/:qrId` | Zapytanie ofertowe → koszyk; ceny pozycji są wyznaczane ponownie według bieżącego cennika klienta |
| `POST /api/v1/cart/from-shopping-list/:listId` | Lista zakupów → koszyk; ceny są wyznaczane ponownie |

### Storefront (administrator organizacji)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/organization/carts` | Lista wszystkich koszyków w organizacji wywołującego |
| `GET /api/v1/organization/carts/:id` | Szczegóły koszyka członka organizacji |
| `PATCH /api/v1/organization/policies/cart-approval` | Włączenie lub wyłączenie `requires_cart_approval` dla organizacji |
| `POST /api/v1/cart/submit-for-approval` | Kupujący przekazuje koszyk do akceptacji administratorowi organizacji (nic nie robi, gdy akceptacja jest wyłączona; odrzucane dla samych administratorów organizacji) |
| `POST /api/v1/organization/carts/:id/approve` | Akceptacja oczekującego koszyka |
| `POST /api/v1/organization/carts/:id/reject` | Odrzucenie oczekującego koszyka z wymaganym powodem |

Dostęp do każdej trasy `organization/*` wymaga `CustomerAccount.role === 'organization_admin'`.
Koszyki innej organizacji zwracają 404 (tak samo jak nieistniejące, by nie ujawniać ich istnienia).

### Panel administracyjny

| Metoda i ścieżka | Uprawnienie | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/carts` | `carts:read` | Stronicowana lista koszyków w całej platformie (filtry: status, approvalStatus, organizacja, klient, kanał, data) |
| `GET /api/v1/admin/carts/:id` | `carts:read` | Szczegóły koszyka tylko do odczytu |
| `GET /api/v1/admin/carts/:id/audit` | `carts:read` | Historia zmian koszyka |
| `POST /api/v1/admin/carts/:id/reject` | `carts:reject` | Awaryjne, ostateczne odrzucenie (wymaga powodu) |

## Encje

- `Cart` (jeden aktywny dla każdej pary `(customer_account_id, sales_channel_id)`; pilnuje tego w
  PostgreSQL częściowy indeks unikalny).
- `CartItem` (pozycja z kopią `unit_price` z chwili dodania i zapamiętanymi kolumnami
  `recomputed_*`).
- `CartAuditEntry` (typowana historia zmian każdego koszyka; indeks na `(cart_id, occurred_at DESC)`).
  Każda zmiana stanu trafia też do istniejącej tabeli `audit_log_entries` przez `AuditPort`, na
  wspólną oś czasu audytu platformy.

## Ustawienia

| Klucz | Wartość domyślna | Opis |
| --- | --- | --- |
| `carts.abandonment.inactivity_minutes` | `10080` (7 dni) | Liczba minut bez aktywności, po których koszyk `active` jest uznawany za `abandoned`. `0` wyłącza wyszukiwanie porzuconych koszyków. |
| `carts.abandonment.notification_recipient` | `` (puste) | Adres e-mail, na który trafia powiadomienie o porzuconym koszyku. Puste = bez e-maila (status i tak się zmienia). |

Ustawienia tworzy przy starcie backendu ManifestReconciler cyklu życia modułów (zobacz
`packages/modules/carts/src/manifest.ts`).

## Łączenie koszyków przy logowaniu

`cart-service.ts#mergeAnonymousIntoCustomer()` jest wywoływane przez hook `onLogin` modułu
`organizations`. Ilości powtarzających się pozycji są sumowane; ciasteczko koszyka anonimowego jest
unieważniane w tej samej operacji. Anonimowy koszyk źródłowy dostaje `status` `'completed'` (a nie
`'abandoned'`), aby wyszukiwanie porzuconych koszyków nie wysłało później zbędnego powiadomienia.

## Wyszukiwanie porzuconych koszyków

`cart-abandonment-worker.ts` udostępnia zwykłą funkcję asynchroniczną `sweep(now?)`, wzorowaną na
`RfqExpiryWorker`. Przebieg:

1. Odczytuje `carts.abandonment.inactivity_minutes` (≤ 0 wyłącza wyszukiwanie).
2. Wybiera koszyki `active`, w których `last_activity_at < now - threshold` ORAZ
   `abandonment_notified_at IS NULL` (idempotencja).
3. Ustawia status `abandoned` i zapisuje `abandonment_notified_at = now`.
4. Zapisuje jeden wiersz `cart_audit_entries.abandonment_swept` dla każdego zmienionego koszyka.
5. Wysyła e-mail do skonfigurowanego odbiorcy **tylko** dla niepustych koszyków (puste koszyki
   zmieniają status, ale zgodnie ze specyfikacją nie wywołują powiadomienia).
6. Błędy wysyłki powiadomień nie cofają zmiany statusu.

Przywrócenie: każda aktywność kupującego (otwarcie strony, dodanie, usunięcie, zmiana ilości, kupon)
w koszyku `abandoned` przywraca go do `active` i czyści `abandonment_notified_at`, aby następny cykl
porzucenia mógł ponownie wysłać powiadomienie.

## Zamiany

- **Koszyk → zapytanie ofertowe**: korzysta z `RfqService.createForCustomer`; zapisane w koszyku ceny
  jednostkowe kupującego są przenoszone jako `desired_unit_price`, aby dział sprzedaży widział cenę
  z koszyka. Pozycje koszyka źródłowego są usuwane, a koszyk przechodzi w stan `'completed'` z
  ustawionym `converted_to_quote_request_id`.
- **Zapytanie ofertowe → koszyk**: przechodzi przez pozycje zapytania i wywołuje
  `CartService.addItem`, które już wyznacza ceny przez `PricingService`. `desired_unit_price` z
  zapytania jest celowo pomijane — źródłem prawdy są bieżące ceny kontraktowe kupującego. Pozycje
  niedostępne, bez ceny albo niemożliwe do kupienia są pomijane i zwracane w `droppedLines[]` z
  typowanym powodem.
- **Zaakceptowane zapytanie ofertowe → koszyk** (`POST
  /api/v1/quote-requests/:id/convert-to-order`, należy do modułu zapytań ofertowych): koszyk jest
  czyszczony i wypełniany pozycjami zapytania w **uzgodnionych** cenach jednostkowych przez
  `CartWritePort.replaceItemsForCustomer`, a w `source_quote_request_id` zapamiętuje zapytanie, z
  którego został wypełniony. Oznaczenie towarzyszy uzgodnionym cenom: dodanie pozycji, usunięcie
  jednej z nich albo zmiana ilości zachowuje jedno i drugie; usunięcie ostatniej pozycji albo
  ponowne wypełnienie koszyka z innego źródła (ponowne zamówienie) usuwa oznaczenie, a zamówienie
  tworzone dla klienta przez administratora zaczyna nowy koszyk bez niego. Moduł zamówień odczytuje je przy składaniu zamówienia i
  rozstrzyga, czy zamówienie może zapisać to zapytanie. Opisana wyżej kopia z ponowną wyceną nie
  ustawia oznaczenia.
- **Lista zakupów → koszyk**: przekazywane do istniejącego `ShoppingListService.convertToCart`; moduł
  koszyków udostępnia port, który kompozycja do niego podłącza.

## Stosowanie kuponu

Moduł koszyków nigdy nie zawiera logiki promocji — przekazuje kod kuponu kupującego do
`PromotionService.applyToCart(snapshot)`. Metoda `CartCouponService.apply(cart, code)`:

1. Wyszukuje wiersz `Promotion` o podanej nazwie.
2. Wykonuje lokalne sprawdzenia wstępne (czy istnieje, okres ważności, zgodność organizacji, minimalna
   wartość koszyka) i przy pierwszym niespełnionym zwraca typowany `CouponDropReason`.
3. Gdy sprawdzenia przejdą, wywołuje `applyToCart` i weryfikuje, że wskazana promocja jest w zwróconym
   `appliedPromotions[]`.
4. Po powodzeniu: zapisuje `cart.applied_promotion_code = code`, zapisuje w audycie
   `coupon_applied` i w razie potrzeby ponownie wymaga akceptacji.
5. Przy każdym niepowodzeniu: zwraca `{outcome: 'dropped', reason, shortfall?}` i nie zmienia
   koszyka.

`reevaluateOnRead(cart, items)` ma być wywoływane przy odczycie koszyka (GET), aby wcześniej
zastosowany kod, który przestał pasować (np. wartość koszyka spadła poniżej minimum po usunięciu
pozycji), był po cichu usuwany, a odpowiedź zawierała `couponDroppedThisRead`. Podłączenie tego do
odczytu to zmiana na później.

## Punkty rozszerzenia

- **Ponowne wyznaczanie cen przy odczycie** — `CartPricingRecompute` i `CartRecomputeCache` (TTL 30 s
  w Redis) istnieją i są przetestowane, ale nie są jeszcze podłączone do `GET /api/v1/cart`; dziś
  zwracana jest zapisana wartość `unit_price`.
- **Wysyłka e-maili** — e-maile o przekazaniu do akceptacji, akceptacji, odrzuceniu i porzuceniu są
  przygotowane w usługach jako szkielet; osobne szablony to zmiana na później.
- **Harmonogram wyszukiwania porzuconych koszyków** — worker jest tworzony w produkcyjnej kompozycji,
  ale nie jest jeszcze podłączony do crona ani harmonogramu BullMQ. Polecenie
  `pnpm --filter backend run cart:abandonment-sweep` uruchamia jeden przebieg ręcznie. To polecenie
  zadeklarowane w manifeście, które uruchamia host, więc przebieg korzysta z `cartAbandonmentWorker`
  z kompozycji — implementacja jest w
  `packages/modules/carts/src/backend/cli/abandonment-sweep.ts`, a deklaracja w eksporcie
  `cliCommands` w `packages/modules/carts/src/manifest.ts`.

## Przechowywanie historii zmian

`cart_audit_entries` to **dziennik działań w każdym koszyku** (dodanie i usunięcie pozycji, zmiana
ilości, zastosowanie, usunięcie lub odrzucenie kuponu, przekazanie do akceptacji, akceptacja,
odrzucenie, oznaczenie jako porzucony, zamiana na zapytanie ofertowe i z niego, zamiana z listy
zakupów). Każdy wiersz trafia też do wspólnej tabeli `audit_log_entries` przez
`CartAuditService.record`, więc tabela koszyków to kanoniczny, zdenormalizowany widok, z którego
korzystają panele „Historia koszyka” administratora organizacji i administratora platformy.

Zasady przechowywania:

- **Nigdy nie usuwaj automatycznie `cart_audit_entries`.** Administratorzy organizacji i platformy
  potrzebują pełnej historii, aby uzasadniać decyzje o akceptacji i odtwarzać przebieg sporów z
  kupującymi. Do tabeli można tylko dopisywać — usługi nigdy nie wykonują na jej wierszach `UPDATE`
  ani `DELETE`.
- **Kaskada przy usunięciu koszyka.** `cart_audit_entries.cart_id` ma `ON DELETE CASCADE`. Obecnie na
  produkcji koszyków się nie usuwa; jeśli przyszły proces RODO (prawo do usunięcia danych) będzie to
  robił, historia zostanie usunięta razem z koszykiem. Gdy taki proces powstanie, *przed* uruchomieniem
  kaskady skopiuj wiersz koszyka i jego wpisy audytu do długoterminowej tabeli archiwum — nie trać
  historii po cichu.
- **Produkcyjne czyszczenie danych MUSI pomijać `cart_audit_entries`.** Każde zaplanowane zadanie,
  które usuwa koszyki, konta klientów albo organizacje, by odchudzić bazę, MUSI albo pomijać
  `cart_audit_entries`, albo najpierw je zarchiwizować. Recenzenci: gdy powstaną zasady przechowywania
  w `packages/modules/audit_logs/src/backend/retention-policy.ts`, dodajcie tę tabelę do listy
  wyjątków.
- **Wspólna tabela `audit_log_entries` podlega zasadom przechowywania modułu audit_logs** (ustalanym
  poza tą funkcją). Kopie wpisów po stronie koszyków w `cart_audit_entries` pozostają źródłem prawdy
  dla ekranów koszyków, nawet gdy wpisy we wspólnej tabeli zostaną już usunięte.

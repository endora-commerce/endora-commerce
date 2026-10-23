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

## Jeden koszyk na sklep

Koszyk należy do kanału sprzedaży — sklepu — w którym jest używany:

- Powstaje w kanale żądania, które go tworzy, i zapamiętuje ten kanał (`salesChannelId`). Każdy
  odczyt i zapis koszyka dotyczy koszyka kanału żądania, więc klient kupujący w dwóch sklepach ma
  koszyk w każdym z nich; token koszyka niezalogowanego odwiedzającego wskazuje koszyk tylko w jednym
  sklepie, a napełnianie koszyka w innym sklepie zaczyna nowy.
- Ceny pozycji, promocje i kupony oraz to, czy produkt jest sprzedawany tylko na zapytanie, są
  ustalane dla kanału koszyka — cena widoczna w koszyku sklepu to cena tego sklepu.
- Łączenie przy logowaniu łączy tylko koszyk anonimowy ze sklepu, w którym klient się loguje; koszyk
  napełniony w innym sklepie pozostaje bez zmian.
- Złożenie zamówienia korzysta z koszyka kanału zamówienia. Koszyk innego kanału jest odrzucany z
  `422 ORDER_SALES_CHANNEL_MISMATCH` — *„Twój koszyk należy do innego sklepu. Otwórz koszyk w tym
  sklepie i złóż zamówienie ponownie.”* — zanim cokolwiek zostanie zarezerwowane lub zapisane;
  koszyk zostaje zachowany i nie jest ponownie wyceniany.

Gdy koszyki zaczęły zapamiętywać swój kanał, każdy koszyk bez kanału został przypisany do
domyślnego kanału systemowego.

Reguła dostępu do kanału dotyczy koszyków jak każdego wywołania storefrontu: niezalogowany
odwiedzający nie ma koszyka w sklepie zamkniętym dla niezalogowanych odwiedzających, a klient nie ma
go w sklepie, do którego jego organizacja nie jest przypisana.

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
| `GET /api/v1/cart` | Aktywny koszyk kanału sprzedaży żądania (tworzony przy pierwszym odczycie); odpowiedź zawiera `status`, `approvalStatus`, `salesChannelId`, `grandTotal`, `discount`, `primaryCta`, `droppedLines`, `couponDroppedThisRead`, `lastActivityAt` |
| `POST /api/v1/cart/items` | Dodanie pozycji (limit 200 pozycji) |
| `PATCH /api/v1/cart/items/:itemId` | Zmiana ilości (`0` usuwa pozycję) |
| `DELETE /api/v1/cart/items/:itemId` | Usunięcie pozycji |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | Przeniesienie pozycji na listę zakupów |
| `POST /api/v1/cart/touch` | Jawny sygnał otwarcia strony; aktualizuje `last_activity_at` i przywraca porzucony koszyk |
| `GET /api/v1/cart/upsells?limit=N` | Pasek droższych zamienników z `product_links` katalogu (kind = `up_sell`) |
| `POST /api/v1/cart/coupon` | Zastosowanie (albo zamiana, albo usunięcie) aktywnego kodu kuponu; przy odrzuceniu 422 `CART_COUPON_REJECTED` z powodem |
| `DELETE /api/v1/cart/coupon` | To samo co `POST {code: null}` |
| `POST /api/v1/cart/convert-to-quote-request` | Koszyk → zapytanie ofertowe; koszyk źródłowy przechodzi w stan `completed` z ustawionym `converted_to_quote_request_id` |
| `POST /api/v1/cart/from-quote-request/:qrId` | Zapytanie ofertowe → koszyk; ceny pozycji są wyznaczane ponownie według bieżących cen klienta |
| `POST /api/v1/cart/from-shopping-list/:listId` | Lista zakupów → koszyk; ceny są wyznaczane ponownie |

### Storefront (administrator organizacji)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/organization/carts` | Lista wszystkich koszyków w organizacji wywołującego |
| `GET /api/v1/organization/carts/:id` | Szczegóły koszyka członka organizacji |
| `PATCH /api/v1/organization/policies/cart-approval` | Włączenie lub wyłączenie `requires_cart_approval` dla organizacji |
| `POST /api/v1/cart/submit-for-approval` | Kupujący przekazuje koszyk do akceptacji administratorowi organizacji (nic nie robi, gdy akceptacja jest wyłączona; odrzucane dla samych administratorów organizacji oraz dla koszyka poniżej minimum — zob. *Minimalne ilości zamówienia*) |
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
- `CartItem` (pozycja z ceną `unit_price` — ceną, po której pozycja jest zamawiana — zapamiętanymi
  kolumnami `recomputed_*` oraz kolumnami `agreed_*` pozycji wypełnionej z zaakceptowanego zapytania
  ofertowego).
- `CartAuditEntry` (typowana historia zmian każdego koszyka; indeks na `(cart_id, occurred_at DESC)`).
  Każda zmiana stanu trafia też do istniejącej tabeli `audit_log_entries` przez `AuditPort`, na
  wspólną oś czasu audytu platformy.

## Ceny pozycji

Pozycja koszyka jest zamawiana po zapisanej cenie `unit_price`, dlatego ta cena jest zawsze ceną dla
**bieżącej** ilości pozycji:

- Dodanie produktu, dodanie kolejnych sztuk produktu, który już jest w koszyku, zmiana ilości pozycji,
  łączenie koszyka anonimowego przy logowaniu i wypełnienie koszyka na podstawie dawnego zamówienia
  (ponowne zamówienie) zapisują cenę dla ilości wynikowej — próg ilościowy cennika dotyczy ilości,
  która jest faktycznie zamawiana.
- Cena pochodzi z cenników (moduł `price_lists`) — dla produktu **i wariantu** pozycji, w kanale
  sprzedaży koszyka, dla kupującego koszyka: cena bazowa, cena katalogowa dla wszystkich w kanale,
  cena organizacji lub grupy klientów kupującego oraz cena promocyjna, gdy jest niższa. Innego
  źródła nie ma: pozycji, której nie wycenia żaden cennik, nie można zamówić i jest odrzucana z
  kodem `422 CART_PRODUCT_UNPRICED` — kupujący może zamiast tego poprosić o ofertę. Produkt
  sprzedawany wyłącznie na zapytanie jest odrzucany z kodem `400 CART_PRODUCT_QUOTE_ONLY`.
- Pozycja wypełniona z zaakceptowanego zapytania ofertowego zachowuje uzgodnioną cenę tylko przy
  uzgodnionej ilości. Przy każdej innej ilości jest wyceniana z cenników, a po powrocie do
  uzgodnionej ilości odzyskuje uzgodnioną cenę.
- Każda pozycja zapisuje w `price_source`, **skąd pochodzi jej cena**: `agreed` (cena uzgodniona w
  ofercie), `base`, `catalogue`, `buyer` albo `sale` (krok wyceny w cennikach, który ją ustalił);
  na pozycji wycenionej przed wprowadzeniem cenników pole ma wartość `null`. Złożenie zamówienia
  kopiuje je na pozycję zamówienia.
- `GET /api/v1/cart` pokazuje każdą pozycję w cenie, którą teraz naliczyłoby złożenie zamówienia,
  tym samym łańcuchem, a pozycję, którą złożenie zamówienia by odrzuciło, pokazuje jako niedostępną.
- Przy składaniu zamówienia moduł zamówień pyta ten moduł, czy każda zapisana cena jest nadal
  aktualna. Jeśli któraś nie jest — zwykle dlatego, że cennik zmienił się po dodaniu pozycji —
  złożenie zamówienia jest odrzucane z kodem
  `409 CART_PRICE_CHANGED` (`details.lines` wymienia każdą taką pozycję z poprzednią i bieżącą ceną
  jednostkową), ceny w koszyku są aktualizowane, a kupujący sprawdza koszyk przed ponownym złożeniem
  zamówienia.

**Dla programistów.** Cały łańcuch to jedna funkcja, `CartLinePricing.orderablePrices`
(`src/backend/services/cart-line-pricing.ts` w tym module): cena uzgodniona przy
uzgodnionej ilości, w przeciwnym razie cenniki — jednym zbiorczym wywołaniem `resolveLinePrices` dla
wszystkich pozycji koszyka (z `variantId` każdej pozycji) — a w przeciwnym razie nic. Wywołują ją
dodawanie, łączenie, zmiana ilości, odczyt koszyka (`CartPricingRecompute`) i kontrola przy
składaniu zamówienia, więc cena, którą kupujący widzi w koszyku, jest ceną, którą nalicza złożenie
zamówienia — pilnuje tego `backend/test/integration/carts/cart-read-equals-placement.test.ts`.

## Ustawienia

| Klucz | Wartość domyślna | Opis |
| --- | --- | --- |
| `carts.abandonment.inactivity_minutes` | `10080` (7 dni) | Liczba minut bez aktywności, po których koszyk `active` jest uznawany za `abandoned`. `0` wyłącza wyszukiwanie porzuconych koszyków. |
| `carts.abandonment.notification_recipient` | `` (puste) | Adres e-mail, na który trafia powiadomienie o porzuconym koszyku. Puste = bez e-maila (status i tak się zmienia). |

Ustawienia tworzy przy starcie backendu ManifestReconciler cyklu życia modułów (zobacz
`packages/modules/carts/src/manifest.ts`).

## Łączenie koszyków przy logowaniu

`cart-service.ts#mergeAnonymousIntoCustomer()` jest wywoływane przez hook `onLogin` modułu
`organizations`. Ilości powtarzających się pozycji są sumowane, a pozycje zsumowane i przeniesione
otrzymują cenę, po której klient może je zamówić; ciasteczko koszyka anonimowego jest unieważniane w
tej samej operacji. Anonimowy koszyk źródłowy dostaje `status` `'completed'` (a nie
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
  jednostkowe kupującego są przekazywane jako **cena referencyjna** każdej pozycji
  (`options.lineReferencePrices`, zapisywana w polach `reference_unit_price` / `reference_currency`
  pozycji zapytania), a nie jako propozycja klienta: pozycje powstałego zapytania mają
  `desired_unit_price = null`, więc zamiana działa także dla klienta, który nie może proponować cen.
  Dział sprzedaży widzi cenę z koszyka jako *cenę z dnia zapytania* pozycji na ekranie zapytania
  ofertowego w panelu administracyjnym. Pozycje koszyka źródłowego są usuwane, a koszyk przechodzi
  w stan `'completed'` z ustawionym `converted_to_quote_request_id`. Pozycja w jednostce opakowania
  jest wysyłana z jej `packagingUnitId`; pozycja, której jednostkę w międzyczasie usunięto, jest
  wysyłana jako zwykłe sztuki, z niezmienioną liczbą sztuk.
- **Zapytanie ofertowe → koszyk**: dodaje pozycje zapytania jedną partią
  (`CartService.addItems`, zob. *Minimalne ilości zamówienia* niżej), wyceniane z cenników jak
  każda inna pozycja. `desired_unit_price` z zapytania jest celowo pomijane — źródłem prawdy są
  bieżące ceny kontraktowe kupującego. Pozycje niedostępne, bez ceny albo niemożliwe do kupienia są
  pomijane i zwracane w `droppedLines[]` z typowanym powodem; pozycja poniżej minimum produktu jest
  pomijana z powodem `below_minimum` i swoim `minimum` (wcześniej zgłaszano ją jako
  `no_price_in_customer_list`), a produkt, którego kupujący już nie widzi — z powodem
  `not_purchasable`.
- **Zaakceptowane zapytanie ofertowe → koszyk** (`POST
  /api/v1/quote-requests/:id/convert-to-order`, należy do modułu zapytań ofertowych): koszyk jest
  czyszczony i wypełniany pozycjami zapytania w **uzgodnionych** cenach jednostkowych przez
  `CartWritePort.replaceItemsForCustomer`, a w `source_quote_request_id` zapamiętuje zapytanie, z
  którego został wypełniony. Każda pozycja pamięta ilość, dla której uzgodniono jej cenę, i zachowuje
  uzgodnioną cenę tylko przy tej ilości (zobacz *Ceny pozycji*). Dodanie pozycji, usunięcie jednej z
  nich albo zmiana ilości zachowuje oznaczenie; usunięcie ostatniej pozycji albo
  ponowne wypełnienie koszyka z innego źródła (ponowne zamówienie) usuwa oznaczenie, a zamówienie
  tworzone dla klienta przez administratora zaczyna nowy koszyk bez niego. Moduł zamówień odczytuje je przy składaniu zamówienia i
  rozstrzyga, czy zamówienie może zapisać to zapytanie. Opisana wyżej kopia z ponowną wyceną nie
  ustawia oznaczenia.
- **Lista zakupów → koszyk**: przekazywane do istniejącego `ShoppingListService.convertToCart`; moduł
  koszyków udostępnia port, który kompozycja do niego podłącza.

## Minimalne ilości zamówienia

Koszyk stosuje minimalne ilości zamówienia z katalogu — minimum produktu w sztukach i minimum
każdej jednostki opakowania w jednostkach, liczone ze wszystkich pozycji produktu w koszyku (oba
definiuje strona modułu Catalog).

- **Dodanie i edycja** (`POST /api/v1/cart/items`, `PATCH /api/v1/cart/items/:itemId`) oceniają
  koszyk w stanie, w jakim zostawiłaby go zmiana — po dotychczasowych sprawdzeniach ilości,
  produktu, kanału i jednostki opakowania, a przed wyceną. Zmiana, która zostawia pozycję poniżej
  minimum, jest odrzucana z kodem `422 PRODUCT_BELOW_MINIMUM_QUANTITY` albo
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`; komunikat w języku odpowiedzi (z nagłówka
  `Accept-Language` żądania, z uwzględnieniem wag q, a w przeciwnym razie w domyślnym języku
  kanału) podaje produkt i minimum, a nic nie jest zapisywane. Edycja do `0` i `DELETE` zawsze usuwają pozycję. Edycja
  pozycji, której produkt już nie istnieje, kończy się `404 PRODUCT_NOT_FOUND`.
- **Widok koszyka** (`GET /api/v1/cart`) podaje dla każdej pozycji `minOrderQuantity` (minimum
  produktu w sztukach, `null`, gdy go nie ma) i `belowMinimum` (`{ kind, minimum,
  packagingUnitName? }`, gdy pozycja jest poniżej minimum i nie jest z niego zwolniona, w
  przeciwnym razie `null`); storefront oznacza taką pozycję i blokuje checkout. Pozycja, której
  rekord produktu zniknął, jest zgłaszana jako `unavailable: true` z
  `unavailableReason: 'not_purchasable'`. **Jeśli katalogu nie da się odczytać, widok kończy się
  błędem `5xx`**, zamiast zwrócić koszyk bez tych oznaczeń. Widok skrócony (`?view=mini`) się nie
  zmienia.
- **Dodawanie partiami** — zapytanie ofertowe → koszyk, lista zakupów → koszyk, szybkie zamówienie
  oraz tworzenie zamówienia przez administratora i przez zewnętrzne API — przechodzi przez
  `CartWritePort.addItems`. Najpierw rozstrzyga każdą pozycję tymi samymi sprawdzeniami co
  pojedyncze dodanie: pozycja, której produkt jest nieznany, ukryty przed kupującym albo spoza
  kanału, dostaje odpowiedź „nieznany produkt”, bez nazwy i bez minimum. Potem ocenia rozstrzygnięte
  pozycje razem z koszykiem — pozycje jednego produktu w partii są sumowane, więc
  `A-red × 5 + A-blue × 5` spełnia minimum 10 — i dodaje tylko te, które przechodzą, zgłaszając
  pozostałe. Pozycje już obecne w koszyku nigdy nie są odrzucane. Wywołujący, który prosi o
  `throw`, dostaje teraz błąd **zanim cokolwiek zostanie dodane**, gdy pozycji nie da się
  rozstrzygnąć; ten, który prosi o `report`, dostaje każdą porażkę jako wynik. Wywołujący może też
  poprosić, by pozycja poniżej minimum odrzucała całą partię, zanim cokolwiek zostanie zapisane, a —
  dla klienta — by partia zastąpiła koszyk, który jest wtedy czyszczony dopiero po pozytywnej ocenie
  partii: w ten sposób tworzenie zamówienia przez administratora i zewnętrzne API zamówień zostawiają
  koszyk klienta nienaruszony, gdy odrzucają żądanie. Przed tym wyczyszczeniem partia, która ma
  zgłaszać błąd przy nieudanej pozycji, wycenia też każdą pozycję, którą zamierza zapisać, więc
  produkt bez ceny albo sprzedawany wyłącznie na zapytanie odrzuca żądanie, a koszyk pozostaje
  nienaruszony. Najwyżej 200 pozycji na wywołanie.
- **Koszyk wypełniony z zaakceptowanego zapytania ofertowego** zachowuje wynegocjowane ilości
  zapytania: każda pozycja wypełniona z zapytania jest zwolniona z minimów, **dopóki jej ilość
  równa się ilości z zapytania** dla tej pozycji — ilości, przy której obowiązuje uzgodniona cena
  (`cart_items.agreed_quantity`). Zmiana ilości
  czyni ją zwykłą pozycją, dopóki ilość nie wróci do wartości z zapytania, co jest dozwolone nawet
  poniżej minimum. Pozycje dodane później są sprawdzane jak zwykle, a sztuki pozycji zwolnionej
  nadal liczą się do łącznej ilości produktu, gdy sprawdzana jest inna pozycja tego produktu.
  Koszyk przyjmuje oznaczenie zapytania na koszyku bez weryfikacji; checkout i składanie zamówienia
  potwierdzają, że zapytanie jest nadal ważne (strona modułu Orders). Ponowne wypełnienie koszyka —
  z innego zapytania albo przez ponowne zamówienie — zastępuje je, a wraz z nim każde wcześniejsze
  zwolnienie.
- **Przekazanie do akceptacji** (`POST /api/v1/cart/submit-for-approval`) odrzuca koszyk, którego
  nie dałoby się zamówić, po dotychczasowych odmowach tego punktu końcowego: pozycja, której rekord
  produktu zniknął, kończy się `404 PRODUCT_NOT_FOUND` z `cartItemIds` każdej takiej pozycji;
  pozycja poniżej minimum kończy się `422 PRODUCT_BELOW_MINIMUM_QUANTITY` albo
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, z każdą naruszającą pozycją w `details.lines` wraz z
  jej `cartItemId`, w języku odpowiedzi. Nic nie jest zapisywane, a koszyk pozostaje w stanie
  `not_required`. Inaczej niż widok koszyka, przekazanie nie przyjmuje oznaczenia zapytania bez
  weryfikacji: pozycja wypełniona z zapytania jest zwolniona dopiero wtedy, gdy moduł Orders
  potwierdzi, że zapytanie jest nadal ważne — należy do organizacji kupującego, ma status
  `Approved`, nie wygasło, nie zostało jeszcze zamówione, a w koszyku jest nadal uzgodniona
  pozycja — tym samym sprawdzeniem, które wykonuje podgląd checkoutu. Gdy moduł Quote Requests jest
  wyłączony, nic nie jest zwolnione. Koszyk, którego zapytanie straciło ważność, jest więc
  odrzucany przy przekazaniu, choć widok go nie oznacza; storefront pokazuje komunikat odmowy.

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

- **Ponowne wyznaczanie cen przy odczycie** — `GET /api/v1/cart` wycenia każdą pozycję przez
  `CartPricingRecompute`, który wywołuje `CartLinePricing.orderablePrices`; wynik jest przechowywany
  w `CartRecomputeCache` (TTL 30 s w Redis), unieważnianym przy każdym zapisie koszyka. Odpowiedzi
  operacji zmieniających koszyk zwracają zapisaną wartość `unitPrice`.
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

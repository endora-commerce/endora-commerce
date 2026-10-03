---
sidebar_position: 2
title: Dostęp partnerski do API
---

# Dostęp partnerski do API (`/api/v1/external/*`)

Ta strona opisuje partnerskie API HTTP platformy: osobną przestrzeń `/api/v1/external/*`. To
**jedyna** przestrzeń przeznaczona dla partnerów zewnętrznych (dystrybutorów, resellerów, systemów
zakupowych) i jedyna część dokumentu OpenAPI na żywo (`GET /api/v1/_openapi.json`), która jest
dokumentowana dla partnerów. Publiczne endpointy storefrontu (`/api/v1/catalog/…`) i endpointy sesji
klienta (`/api/v1/orders…`) nie są API partnerskim — całkowicie ignorują klucze API.

## Uwierzytelnianie

Każde żądanie do `/api/v1/external/*` musi zawierać token bearer klucza API:

```http
GET /api/v1/external/catalog/products?limit=50 HTTP/1.1
Host: api.example.com
Authorization: Bearer sk_live_REDACTED
```

- Żądania anonimowe dostają `401 UNAUTHORIZED`.
- Klucze unieważnione i **wygasłe** wszędzie dostają `401 UNAUTHORIZED`.
- Klucz bez wymaganego zakresu dostaje `403 API_KEY_OUT_OF_SCOPE` (zapisywane w audycie).

Klucze tworzy się w **Panel administracyjny → API Keys**. Token jest pokazywany tylko raz, przy
utworzeniu; przechowywany jest wyłącznie jego skrót SHA-256.

## Dwa rodzaje kluczy

| | Klucz niepowiązany | Klucz powiązany |
|---|---|---|
| Tożsamość | Dane uwierzytelniające platformy (kontekst systemowy) | Działa **w imieniu jednej organizacji**, w jednym przypiętym kanale sprzedaży, przez wskazane techniczne konto klienta |
| Typowe zastosowanie | Synchronizacja PIM, generowanie feedów | Integracja dystrybutora: katalog z cenami organizacji, składanie zamówień |
| Odczyty katalogu | Ceny domyślne kanału; kanał z nagłówka `X-Sales-Channel`, hosta albo domyślny | Ceny obowiązujące organizację, dostępność i progi ilościowe; zawsze powiązany kanał |
| Ceny hurtowe / zamówienia | Odmowa (`403 API_KEY_NOT_BOUND`) | Dozwolone z odpowiednim zakresem |
| Dozwolone zakresy | `catalog:read`, `catalog:write` | `catalog:read`, `orders:read`, `orders:write` (`catalog:write` jest zabronione dla kluczy powiązanych) |
| Ważność | Opcjonalne `expiresAt` | Opcjonalne `expiresAt` |

Powiązania (organizacja, kanał sprzedaży i techniczne konto klienta) **nie można zmienić** po
utworzeniu — aby powiązać klucz inaczej, unieważnij go i utwórz nowy. Reguły tworzenia opisuje
[dokumentacja modułu `api_keys`](../modules/api_keys.md).

### Katalog zakresów

| Zakres | Klucz niepowiązany | Klucz powiązany |
|---|---|---|
| `catalog:read` | Odczyty zewnętrznego API katalogu (ceny domyślne kanału) i odczyty zestawów atrybutów PIM | Odczyty zewnętrznego API katalogu (ceny organizacji) i ceny hurtowe |
| `catalog:write` | Zapis produktu w PIM według SKU | Nie można przyznać (reguła tworzenia) |
| `orders:read` | Nie można przyznać bez powiązania | Lista i szczegóły zamówień przez zewnętrzne API |
| `orders:write` | Nie można przyznać bez powiązania | Składanie zamówień przez zewnętrzne API |

### Przypięcie kanału (klucze powiązane)

Klucz powiązany zawsze działa w powiązanym kanale sprzedaży. Nagłówek `X-Sales-Channel` wskazujący
**inny** kanał jest odrzucany z `403 API_KEY_CHANNEL_MISMATCH` (i zapisywany w audycie). Gdy
powiązany kanał jest nieaktywny, żądania są odrzucane standardowym błędem nieaktywnego kanału — bez
przełączania na inny kanał.

## Zasada dotycząca pamięci podręcznej (wiążąca)

Każda odpowiedź z `/api/v1/external/*` ma nagłówek:

```http
Cache-Control: private, no-store
```

Odpowiedzi zależą od danych uwierzytelniających (ceny organizacji, dane zamówień) i nigdy nie wolno
ich umieszczać we współdzielonej ani trwałej pamięci podręcznej. Nie przechowuj ich po swojej stronie
dłużej niż trwa żądanie, które je zwróciło; pobieraj je ponownie.

## Odczyty katalogu

Wymagany zakres: `catalog:read`.

- `GET /api/v1/external/catalog/products` — lista stronicowana (`limit` 1–100, `cursor`), filtry
  `categorySlug`, `q` i `changedSince` (ISO 8601). Zwracana deterministycznie z PostgreSQL
  (`x-search-backend: postgres`).
- `GET /api/v1/external/catalog/products/:idOrSlug` — szczegóły; dla kluczy powiązanych zawierają
  `priceTiers` (progi ilościowe organizacji).
- `GET /api/v1/external/catalog/categories` — drzewo kategorii wyznaczonego kanału.

Wywołujący z kluczem powiązanym widzą opublikowany asortyment powiązanego kanału dokładnie tak jak
storefront; produkty wykluczone z kanału nie występują, a ich adresy szczegółów zwracają `404` — tak
samo jak dla nieistniejących. Pozycje zwracane dla klucza powiązanego zawierają dodatkowo:

- `price` — cenę jednostkową obowiązującą organizację przy ilości 1, obliczoną tym samym
  mechanizmem cen co w koszyku (`null`, gdy nie da się jej wyznaczyć);
- `priceUnavailable: true` — znacznik, gdy nie udało się wyznaczyć ceny organizacji;
- `availability` — `{ band, inStock }`.

### Synchronizacja przyrostowa z `changedSince`

Przy pełnym eksporcie przechodź przez strony z `cursor`, aż się skończą. Przy synchronizacji
przyrostowej pytaj z `changedSince=<początek ostatniej udanej synchronizacji>`. Zawsze stosuj
nakładające się okna: zapisz znacznik czasu **przed** rozpoczęciem synchronizacji i przekaż go w
następnym przebiegu, aby nie pominąć zmian dokonanych w trakcie przebiegu. Usuwaj duplikaty według
identyfikatora produktu.

## Ceny hurtowe

Wymagany zakres: `catalog:read`, **tylko klucze powiązane**.

```http
POST /api/v1/external/catalog/prices
{ "lines": [ { "sku": "SKU-1", "quantity": 10 }, … ] }   // 1–200 lines
```

Odpowiedź zachowuje kolejność pozycji. Każda pozycja ma albo cenę (`amount`, `currency`, `isSale`,
`bracketStartQuantity`, `priceListId`), albo `price: null` z `reason` równym
`sku_not_in_assortment` lub `price_unavailable`. Braki w pojedynczych pozycjach to dane, a nie
błędy — zawsze dostajesz odpowiedź dla całego zestawu. Ponad 200 pozycji to `422 VALIDATION_FAILED`.

Gwarancja: dla dowolnej pary `(sku, quantity)` zwrócona kwota jest równa, co do grosza, kwocie, którą
koszyk i składanie zamówienia naliczyłyby powiązanej organizacji w powiązanym kanale przy tej ilości.

## Idempotentne składanie zamówień

Wymagany zakres: `orders:write`, tylko klucze powiązane.

```http
POST /api/v1/external/orders
Idempotency-Key: acme-order-1001
{
  "lines": [ { "sku": "SKU-1", "quantity": 10 } ],
  "deliveryMethodId": "…", "paymentMethodId": "…",
  "deliveryAddressId": "…", "billingAddressId": "…",
  "customerReference": "PO-2026-0042"
}
```

- Nagłówek `Idempotency-Key` (1–128 znaków) jest **wymagany**; jego brak ⇒
  `422 IDEMPOTENCY_KEY_REQUIRED`.
- Ponowne wysłanie tego samego klucza z tą samą treścią — także równoległe — zwraca **to samo
  zamówienie** (`200`); zawsze powstaje dokładnie jedno zamówienie.
- Ponowne użycie klucza z **inną** treścią ⇒ `409 IDEMPOTENCY_KEY_REUSED`.
- Adresy: podaj identyfikatory istniejących adresów organizacji albo obiekty `deliveryAddress` /
  `billingAddress` bezpośrednio w treści.
- Odrzucenie pojedynczych pozycji daje odpowiedź `422` dla całego zamówienia, z problemem przy
  każdej pozycji (`SKU_NOT_IN_ASSORTMENT`, `PRICE_UNAVAILABLE`); nic nie zostaje zapisane.
- Odpowiedź po powodzeniu (`201`) to standardowa struktura zamówienia — taka sama jak w sesjach
  klientów. Zamówienia można śledzić przez `GET /api/v1/external/orders` i
  `GET /api/v1/external/orders/:id` (`orders:read`); identyfikatory spoza zakresu widoczności zwracają
  `404`.

### Granice możliwości organizacji

Klucz powiązany nigdy nie może zrobić więcej niż kupujący z danej organizacji. Zamówienie składa ta
sama ścieżka kodu domenowego, więc każda reguła działa identycznie: zawieszona organizacja ⇒ `423`;
metoda płatności albo dostawy spoza listy dozwolonych dla organizacji ⇒ ta sama odmowa co w checkoucie
klienta; przekroczony limit kredytowy ⇒ ten sam błąd zabezpieczenia limitu; minimalna wartość
zamówienia, asortyment, strategia magazynowa i automatyczne promocje działają dokładnie tak jak w
storefroncie. Nie ma parametru, który by to nadpisywał lub omijał.

## Webhooki (ograniczone do organizacji)

Zdarzenia zamówień są wysyłane do subskrypcji webhooków (transport, weryfikację HMAC i zasady
ponawiania opisuje [przegląd integracji](./README.md)). Dla partnerów istotne są dwa fakty:

- Subskrypcję można **ograniczyć do jednej organizacji** (ustaw opcjonalną organizację w formularzu
  webhooka). Subskrypcje ograniczone do organizacji dostają tylko zdarzenia `order.created.v1` /
  `order.status_changed.v1` tej organizacji; subskrypcje obejmujące całą platformę (bez organizacji)
  dostają wszystkie. Zdarzenie bez przypisanej organizacji nigdy nie trafia do subskrypcji
  ograniczonej do organizacji (w razie wątpliwości — odmowa).
- **Wysyłka już działa.** Subskrypcje webhooków zarejestrowane, zanim ta funkcja powstała, były
  przyjmowane, ale zdarzenia zamówień nie były wysyłane. Mechanizm wysyłki już działa: każda
  istniejąca subskrypcja zdarzeń `order.created.v1` lub `order.status_changed.v1` zacznie je
  otrzymywać. Przed aktualizacją upewnij się, że odbiorcy są idempotentni.

## Słownik błędów (API partnerskie)

| Kod | HTTP | Znaczenie |
|---|---|---|
| `UNAUTHORIZED` | 401 | Brak klucza albo klucz nieprawidłowy, unieważniony lub wygasły |
| `API_KEY_OUT_OF_SCOPE` | 403 | Kluczowi brakuje wymaganego zakresu (zapisywane w audycie) |
| `API_KEY_NOT_BOUND` | 403 | Endpoint tylko dla kluczy powiązanych wywołany kluczem niepowiązanym |
| `API_KEY_CHANNEL_MISMATCH` | 403 | Klucz powiązany wskazał inny kanał sprzedaży |
| `IDEMPOTENCY_KEY_REQUIRED` | 422 | Brak `Idempotency-Key` przy składaniu zamówienia |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Ten sam klucz idempotencji, inna treść |
| `SKU_NOT_IN_ASSORTMENT` | 422 (dla pozycji) | SKU nie występuje w asortymencie powiązanego kanału |
| `PRICE_UNAVAILABLE` | 422 (dla pozycji) | Nie da się wyznaczyć ceny dla organizacji |
| `STOCK_UNAVAILABLE` | 409 | Niewystarczający stan magazynowy przy składaniu zamówienia |
| `FORBIDDEN` (`organization_cannot_transact`) | 423 | Organizacja jest zawieszona albo nie może składać zamówień |

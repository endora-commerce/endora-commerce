---
sidebar_position: 2
title: Dostęp partnerski do API
---

# Dostęp partnerski do API (`/api/v1/external/*`)

Ta strona dokumentuje partnerską powierzchnię HTTP platformy: dedykowaną
przestrzeń `/api/v1/external/*`. To **jedyna** przestrzeń przeznaczona dla
partnerów zewnętrznych (dystrybutorzy, resellerzy, systemy zakupowe) oraz
partner-documentable zakres żywego dokumentu OpenAPI
(`GET /api/v1/_openapi.json`). Publiczne endpointy storefrontu
(`/api/v1/catalog/…`) i endpointy sesji klienta (`/api/v1/orders…`) nie są
powierzchniami partnerskimi — całkowicie ignorują poświadczenia klucza API.

## Uwierzytelnianie

Każde żądanie `/api/v1/external/*` musi nieść bearer token klucza API:

```http
GET /api/v1/external/catalog/products?limit=50 HTTP/1.1
Host: api.example.com
Authorization: Bearer sk_live_REDACTED
```

- Anonimowe żądania otrzymują `401 UNAUTHORIZED`.
- Unieważnione i **wygasłe** klucze otrzymują `401 UNAUTHORIZED` wszędzie.
- Klucz bez wymaganego scope otrzymuje `403 API_KEY_OUT_OF_SCOPE`
  (audytowane).

Klucze wydaje się w **Panel admina → API Keys**. Token jest pokazywany raz przy
utworzeniu; przechowywany jest tylko jego hash SHA-256.

## Dwa tryby klucza

| | Klucz niepowiązany | Klucz powiązany |
|---|---|---|
| Tożsamość | Poświadczenie platformowe (context system) | Działa **w imieniu jednej Organization** na jednym przypiętym Sales Channel przez wyznaczone service Customer Account |
| Typowy use case | Sync PIM, generowanie feedów | Integracja dystrybutora: katalog z cenami org, składanie zamówień |
| Odczyty katalogu | Ceny domyślne kanału; kanał z nagłówka `X-Sales-Channel` / hosta / domyślnego | Efektywne ceny Organization, dostępność i progi ilościowe; kanał zawsze powiązany |
| Hurtowe ceny / zamówienia | Odmowa (`403 API_KEY_NOT_BOUND`) | Dozwolone z pasującym scope |
| Dozwolone scope'y | `catalog:read`, `catalog:write` | `catalog:read`, `orders:read`, `orders:write` (`catalog:write` jest zabroniony na kluczach powiązanych) |
| Wygaśnięcie | Opcjonalne `expiresAt` | Opcjonalne `expiresAt` |

Powiązanie (Organization + Sales Channel + service Customer Account) jest
**niemutowalne** po utworzeniu — aby przepiąć, unieważnij klucz i wydaj nowy.
Zobacz [dokumentację modułu `api_keys`](../modules/api_keys.md) dla reguł tworzenia.

### Katalog scope'ów

| Scope | Klucz niepowiązany | Klucz powiązany |
|---|---|---|
| `catalog:read` | Zewnętrzne odczyty katalogu (ceny domyślne kanału) + odczyty PIM attribute-set | Zewnętrzne odczyty katalogu (ceny org) + hurtowe ceny |
| `catalog:write` | PIM upsert produktu po SKU | Nie nadawalny (reguła tworzenia) |
| `orders:read` | Nie nadawalny bez powiązania | Zewnętrzna lista/szczegół zamówienia |
| `orders:write` | Nie nadawalny bez powiązania | Zewnętrzne składanie zamówienia |

### Przypięcie kanału (klucze powiązane)

Powiązany klucz zawsze operuje na powiązanym kanale sprzedaży. Wysłanie nagłówka
`X-Sales-Channel` wskazującego **inny** kanał jest odrzucane z
`403 API_KEY_CHANNEL_MISMATCH` (i audytowane). Gdy powiązany kanał jest
nieaktywny, żądania fail-closed ze standardowym błędem nieaktywnego kanału — bez
fallbacku.

## Reguła cache'owania (normatywna)

Każda odpowiedź `/api/v1/external/*` niesie:

```http
Cache-Control: private, no-store
```

Odpowiedzi są per credential (ceny org, dane zamówień) i nigdy nie wolno ich
wstawiać do współdzielonego ani trwałego cache. Nie cache'uj ich po swojej stronie
poza życiem żądania, które je wyprodukowało; pobieraj ponownie.

## Odczyty katalogu

Brama: `catalog:read`.

- `GET /api/v1/external/catalog/products` — lista stronicowana (`limit` 1–100,
  `cursor`), filtry `categorySlug`, `q` oraz `changedSince` (ISO 8601).
  Serwowane deterministycznie z PostgreSQL (`x-search-backend: postgres`).
- `GET /api/v1/external/catalog/products/:idOrSlug` — szczegół; dla kluczy powiązanych
  zawiera `priceTiers` (drabina ilościowa Organization).
- `GET /api/v1/external/catalog/categories` — drzewo kategorii rozwiązanego kanału.

Wywołujący powiązani widzą opublikowany asortyment powiązanego kanału dokładnie jak
storefront; produkty wykluczone z kanału są nieobecne, a ich URL-e szczegółów zwracają
`404` — nie do odróżnienia od nieistnienia. Pozycje wywołującego powiązanego dodatkowo
niosą:

- `price` — efektywna cena jednostkowa Organization przy ilości 1, liczona tym samym
  silnikiem cen co koszyk (`null`, gdy nierozwiązywalna);
- `priceUnavailable: true` — marker, gdy ceny org nie udało się rozwiązać;
- `availability` — `{ band, inStock }`.

### Przyrostowy sync z `changedSince`

Dla pełnego eksportu stronicuj z `cursor` aż do wyczerpania. Dla sync
przyrostowego odpytuj z `changedSince=<start ostatniego udanego sync>`. Zawsze
nakładaj okna: zapisz timestamp **przed** startem runu sync i przekaż tę
wartość przy następnym runie, aby aktualizacje w trakcie runu nigdy nie zostały
pominięte. Deduplikuj po id produktu.

## Hurtowe ceny

Brama: `catalog:read`, **tylko klucze powiązane**.

```http
POST /api/v1/external/catalog/prices
{ "lines": [ { "sku": "SKU-1", "quantity": 10 }, … ] }   // 1–200 lines
```

Odpowiedź zachowuje kolejność linii. Każda linia rozwiązuje się do wpisu z ceną
(`amount`, `currency`, `isSale`, `bracketStartQuantity`, `priceListId`) albo
`price: null` z `reason` `sku_not_in_assortment` lub
`price_unavailable`. Braki per linia to dane, nie błędy — koszyk zawsze
dostaje odpowiedź łączną. Więcej niż 200 linii to `422 VALIDATION_FAILED`.

Gwarancja: dla dowolnego `(sku, quantity)` zwrócona kwota równa się temu, co koszyk
i składanie zamówienia naliczyłyby powiązanej Organization na powiązanym kanale
przy tej ilości, do grosza.

## Idempotentne składanie zamówień

Brama: `orders:write`, tylko klucze powiązane.

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

- Nagłówek `Idempotency-Key` (1–128 znaków) jest **wymagany**; brak ⇒
  `422 IDEMPOTENCY_KEY_REQUIRED`.
- Powtórzenie tego samego klucza z tym samym payloadem — w tym równoległe
  powtórzenia — zwraca **to samo zamówienie** (`200`); dokładnie jedno zamówienie
  kiedykolwiek powstaje.
- Ponowne użycie klucza z **innym** payloadem ⇒ `409 IDEMPOTENCY_KEY_REUSED`.
- Adresy: podaj istniejące id adresów organizacji albo inline obiekty
  `deliveryAddress` / `billingAddress`.
- Odmowy per linia to całościowe `422` z issue per linia
  (`SKU_NOT_IN_ASSORTMENT`, `PRICE_UNAVAILABLE`); nic nie jest persystowane.
- Odpowiedź sukcesu (`201`) to standardowa koperta zamówienia — ten sam kształt co
  sesje klienta. Śledź zamówienia przez
  `GET /api/v1/external/orders` i `GET /api/v1/external/orders/:id`
  (`orders:read`); id poza widocznością zwracają `404`.

### Koperta możliwości organizacji

Powiązany klucz nigdy nie może zrobić więcej niż kupujący Organization. Ta sama
ścieżka kodu domenowego składa zamówienie, więc każde uprawnienie działa identycznie:
zawieszona organizacja ⇒ `423`; metoda płatności lub dostawy poza allow-listą
organizacji ⇒ ta sama odmowa co checkout klienta; przekroczony limit kredytowy ⇒ ten sam
błąd credit-guard; minimalna wartość zamówienia, asortyment, strategia magazynowa i
automatyczne promocje zachowują się dokładnie jak w storefront. Nie ma parametru
override ani bypass.

## Webhooki (zakres organizacji)

Zdarzenia zamówień są dostarczane do subskrypcji webhooków (zobacz
[Przegląd integracji](./README.md) dla transportu, weryfikacji HMAC i
semantyki ponowień). Dwa fakty są istotne dla partnerów:

- Subskrypcja może być **ograniczona do jednej Organization** (ustaw opcjonalną
  Organization w formularzu webhooka). Subskrypcje org-scoped otrzymują tylko
  zdarzenia `order.created.v1` / `order.status_changed.v1` tej Organization;
  subskrypcje platformowe (bez organizacji) otrzymują wszystkie. Zdarzenie
  bez atrybucji organizacji nigdy nie trafia do subskrypcji org-scoped
  (fail closed).
- **Dostarczanie jest teraz aktywne.** Subskrypcje webhooków zarejestrowane przed
  istnieniem tej funkcji były akceptowane, ale zdarzenia zamówień nie były
  wysyłane. Od feature 062 pipeline dostarczania jest live: każda istniejąca
  subskrypcja pasująca do `order.created.v1` lub `order.status_changed.v1` zaczyna
  otrzymywać dostawy. Upewnij się, że odbiorcy są idempotentni przed aktualizacją.

## Słownik błędów (powierzchnia partnerska)

| Code | HTTP | Znaczenie |
|---|---|---|
| `UNAUTHORIZED` | 401 | Brakujący, nieprawidłowy, unieważniony lub wygasły klucz |
| `API_KEY_OUT_OF_SCOPE` | 403 | Kluczowi brakuje wymaganego scope (audytowane) |
| `API_KEY_NOT_BOUND` | 403 | Endpoint tylko dla powiązanych wywołany niepowiązanym kluczem |
| `API_KEY_CHANNEL_MISMATCH` | 403 | Powiązany klucz wskazał obcy kanał sprzedaży |
| `IDEMPOTENCY_KEY_REQUIRED` | 422 | Brak `Idempotency-Key` przy składaniu zamówienia |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Ten sam klucz idempotencji, inny payload |
| `SKU_NOT_IN_ASSORTMENT` | 422 (per line) | SKU nieobecne w asortymencie powiązanego kanału |
| `PRICE_UNAVAILABLE` | 422 (per line) | Brak rozwiązywalnej ceny organizacji |
| `STOCK_UNAVAILABLE` | 409 | Niewystarczający stan przy składaniu |
| `FORBIDDEN` (`organization_cannot_transact`) | 423 | Organizacja zawieszona / nie może transakcjonować |

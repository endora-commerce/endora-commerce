---
sidebar_position: 1
title: Integracje
---

# Integracje

Ta strona jest przeznaczona dla programistów, którzy podłączają system zewnętrzny do Platformy B2B.
Platforma udostępnia trzy mechanizmy integracji, każdy należący do osobnego modułu backendu w
`packages/modules/`:

- **Klucze API** — uwierzytelnianie tokenem bearer wywołań, które systemy zewnętrzne kierują do API
  HTTP platformy. Wszystkie funkcje dostępne po uwierzytelnieniu kluczem są udostępnione w osobnej
  **przestrzeni partnerskiej `/api/v1/external/*`** — pełny zakres (odczyty katalogu, ceny hurtowe,
  idempotentne składanie zamówień) opisuje strona [Dostęp partnerski do API](./api-access.md).
- **Webhooki** — wychodzące powiadomienia HTTP POST wywoływane przez działającą w procesie szynę
  zdarzeń, podpisywane HMAC-SHA-256; subskrypcję można ograniczyć do jednej organizacji.
- **Dane uwierzytelniające (Credentials)** — zaszyfrowane dane dostępowe do usług zewnętrznych (np.
  klucze API modeli językowych, sekrety dostawcy poczty), którymi zarządza się w panelu
  administracyjnym i do których odwołują się ustawienia — zobacz
  [Credentials](../modules/credentials.md).

Źródłem prawdy o każdym opisanym tu endpoincie jest dokument OpenAPI na żywo pod
`GET /api/v1/_openapi.json`. Schematy są generowane ze schematów Zod w `@endora-commerce/contracts`.

## Uwierzytelnianie kluczem API

Utwórz klucz w **Panel administracyjny → API Keys → New Key**, wybierając zakresy, z których klucz
może korzystać, i opcjonalnie **powiązanie z organizacją** (zobacz niżej). Pełny token bearer
(`sk_live_…`) jest pokazywany **tylko raz**; potem przechowywane są tylko jego cztery ostatnie znaki.
Platforma przechowuje skrót SHA-256 tokenu, nigdy sam token.

Każde kolejne żądanie uwierzytelnia się standardowym nagłówkiem `Authorization`:

```http
GET /api/v1/external/catalog/products?changedSince=2026-04-25T00:00:00Z HTTP/1.1
Host: api.example.com
Authorization: Bearer sk_live_REDACTED
```

Endpointy uwierzytelniane kluczem znajdują się w przestrzeni `/api/v1/external/*`. Publiczne
endpointy storefrontu (`/api/v1/catalog/…`) i endpointy sesji klienta (`/api/v1/orders…`) całkowicie
ignorują token bearer — klucz nigdy nie zmienia ich działania. Każda odpowiedź z
`/api/v1/external/*` ma nagłówek `Cache-Control: private, no-store` i nie wolno jej przechowywać w
pamięci podręcznej.

### Klucze powiązane i niepowiązane

Klucz jest albo **niepowiązany** (dane uwierzytelniające platformy: synchronizacja PIM, odczyty
katalogu w kanale domyślnym), albo **powiązany** z dokładnie jedną organizacją, kanałem sprzedaży i
technicznym kontem klienta (z opcjonalną datą ważności). Klucz powiązany działa w imieniu organizacji:
widzi ceny obowiązujące tę organizację, jest przypięty do jej kanału sprzedaży i działa wyłącznie w
granicach jej możliwości — z tymi samymi ograniczeniami co jej kupujący (dozwolone metody płatności i
dostawy, limit kredytowy, zawieszenie). Pełną macierz dla każdego obszaru API, wskazówki dotyczące
synchronizacji katalogu, ceny hurtowe i idempotentne składanie zamówień opisuje strona
[Dostęp partnerski do API](./api-access.md).

### Zakresy

Klucz dostaje jeden lub więcej zakresów z typowanego katalogu: `catalog:read`, `catalog:write`
(tylko klucze niepowiązane), `orders:read`, `orders:write` (tylko klucze powiązane). Gdy żądanie
trafia na trasę chronioną przez `requireApiKey('catalog:write')`, platforma:

1. Odnajduje wiersz `ApiKey` dla tokenu bearer według skrótu SHA-256.
2. Odrzuca unieważnione, wygasłe i nieznane tokeny z `401 UNAUTHORIZED`.
3. Porównuje wymagany zakres z zakresami przyznanymi kluczowi.
4. Gdy zakresu brakuje, odpowiada `403 API_KEY_OUT_OF_SCOPE` **i** zapisuje wiersz w
   `audit_log_entries` wskazujący klucz (akcja audytu `api_key.out_of_scope`).

Przyznawaj najmniejszy zestaw zakresów, z którym integracja działa; zmieniaj klucze przy zmianach w
zespole; unieważniaj je natychmiast po wycieku.

### Błędy

Wszystkie błędy API mają standardową strukturę:

```json
{
  "error": {
    "code": "API_KEY_OUT_OF_SCOPE",
    "message": "API key lacks the required scope: catalog:write.",
    "details": { "requiredScope": "catalog:write" },
    "requestId": "req_…"
  }
}
```

`requestId` odpowiada nagłówkowi odpowiedzi `X-Request-Id` — podawaj go w zgłoszeniach do wsparcia,
aby można było odnaleźć wpisy w logach.

## Subskrypcja webhooków

Utwórz subskrypcję webhooka w **Panel administracyjny → Webhooks → New Webhook** (albo przez
`POST /api/v1/admin/webhooks` z uprawnieniem administracyjnym `integrations:manage`). Platforma
generuje dla każdej subskrypcji 64-znakowy szesnastkowy `secret`; dostajesz go w odpowiedzi na
utworzenie **tylko ten jeden raz** — przechowuj go w menedżerze sekretów.

Subskrypcja webhooka określa:

- `url` — endpoint odbiorcy przyjmujący żądania `POST`.
- `eventTypes[]` — wersjonowane nazwy zdarzeń, które odbiorca chce dostawać (np.
  `order.created.v1`, `order.status_changed.v1`). Przyjmowane są wyłącznie nazwy wymienione niżej
  w sekcji *Dostępne zdarzenia*; każda inna jest odrzucana z
  `422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`.
- `organizationId` — opcjonalne ograniczenie do organizacji. Gdy jest ustawione, subskrypcja dostaje
  tylko zdarzenia przypisane do tej organizacji (jej zamówienia, zapytania ofertowe i limit
  kredytowy); gdy go nie ma, subskrypcja obejmuje całą platformę i dostaje wszystkie pasujące
  zdarzenia. Zdarzenia bez przypisanej organizacji — na przykład zdarzenia produktów — trafiają
  tylko do subskrypcji obejmujących całą platformę (w razie wątpliwości — odmowa).

> **Wysyłka zdarzeń zamówień już działa.** Subskrypcje utworzone, zanim powstał mechanizm wysyłki,
> były przyjmowane, ale zdarzenia `order.created.v1` / `order.status_changed.v1` nie były wysyłane.
> Mechanizm wysyłki jest już podłączony: każda istniejąca subskrypcja tych typów zdarzeń zacznie
> je otrzymywać. Przed aktualizacją upewnij się, że odbiorca jest idempotentny.

### Kontrakt wysyłki

Każda wysyłka to żądanie `POST` na skonfigurowany `url` z następującymi nagłówkami:

| Nagłówek | Przeznaczenie |
| --- | --- |
| `Content-Type: application/json` | Kodowanie treści. |
| `X-Webhook-Event-Id` | Stały UUID zdarzenia (do usuwania duplikatów). |
| `X-Webhook-Event-Type` | Nazwa zdarzenia, np. `order.created.v1`. |
| `X-Webhook-Signature-256` | HMAC-SHA-256 surowej treści w zapisie szesnastkowym małymi literami, z kluczem w postaci sekretu subskrypcji. |
| `X-Webhook-Attempt` | Numer próby tej wysyłki, liczony od 1. |

Treść to dane zdarzenia zdefiniowane w `@endora-commerce/contracts`. Odpowiedź `2xx` potwierdza
odbiór. Każda inna odpowiedź (albo przekroczenie 10 s) jest traktowana jako niepowodzenie i
powoduje ponowienie.

### Weryfikacja podpisu HMAC

Zawsze weryfikuj podpis **przed** odczytaniem treści, na surowych bajtach dokładnie w takiej postaci,
w jakiej je otrzymano:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHeader, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

Korzystaj z `timingSafeEqual` (albo odpowiednika w swoim języku), aby uniemożliwić atak czasowy.
Nigdy nie przerywaj porównania na pierwszym niezgodnym bajcie.

### Ponawianie i kolejka nieudanych wysyłek

Wysyłki przetwarza kolejka BullMQ z wykładniczo rosnącym odstępem:

- Do **8 prób** na wysyłkę.
- Odstęp zaczyna się od **1 s** i podwaja przy każdym ponowieniu (1 s, 2 s, 4 s, …).
- Każda próba ma limit czasu **10 s**.
- Po ostatniej próbie wysyłka jest oznaczana jako `dead_lettered` w `webhook_deliveries`. Widok
  „Failed Deliveries” w panelu administracyjnym pozwala ponowić ją na żądanie.

Odbiorcy muszą być **idempotentni**: usuwaj duplikaty według `X-Webhook-Event-Id`, aby powtórzona
wysyłka nie zastosowała zmiany stanu dwa razy. Kolejność webhooków różnych typów zdarzeń nie jest
gwarantowana.

### Dostępne zdarzenia

Zdarzenie trafia do webhooków tylko wtedy, gdy jest **przekazywane** do kolejki wysyłek. Samo
wyemitowanie na działającej w procesie szynie zdarzeń nie wystarcza: większość zdarzeń na szynie
jest wewnętrzna i nie jest dostarczana.

Dwa zdarzenia przekazuje sam moduł `webhooks`:

- `order.created.v1` — złożono zamówienie.
- `order.status_changed.v1` — zamówienie przeszło z jednego statusu w inny. W ten sposób ogłaszane
  jest też anulowanie, z nowym statusem w treści zdarzenia; osobnego zdarzenia anulowania nie ma.

Moduł może wnieść własne typy zdarzeń, które są dostarczane, dopóki ten moduł jest włączony.
Moduły, które to robią:

| Zdarzenie | Wnosi je | Co ogłasza | Treść, poza `eventId` i `occurredAt` |
| --- | --- | --- | --- |
| `product.created.v1` | `catalog` | Utworzono produkt, także przez powielenie innego. | `productId`, `sku` |
| `product.updated.v1` | `catalog` | Zapisano produkt albo utworzono, zmieniono lub usunięto jeden z jego wariantów. | `productId`, `changedFields` |
| `product.archived.v1` | `catalog` | Status produktu zmienił się na `inactive`. Wysyłane po zdarzeniu `product.updated.v1` tego samego zapisu. | `productId` |
| `rfq.created.v1` | `quote_requests` | Klient złożył zapytanie ofertowe. | `rfqId`, `organizationId` |
| `rfq.expired.v1` | `quote_requests` | Zadanie wygaszania przeniosło zapytanie ofertowe do statusu `Expired`. | `rfqId`, `organizationId` |
| `credit_limit.adjusted.v1` | `credit_limits` | Zmienił się przyznany limit kredytowy organizacji. | `organizationId`, `amount` |
| `crm.opportunity.status_changed.v1`, `crm.opportunity.created.v1`, `crm.opportunity.closed.v1` | `crm` | Szansa sprzedaży zmieniła status, została utworzona, wygrana albo przegrana. | Zobacz `packages/contracts/src/crm.ts`. |

Co dotyczy ich wszystkich:

- **Niosą identyfikatory, nie treść.** Zdarzenie produktu wskazuje produkt, a przy aktualizacji
  także *nazwy* pól, których dotyczył zapis — nigdy wartość, cenę ani opis. Zdarzenie zapytania
  ofertowego wskazuje zapytanie i jego organizację — bez pozycji, cen, notatek i osób. Aby na nie
  zareagować, odczytaj obiekt przez API z uprawnieniami własnego klucza.
  `credit_limit.adjusted.v1` jako jedyne niesie kwotę: `amount` to przyznany limit **po** zmianie,
  jako liczba w walucie limitu (waluty w treści nie ma).
- **Kto je dostaje.** Produkt należy do katalogu, a nie do organizacji, więc zdarzenia produktów
  trafiają tylko do subskrypcji obejmujących całą platformę — subskrypcja powiązana z organizacją
  nigdy ich nie dostaje. Zdarzenia zapytań ofertowych i limitu kredytowego należą do jednej
  organizacji: trafiają do subskrypcji obejmujących całą platformę oraz do subskrypcji powiązanych
  z tą organizacją i do żadnej subskrypcji powiązanej z inną.
- **Następują po zatwierdzeniu zapisu.** Każde jest wysyłane dla zapisu, który został
  zatwierdzony. Zapis odrzucony albo nieudany w trakcie zapisywania nie wysyła niczego.
- **Jedna wysyłka na zdarzenie i subskrypcję, bez łączenia w paczki.** Edycja zbiorcza, import albo
  synchronizacja z PIM zapisują produkty pojedynczo, więc subskrybent `product.updated.v1` dostaje
  jedną wysyłkę na każdy zapisany produkt i powinien spodziewać się serii liczonych w tysiącach.
  Typ zdarzenia, którego nie wskazuje żadna subskrypcja, niczego nie dodaje do kolejki.

Co **nie** jest dostarczane i jak dziś się o tym dowiedzieć:

- **Usunięcie produktu.** `product.deleted.v1` istnieje na działającej w procesie szynie zdarzeń i
  nie jest oferowane webhookom, a usunięcie nie wysyła `product.archived.v1`. API po prostu
  przestaje zwracać produkt; jeśli usunięcia są dla ciebie istotne, uzgadniaj stan z pełną listą.
- **Ponowna aktywacja produktu.** Nie ma zdarzenia cofnięcia archiwizacji. Produkt, który przestaje
  być `inactive`, wysyła `product.updated.v1` ze `status` w `changedFields`, jak przy każdej innej
  zmianie statusu; odczytaj produkt, aby sprawdzić, jaki ma teraz status.
- **Zapytanie ofertowe utworzone przez administratora.** `rfq.created.v1` ogłasza wyłącznie
  zapytanie złożone przez klienta.
- **Pierwsze przyznanie limitu kredytowego.** `credit_limit.adjusted.v1` jest wysyłane, gdy
  administrator zmienia limit i gdy na limit zostaje zaliczony rozliczony zwrot.

`rfq.expired.v1` wysyła wyłącznie zadanie wygaszania zapytań ofertowych: zdarzenie występuje tylko
w instancji, w której to zadanie działa.

Lista obowiązująca w działającej instancji to ta, którą oferuje formularz subskrypcji: dwa
zdarzenia wbudowane oraz odpowiedź `GET /api/v1/admin/webhooks/event-types`. Lista wbudowana jest
eksportowana z `@endora-commerce/contracts` jako `WEBHOOK_BUILT_IN_EVENT_TYPES` i jest tą samą
stałą, z której backend zakłada swoje przekazywanie, więc formularz nie może zaoferować zdarzenia,
które nie jest dostarczane.

Subskrypcja może wskazywać wyłącznie te zdarzenia. `POST` i `PATCH` na `/api/v1/admin/webhooks`
odrzucają każdą inną nazwę z `422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`, a `error.details.eventTypes`
zawiera odrzucone nazwy. Subskrypcja zapisana przed wprowadzeniem tej reguły zachowuje nazwy, z
którymi ją zapisano: nadal jest widoczna na liście i nadal można ją edytować, panel administracyjny
oznacza nazwy, które nie są dostarczane, a subskrypcja nic dla nich nie dostaje.

Treść zdarzenia jest wysyłana w całości. Każde wnoszone zdarzenie ma ścisły schemat w
`@endora-commerce/contracts` — `CATALOG_WEBHOOK_EVENT_SCHEMAS`,
`QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`, `CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` i
`CRM_WEBHOOK_EVENT_SCHEMAS` — i to on jest opublikowaną postacią danych. Do treści zdarzenia `.v1`
można dodać pole; pola nigdy się nie usuwa ani nie zmienia mu nazwy bez nowej wersji zdarzenia
oferowanej obok dotychczasowej.

## Dane uwierzytelniające usług zewnętrznych

Dane dostępowe do usług zewnętrznych należą do modułu **Credentials**, a nie do tego obszaru API.
Konfiguracja danych uwierzytelniających to instancja typu konfiguracji zarejestrowanego w kodzie; pola
z sekretami są szyfrowane w bazie, na granicy API dostępne tylko do zapisu, a ustawienia odwołują się
do nich przez typ wartości `credential_ref`. Konfiguruje się je w **Panel administracyjny →
Credentials**. Zobacz [Credentials](../modules/credentials.md).

Integracje z konkretnymi dostawcami (Stripe, TPay, PayU, Autopay, Google Analytics, dostawcy
newslettera, wyszukiwanie w VIES i na Białej liście) to osobne moduły z własnymi ustawieniami i
ekranami w panelu — nie ma ogólnego rejestru adapterów dostawców.

## Lista kontrolna przed uruchomieniem

Zanim włączysz nową integrację na produkcji:

1. **Korzystaj z kluczy API o ograniczonym zakresie.** Jeden klucz na integrację; zmieniaj klucze
   przy zmianach w zespole.
2. **Weryfikuj HMAC.** Odrzucaj każdą wysyłkę webhooka, która nie przechodzi weryfikacji podpisu,
   nawet od „zaufanego” nadawcy.
3. **Bądź idempotentny.** Zapisuj `X-Webhook-Event-Id` i od razu kończ obsługę powtórzeń.
4. **Monitoruj nieudane wysyłki.** Obserwuj widok nieudanych wysyłek w panelu administracyjnym;
   zbadaj każdą wysyłkę w stanie `dead_lettered`, zanim ją ponowisz.
5. **Podawaj `requestId`.** Zgłaszając problem, podaj nagłówek `X-Request-Id` z nieudanego
   wywołania.

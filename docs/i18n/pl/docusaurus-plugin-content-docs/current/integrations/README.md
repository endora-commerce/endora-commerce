---
sidebar_position: 1
title: Integracje
---

# Integracje

Ta strona jest dla deweloperów podłączających system zewnętrzny do Platformy B2B.
Platforma udostępnia trzy mechanizmy integracji, każdy należący do niezależnego
modułu backendu w `packages/modules/`:

- **Klucze API** — uwierzytelnianie bearer tokenem dla wychodzących wywołań
  maszyna-maszyna do HTTP API platformy. Cała funkcjonalność uwierzytelniana kluczem
  jest zamontowana w dedykowanej **przestrzeni partnerskiej `/api/v1/external/*`** — zobacz
  [Dostęp partnerski do API](./api-access.md) dla pełnej powierzchni (odczyty katalogu,
  hurtowe ceny, idempotentne składanie zamówień).
- **Webhooki** — wychodzące powiadomienia HTTP POST sterowane przez in-process
  event bus, podpisywane HMAC-SHA-256; subskrypcje mogą być ograniczone do jednej
  Organization.
- **Credentials** — zaszyfrowane poświadczenia vendorów (np. klucze API LLM, sekrety
  dostawcy poczty) zarządzane w panelu admina i referencjonowane przez Settings —
  zobacz [Credentials](../modules/credentials.md).

Dokument OpenAPI na żywo pod `GET /api/v1/_openapi.json` jest źródłem
prawdy dla każdego endpointu opisanego tutaj. Schematy są generowane ze schematów Zod
w `@endora-commerce/contracts`.

## Uwierzytelnianie kluczem API

Wydaj klucz w **Panel admina → API Keys → New Key**, wybierając scope'y, których
klucz może używać, oraz opcjonalnie **powiązanie z Organization** (patrz
poniżej). Pełny bearer token (`sk_live_…`) jest pokazywany **raz**; potem
przechowywane są tylko ostatnie cztery znaki. Platforma przechowuje hash SHA-256
tokena, nigdy samego tokena.

Każde kolejne żądanie uwierzytelnia się standardowym nagłówkiem `Authorization`:

```http
GET /api/v1/external/catalog/products?changedSince=2026-04-25T00:00:00Z HTTP/1.1
Host: api.example.com
Authorization: Bearer sk_live_REDACTED
```

Endpointy uwierzytelniane kluczem żyją w przestrzeni `/api/v1/external/*`. Publiczne
endpointy storefrontu (`/api/v1/catalog/…`) i endpointy sesji klienta
(`/api/v1/orders…`) całkowicie ignorują poświadczenia bearer — klucz
nigdy nie zmienia ich zachowania. Każda odpowiedź `/api/v1/external/*` niesie
`Cache-Control: private, no-store` i nie wolno jej cache'ować.

### Klucze powiązane i niepowiązane

Klucz jest albo **niepowiązany** (poświadczenie platformowe: sync PIM, odczyty katalogu
domyślne kanału), albo **powiązany** z dokładnie jedną Organization + Sales Channel +
service Customer Account (z opcjonalnym wygaśnięciem). Powiązany klucz działa w imieniu
Organization: widzi efektywne ceny Organization, jest przypięty do jej kanału sprzedaży
i operuje ściśle w obrębie koperty możliwości Organization — tych samych ograniczeń co
jej kupujący (allow-listy płatności i dostawy, limit kredytowy, zawieszenie). Pełna
macierz per powierzchnia, wskazówki sync katalogu, hurtowe ceny i idempotentne
składanie zamówień są opisane w
[Dostęp partnerski do API](./api-access.md).

### Scope'y

Kluczowi nadaje się jeden lub więcej scope'ów z typowanego katalogu: `catalog:read`,
`catalog:write` (tylko klucze niepowiązane), `orders:read`, `orders:write` (tylko klucze
powiązane). Gdy żądanie trafia na trasę chronioną przez
`requireApiKey('catalog:write')`, platforma:

1. Rozwiązuje bearer token do wiersza `ApiKey` po hash SHA-256.
2. Odrzuca unieważnione, wygasłe lub nieznane tokeny z `401 UNAUTHORIZED`.
3. Porównuje żądany scope ze scope'ami przyznanymi kluczowi.
4. Gdy scope brakuje, odpowiada `403 API_KEY_OUT_OF_SCOPE` **oraz**
   zapisuje wiersz `audit_log_entries` tagując klucz (akcja audytu
   `api_key.out_of_scope`).

Używaj najmniejszego zestawu scope'ów, który pozwala integracji działać; rotuj klucze przy
zmianie składu zespołu; unieważniaj natychmiast po kompromitacji.

### Błędy

Wszystkie błędy API używają standardowej koperty:

```json
{
  "error": {
    "code": "API_KEY_OUT_OF_SCOPE",
    "message": "API key lacks the required scope: catalog:write.",
    "requestId": "req_…"
  }
}
```

`requestId` odpowiada nagłówkowi odpowiedzi `X-Request-Id` — podaj go
w ticketach wsparcia, aby logi były śledzalne.

## Subskrypcja webhooków

Utwórz subskrypcję webhooka w **Panel admina → Webhooks → New Webhook**
(lub `POST /api/v1/admin/webhooks` z uprawnieniem admina `integrations:manage`).
Platforma generuje 64-znakowy hex `secret` na subskrypcję; otrzymujesz go w odpowiedzi
create **tylko wtedy** — przechowuj go w menedżerze sekretów.

Subskrypcja webhooka deklaruje:

- `url` — endpoint odbiorcy akceptujący dostawy `POST`.
- `eventTypes[]` — wersjonowane nazwy zdarzeń, które odbiorca chce (np.
  `order.created.v1`, `rfq.accepted.v1`, `product.updated.v1`).
- `organizationId` — opcjonalny zakres Organization. Gdy ustawiony, subskrypcja
  otrzymuje tylko zdarzenia przypisane do tej Organization (np. jej zamówienia);
  gdy pominięty, subskrypcja jest platformowa i otrzymuje wszystkie pasujące
  zdarzenia. Zdarzenia bez atrybucji Organization trafiają tylko do subskrypcji
  platformowych (fail closed).

> **Dostarczanie jest teraz aktywne dla zdarzeń zamówień.** Subskrypcje utworzone przed
> feature 062 były akceptowane, ale dostawy `order.created.v1` / `order.status_changed.v1`
> nie były wysyłane. Pipeline dostarczania jest teraz podłączony: każda
> istniejąca subskrypcja pasująca do tych typów zdarzeń zaczyna otrzymywać
> dostawy. Upewnij się, że odbiorca jest idempotentny przed aktualizacją.

### Kontrakt dostarczania

Każda dostawa to `POST` na skonfigurowany `url` z tymi nagłówkami:

| Header | Cel |
| --- | --- |
| `Content-Type: application/json` | Kodowanie body. |
| `X-Webhook-Event-Id` | Stabilny UUID zdarzenia (użyj do deduplikacji). |
| `X-Webhook-Event-Type` | Nazwa zdarzenia, np. `order.created.v1`. |
| `X-Webhook-Signature-256` | Lower-case hex HMAC-SHA-256 surowego body, kluczowany sekretem subskrypcji. |
| `X-Webhook-Attempt` | Licznik prób od 1 dla tej dostawy. |

Body to payload zdarzenia zdefiniowany w `@endora-commerce/contracts`. Odpowiedź `2xx`
potwierdza odbiór. Wszystko inne (lub timeout > 10 s) traktowane jest jako
niepowodzenie i uruchamia ponowienie.

### Weryfikacja podpisu HMAC

Zawsze weryfikuj podpis **przed** parsowaniem body, używając surowych bajtów
dokładnie tak, jak odebrane:

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

Używaj `timingSafeEqual` (lub odpowiednika w swoim języku), aby pokonać oracle
timingowy. Nigdy nie kończ wcześniej przy pierwszym niedopasowanym bajcie.

### Ponowienia i dead-letter

Wychodzące dostawy przetwarza kolejka BullMQ z wykładniczym backoffem:

- Do **8 prób** na dostawę.
- Backoff zaczyna od **1 s** i podwaja się przy każdym ponowieniu (1 s, 2 s, 4 s, …).
- Każda próba ma timeout **10 s**.
- Po ostatniej próbie dostawa jest oznaczana `dead_lettered` w
  `webhook_deliveries`. Widok „Failed Deliveries” w panelu admina odtwarza je
  na żądanie.

Odbiorcy muszą być **idempotentni**: deduplikuj po `X-Webhook-Event-Id`, aby
powtórzona dostawa nie zastosowała zmian stanu podwójnie. Kolejność webhooków nie
jest gwarantowana między typami zdarzeń.

### Dostępne zdarzenia

Katalog stabilnych zdarzeń to wyczerpująca lista stringów emitowanych przez
in-process event bus i mostkowanych do webhooków (`packages/platform/src/events/`).
Przykłady istotne dla integracji:

- `product.created.v1`, `product.updated.v1`, `product.archived.v1`
- `rfq.created.v1`, `rfq.quoted.v1`, `rfq.accepted.v1`, `rfq.expired.v1`
- `order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`
- `payment.settled.v1`
- `credit_limit.adjusted.v1`, `credit_limit.reservation_released.v1`

Patrz `packages/contracts/src/*.ts` dla dokładnego kształtu payloadu per
zdarzenie.

## Poświadczenia vendorów

Poświadczenia vendorów zewnętrznych należą do modułu **Credentials**, nie do
tej powierzchni. Konfiguracja credential to instancja typu konfiguracji
zarejestrowanego w kodzie; pola sekretów są szyfrowane w spoczynku, write-only na
granicy API i referencjonowane z Settings przez typ wartości `credential_ref`.
Konfiguruj je w **Panel admina → Credentials**. Zobacz
[Credentials](../modules/credentials.md).

Integracje vendor-specific (Stripe, TPay, PayU, Autopay, Google Analytics, KSeF, newsletter
providers, wyszukiwania VIES / Biała lista) każda jest osobnym modułem z własnymi
ustawieniami i powierzchnią admina — nie ma generycznego rejestru adapterów vendorów.

## Checklist operacyjny

Przed włączeniem nowej integracji na produkcji:

1. **Używaj scope'owanych kluczy API.** Jedna para klucz na integrację; rotuj przy
   zmianie personelu.
2. **Weryfikuj HMAC.** Odrzucaj każdą przychodzącą dostawę webhooka, która nie przechodzi
   kontroli podpisu, nawet od „zaufanego” nadawcy.
3. **Bądź idempotentny.** Persystuj `X-Webhook-Event-Id` i kończ wcześniej przy
   powtórzeniach.
4. **Monitoruj dead-letter.** Obserwuj widok failed-deliveries w panelu admina; zbadaj
   każdą dostawę dead-letter przed odtworzeniem.
5. **Dołącz `requestId`.** Zgłaszając problem, podaj nagłówek `X-Request-Id`
   z nieudanego wywołania.

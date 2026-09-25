---
title: api_keys
description: Poświadczenia integracyjne typu bearer token
---

# `api_keys`

Klucze API ze scope'owanym bearer tokenem do integracji machine-to-machine. Plaintext
tokenu pokazywany jest raz przy utworzeniu; przechowywany jest tylko hash SHA-256.
Klucz może dodatkowo nieść **powiązanie dystrybutora**
(Organization + Sales Channel + service Customer Account) oraz opcjonalną datę wygaśnięcia,
czyniąc go poświadczeniem partnerskim dla przestrzeni `/api/v1/external/*`,
którą w pełni dokumentuje przewodnik integracyjny *Partner API access*.

## Publiczne API

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/api-keys` | admin | Lista kluczy + timestampy last-used, binding, expiry |
| `POST /api/v1/admin/api-keys` | admin | Utworzenie; zwraca surowy bearer **raz** |
| `DELETE /api/v1/admin/api-keys/:id` | admin | Unieważnienie |

Wywołania external uwierzytelniają się przez `Authorization: Bearer sk_live_…`.
`requireApiKey(scope)` i `requireBoundApiKey(scope)` to pre-handlery Fastify
eksponowane przez plugin `api_keys`; powierzchnie tras bramkują się nimi
(`requireApiKey('catalog:write')`,
`requireBoundApiKey('orders:write')` itd.).

## Enum scope

Tworzenie waliduje scope'y względem typowanego katalogu w
`packages/contracts/src/api-keys.ts` (`apiKeyScopeSchema`):

| Scope | Meaning |
| --- | --- |
| `catalog:read` | Odczyty PIM (unbound) i powierzchnia external catalog (bound) |
| `catalog:write` | PIM by-SKU upsert — **tylko klucze unbound** |
| `orders:read` | Odczyty external order — **tylko klucze bound** |
| `orders:write` | Przyjmowanie external order — **tylko klucze bound** |

Egzekucja pozostaje membership-based, więc legacy free-text scope'y na istniejących
kluczach pozostają czytelne i egzekwowalne — walidowane jest tylko tworzenie.

## Model binding

Binding jest all-or-none i **niemutowalny po utworzeniu** (cykl życia token-shown-once;
rebinding = revoke + nowy klucz). Reguły tworzenia, walidowane server-side i odzwierciedlone
inline w formularzu admin:

| Rule | Detail |
| --- | --- |
| B1 | Dowolny scope `orders:*` ⇒ binding wymagany |
| B2 | Binding obecny ⇒ `catalog:write` zabronione (zapisy PIM pozostają tylko unbound) |
| B3 | Service Customer Account musi być aktywny i należeć do powiązanej Organization |
| B4 | Organization i Sales Channel muszą istnieć (kanał nie musi być aktywny przy tworzeniu — klucz po prostu fail-closed, gdy jest nieaktywny) |
| B5 | `expiresAt`, gdy obecne, musi być przyszłym instantem |

W czasie requestu klucz bound wyprowadza tenant context single-org i przypięty
sales channel (jawny nagłówek `X-Sales-Channel` wskazujący inny kanał
jest odrzucany z `403 API_KEY_CHANNEL_MISMATCH`). Klucz unbound zachowuje
legacy system context i rozwiązywanie header/host/default channel.

## Wygaśnięcie

`expiresAt` jest opcjonalne i dotyczy obu trybów klucza. Gdy instant minie,
`authenticate` odrzuca klucz z `401 UNAUTHORIZED` — ta sama odmowa co przy
unieważnionym kluczu.

## Encje

`ApiKey` (name, keyHash, lastFour, scopes, status, lastUsedAt oraz nullable
kolumny binding/expiry `organizationId`, `salesChannelId`,
`customerAccountId`, `expiresAt`).

## Poza zakresem / zachowanie bramki

- Zły scope ⇒ `403 API_KEY_OUT_OF_SCOPE` + wiersz audytu `api_key.out_of_scope`.
- Klucz unbound na endpoincie bound-only ⇒ `403 API_KEY_NOT_BOUND` + wiersz audytu
  `api_key.not_bound`.
- Niedopasowanie kanału ⇒ `403 API_KEY_CHANNEL_MISMATCH` + wiersz audytu
  `api_key.channel_mismatch`.

## Punkty rozszerzenia

- **Nowe scope'y** — rozszerz `apiKeyScopeSchema` w `@endora-commerce/contracts` i bramkuj
  nową powierzchnię w miejscu wywołania; serwis jest scope-name-agnostic w czasie
  egzekucji.
- **Rate limit per klucz** — `api-key-service.authenticate` zwraca id klucza;
  nałóż licznik per klucz w pre-handlerze lub downstream middleware.

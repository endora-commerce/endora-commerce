---
title: api_keys
description: Dane uwierzytelniające integracji w postaci tokenu bearer
---

# `api_keys`

Klucze API z tokenem bearer o określonym zakresie, przeznaczone do integracji między systemami.
Token w postaci jawnej jest pokazywany tylko raz, przy utworzeniu; przechowywany jest wyłącznie jego
skrót SHA-256. Klucz może dodatkowo mieć **powiązanie z dystrybutorem** (organizacja, kanał sprzedaży
i techniczne konto klienta) oraz opcjonalną datę ważności — staje się wtedy danymi uwierzytelniającymi
partnera dla przestrzeni `/api/v1/external/*`, którą w pełni opisuje przewodnik integracyjny
*Partner API access*.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/api-keys` | administrator | Lista kluczy z datą ostatniego użycia, powiązaniem i datą ważności |
| `POST /api/v1/admin/api-keys` | administrator | Utworzenie; zwraca token bearer **tylko raz** |
| `DELETE /api/v1/admin/api-keys/:id` | administrator | Unieważnienie |

Wywołania z zewnątrz uwierzytelniają się nagłówkiem `Authorization: Bearer sk_live_…`.
`requireApiKey(scope)` i `requireBoundApiKey(scope)` to pre-handlery Fastify udostępniane przez
plugin `api_keys`; trasy są nimi chronione (`requireApiKey('catalog:write')`,
`requireBoundApiKey('orders:write')` itd.).

## Wyliczenie zakresów

Przy tworzeniu zakresy są sprawdzane względem typowanego katalogu w
`packages/contracts/src/api-keys.ts` (`apiKeyScopeSchema`):

| Zakres | Znaczenie |
| --- | --- |
| `catalog:read` | Odczyty PIM (klucz niepowiązany) i zewnętrzne API katalogu (klucz powiązany) |
| `catalog:write` | Zapis PIM według SKU — **tylko klucze niepowiązane** |
| `orders:read` | Odczyt zamówień przez zewnętrzne API — **tylko klucze powiązane** |
| `orders:write` | Przyjmowanie zamówień przez zewnętrzne API — **tylko klucze powiązane** |

Egzekwowanie nadal sprawdza tylko obecność zakresu na liście, więc dawne, dowolnie zapisane zakresy
w istniejących kluczach nadal są odczytywane i egzekwowane — walidacji podlega tylko tworzenie.

## Powiązanie

Powiązanie obejmuje wszystkie pola albo żadne i **nie można go zmienić po utworzeniu** (token jest
pokazywany tylko raz; zmiana powiązania = unieważnienie i nowy klucz). Reguły tworzenia, sprawdzane
po stronie serwera i pokazywane od razu w formularzu w panelu:

| Reguła | Szczegóły |
| --- | --- |
| B1 | Dowolny zakres `orders:*` ⇒ powiązanie jest wymagane |
| B2 | Klucz powiązany ⇒ `catalog:write` jest zabronione (zapisy PIM pozostają wyłącznie dla kluczy niepowiązanych) |
| B3 | Techniczne konto klienta musi być aktywne i należeć do powiązanej organizacji |
| B4 | Organizacja i kanał sprzedaży muszą istnieć (kanał nie musi być aktywny przy tworzeniu — klucz po prostu odmawia działania, dopóki kanał jest nieaktywny) |
| B5 | `expiresAt`, jeśli podane, musi wskazywać chwilę w przyszłości |

W trakcie żądania klucz powiązany ustawia kontekst tenanta ograniczony do jednej organizacji i
przypięty kanał sprzedaży (jawny nagłówek `X-Sales-Channel` wskazujący inny kanał jest odrzucany z
`403 API_KEY_CHANNEL_MISMATCH`). Klucz niepowiązany zachowuje dotychczasowy kontekst systemowy i
wyznaczanie kanału z nagłówka, hosta albo kanału domyślnego.

## Ważność

`expiresAt` jest opcjonalne i dotyczy obu rodzajów kluczy. Po upływie tej chwili `authenticate`
odrzuca klucz z `401 UNAUTHORIZED` — tak samo jak klucz unieważniony.

## Encje

`ApiKey` (name, keyHash, lastFour, scopes, status, lastUsedAt oraz opcjonalne kolumny powiązania i
ważności: `organizationId`, `salesChannelId`, `customerAccountId`, `expiresAt`).

## Odmowy

- Brak wymaganego zakresu ⇒ `403 API_KEY_OUT_OF_SCOPE` i wpis audytu `api_key.out_of_scope`.
- Klucz niepowiązany na endpoincie wymagającym powiązania ⇒ `403 API_KEY_NOT_BOUND` i wpis audytu
  `api_key.not_bound`.
- Niezgodny kanał ⇒ `403 API_KEY_CHANNEL_MISMATCH` i wpis audytu `api_key.channel_mismatch`.

## Punkty rozszerzenia

- **Nowe zakresy** — rozszerz `apiKeyScopeSchema` w `@endora-commerce/contracts` i chroń nową trasę
  w miejscu wywołania; przy egzekwowaniu usługa nie zależy od nazw zakresów.
- **Limit żądań dla klucza** — `api-key-service.authenticate` zwraca identyfikator klucza; dodaj
  licznik dla każdego klucza w pre-handlerze albo w dalszej warstwie pośredniej.

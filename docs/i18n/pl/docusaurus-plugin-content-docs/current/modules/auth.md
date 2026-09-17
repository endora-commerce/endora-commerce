---
title: auth
description: Sesje klienta i admina, hashowanie haseł, TOTP
---

# `auth`

Wspólne prymitywy sesji, hashowania haseł i TOTP używane zarówno przez
`customer_accounts`, jak i `admin_users`. Jeden z dwóch dozwolonych folderów
modułu w liczbie pojedynczej według Zasady VI (obok `example`).

## Co moduł posiada

- **Sesje** — `session-service.ts` zapisuje wiersze sesji w Postgres z warstwą
  cache Redis dla gorących odczytów; cookies podpisywane przez
  `@fastify/cookie`.
- **Hashowanie haseł** — `password-hasher.ts` opakowuje argon2id; domyślne
  parametry są dostrojone pod docelowy sprzęt (zobacz sekcję **Hardware & system
  requirements** w `README.md` w katalogu głównym repozytorium).
- **TOTP** — platformowe `kernel/crypto/totp` opakowuje `otpauth` + pulę kodów
  zapasowych.
- **Plugin Fastify** — `plugin.ts` parsuje cookie sesji i dołącza
  `request.actor = { kind, id, ... }` oraz `request.adminActor`.
- **Strażnicy tras** — `requireAdmin(permission?)`, `requireAdminAny(codes)` i
  `requireCustomer`, udostępniane jako porty z `backend.ts` i rozwiązywane przez
  każdy moduł, który blokuje trasę. Kiedyś były dekoratorami Fastify na pluginie;
  feature 072 (T078) i issue #43 uczyniły je portami, aby produkcja i harness
  testowy uruchamiały tę samą implementację zamiast dwóch różnych.

## Brak własnych tras HTTP

`auth` to moduł prymitywny — endpointy logowania/wylogowania/2FA należą do
modułów skierowanych do klienta (`customer_accounts`) i admina (`admin_users`).

## Punkty rozszerzenia

- **Magazyn sesji** — `session-service` jest konstruowany z `(em, redis)`;
  alternatywne cache podpinają się tutaj.
- **Niestandardowe rodzaje actor** — rozszerz dyskryminowaną unię
  `request.actor` i zaktualizuj pre-handlery `requireX`; istniejący kod
  nadal działa, bo trasy używają tylko fabryki `requireX`, którą już
  konsumują.

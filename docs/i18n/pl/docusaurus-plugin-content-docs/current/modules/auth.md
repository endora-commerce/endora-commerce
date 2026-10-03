---
title: auth
description: Sesje klientów i administratorów, hashowanie haseł, TOTP
---

# `auth`

Wspólne mechanizmy sesji, hashowania haseł i TOTP, z których korzystają zarówno
`customer_accounts`, jak i `admin_users`. Według konwencji nazewnictwa to jeden z dwóch katalogów
modułów, które mogą mieć nazwę w liczbie pojedynczej (obok `example`).

## Za co odpowiada

- **Sesje** — `session-service.ts` zapisuje wiersze sesji w Postgresie, z warstwą pamięci
  podręcznej w Redis dla częstych odczytów; ciasteczka są podpisywane przez `@fastify/cookie`.
- **Hashowanie haseł** — `password-hasher.ts` opakowuje argon2id; domyślne parametry są dobrane do
  docelowego sprzętu (zobacz sekcję **Hardware & system requirements** w `README.md` w katalogu
  głównym repozytorium).
- **TOTP** — `kernel/crypto/totp` platformy opakowuje `otpauth` i pulę kodów zapasowych.
- **Plugin Fastify** — `plugin.ts` odczytuje ciasteczko sesji i ustawia
  `request.actor = { kind, id, ... }` oraz `request.adminActor`.
- **Zabezpieczenia tras** — `requireAdmin(permission?)`, `requireAdminAny(codes)` i
  `requireCustomer`, udostępniane jako porty z `backend.ts` i pobierane przez każdy moduł, który
  chroni trasy. Kiedyś były dekoratorami Fastify w pluginie; zamieniono je na porty, aby produkcja i
  środowisko testowe korzystały z tej samej implementacji, a nie z dwóch różnych.

## Brak własnych tras HTTP

`auth` to moduł z podstawowymi mechanizmami — endpointy logowania, wylogowania i 2FA należą do
modułów obsługujących klientów (`customer_accounts`) i administratorów (`admin_users`).

## Punkty rozszerzenia

- **Przechowywanie sesji** — `session-service` jest tworzony z `(em, redis)`; tu podłącza się
  alternatywną pamięć podręczną.
- **Własne rodzaje użytkowników** — rozszerz unię rozłączną `request.actor` i zaktualizuj
  pre-handlery `requireX`; istniejący kod nadal działa, bo trasy korzystają tylko z fabryk
  `requireX`, których już używają.

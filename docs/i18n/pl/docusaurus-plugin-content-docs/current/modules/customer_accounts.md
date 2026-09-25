---
title: customer_accounts
description: Logowanie klienta, reset hasła, 2FA, przypisanie roli
---

# `customer_accounts`

Stan per użytkownik dla Klientów: logowanie, zarządzanie hasłem, opcjonalne 2FA,
rola w ramach ich Organization. Wspierane przez współdzieloną usługę sesji `auth`;
ten moduł jest właścicielem powierzchni tożsamości po stronie klienta.

## Publiczne API

| Verb + Path | Cel |
| --- | --- |
| `POST /api/v1/auth/login` | E-mail + hasło (+ krok TOTP, gdy włączone 2FA) |
| `POST /api/v1/auth/logout` | Zniszczenie sesji |
| `POST /api/v1/me/password` | Zmiana hasła (odrzuca błędne `currentPassword`) |
| `POST /api/v1/auth/password-reset/request` | Rozpoczęcie przepływu resetu hasła |
| `POST /api/v1/auth/password-reset/confirm` | Realizacja tokenu resetu hasła |

## Encje

`CustomerAccount` (email, passwordHash, role), `PasswordResetToken`. Rola to
enum `organization_admin | regular_user`.

## Punkty rozszerzenia

- **Polityka haseł** — `password-hasher.ts` opakowuje argon2id; parametry kosztu
  dostosowujesz tam.
- **Kody zapasowe i drugie czynniki** — nie należą do tego modułu. 2FA klienta i admina
  obsługuje moduł `mfa`, nad `mfa_enrolments`, wystawione pod
  `/api/v1/account/mfa/*`; kody odzyskiwania to jednorazowe wiersze tam. Zastąpione
  rusztowanie, na które ten punkt wcześniej wskazywał
  (`totp-enrolment-service.ts`), usunięto 2026-08-25 — nigdy nie umożliwiało
  ukończenia pojedynczego enrolmentu.
- **Ograniczanie logowania** — opiera się na `@fastify/rate-limit` Fastify na poziomie
  serwera; blokada per konto dodałaby się tutaj.

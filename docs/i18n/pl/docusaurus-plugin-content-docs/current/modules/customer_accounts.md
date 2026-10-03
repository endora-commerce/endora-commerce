---
title: customer_accounts
description: Logowanie klientów, reset hasła, 2FA, przypisanie roli
---

# `customer_accounts`

Dane każdego użytkownika po stronie klienta: logowanie, zarządzanie hasłem, opcjonalne 2FA i rola
w organizacji. Moduł korzysta ze wspólnej usługi sesji z `auth`; odpowiada za tożsamość użytkowników
po stronie klienta.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/auth/login` | E-mail i hasło (oraz krok TOTP, gdy włączone jest 2FA) |
| `POST /api/v1/auth/logout` | Zakończenie sesji |
| `POST /api/v1/me/password` | Zmiana hasła (odrzuca błędne `currentPassword`) |
| `POST /api/v1/auth/password-reset/request` | Rozpoczęcie resetu hasła |
| `POST /api/v1/auth/password-reset/confirm` | Użycie tokenu resetu hasła |

## Encje

`CustomerAccount` (e-mail, passwordHash, rola), `PasswordResetToken`. Rola to wyliczenie
`organization_admin | regular_user`.

## Punkty rozszerzenia

- **Polityka haseł** — `password-hasher.ts` opakowuje argon2id; tam dostosowuje się parametry
  kosztu.
- **Kody zapasowe i drugie składniki uwierzytelniania** — nie należą do tego modułu. 2FA klientów i
  administratorów obsługuje moduł `mfa`, na tabeli `mfa_enrolments`, udostępniony pod
  `/api/v1/account/mfa/*`; kody odzyskiwania to tam jednorazowe wiersze. Zastąpiony szkielet, na
  który ten punkt wcześniej wskazywał (`totp-enrolment-service.ts`), usunięto 2026-08-25 — nigdy
  nie pozwalał dokończyć ani jednej rejestracji drugiego składnika.
- **Ograniczanie prób logowania** — opiera się na `@fastify/rate-limit` na poziomie serwera;
  blokadę dla pojedynczego konta dodaje się tutaj.

---
title: admin_users
description: Konta administratorów platformy + impersonacja
---

# `admin_users`

Konta administratorów platformy (oddzielne od Customer Accounts) oraz przepływ
impersonacji.

## Publiczne API

CRUD użytkowników i ról jest gated przez uprawnienie `admin_users:manage`.

| Verb + Path | Cel |
| --- | --- |
| `POST /api/v1/auth/admin/login` | Logowanie admina (wyzwanie 2FA, gdy Rola tego wymaga) |
| `POST /api/v1/auth/admin/logout` | Zniszczenie sesji admina |
| `GET /api/v1/admin/admin-users` | Lista użytkowników admina (wiersze usunięte są filtrowane) |
| `POST /api/v1/admin/admin-users` | Utworzenie użytkownika admina; odrzuca duplikat e-mail z `EMAIL_ALREADY_REGISTERED` |
| `PATCH /api/v1/admin/admin-users/:id` | Aktualizacja imienia / przypisania roli / statusu |
| `DELETE /api/v1/admin/admin-users/:id` | Soft delete (ustawia `deletedAt` + `status='inactive'`) |
| `GET /api/v1/admin/admin-roles` | Lista ról z tablicami uprawnień |
| `PUT /api/v1/admin/admin-roles/:code` | Upsert roli po code; nieznane uprawnienia zwracają 400 `VALIDATION_FAILED` |
| `DELETE /api/v1/admin/admin-roles/:id` | Usunięcie; odmowa z 409 `ADMIN_ROLE_IN_USE`, gdy jakikolwiek użytkownik nadal ma przypisaną rolę — **w tym soft-deleted**, którego przypisanie wraca po przywróceniu konta. Odmowa wymienia, która populacja trzyma rolę (`details.code` to `assigned` lub `assigned_to_deleted`) i ile ich jest |
| `GET /api/v1/admin/permissions` | Kanoniczny katalog uprawnień (moduł / code / label) używany przez UI macierzy |
| `POST /api/v1/admin/organizations/:id/impersonate` | Rozpoczęcie impersonacji; zapisuje wiersz audytu `impersonation.start` przed wydaniem cookie |
| `POST /api/v1/admin/impersonation/end` | Przywrócenie oryginalnej sesji admina |

## Model impersonacji

`impersonation-service.ts` implementuje wzorzec switch-user: rozpoczyna nową
sesję przypisaną do docelowego Customer + shadow id admina; kończy się czysto,
zapisując `impersonation.end`. Każda akcja podczas sesji impersonowanej niesie
zarówno `actorAdminUserId`, jak i `impersonatedCustomerAccountId` przez log
audytu.

## Encje

`AdminUser` (email, passwordHash, stan two-factor, pojedyncze `adminRoleId`,
`status`, soft-delete `deletedAt`).

`AdminRole` (code, nazwa wyświetlana, JSONB `permissions[]`,
`requiresTwoFactor`). Wildcard `*` jest tylko bootstrapowy i jest odrzucany przez
trasę upsert.

## Punkty rozszerzenia

- **Niestandardowe wyzwania logowania** — slot przed weryfikacją hasła w
  `admin-auth-service.ts`.
- **Konsumenci audytu impersonacji** — każdy wiersz audytu z akcją
  `impersonation.start|end` ma tę samą strukturę; downstream reporting może
  łączyć po nich.

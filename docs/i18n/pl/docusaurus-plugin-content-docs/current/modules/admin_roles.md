---
title: admin_roles
description: Definicje ról admina + uprawnienia per moduł
---

# `admin_roles`

Definicje ról admina i macierz uprawnień per moduł, którą rola przyznaje.

## Publiczne API

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/roles` | Lista ról |
| `POST /api/v1/admin/roles` | Utworzenie roli z zestawem uprawnień |
| `PATCH /api/v1/admin/roles/:id` | Aktualizacja roli |
| `DELETE /api/v1/admin/roles/:id` | Usunięcie (odrzucone, gdy przypisana do aktywnych użytkowników admina) |

## Model uprawnień

Uprawnienia to stringi w kształcie `module:action` (np. `catalog:write`,
`integrations:manage`, `audit:read`). `permission-service.ts` udostępnia
`hasPermission(adminUser, 'module:action')`; pre-handler `requireAdmin(permission?)`
w `auth/plugin.ts` konsultuje go na każdej gated trasie. Rola może też wymagać
2FA — `requireAdmin` wymusza wyzwanie 2FA przed wywołaniem handlera trasy.

## Encje

`AdminRole`, z `requires2fa: boolean` i kolumną `permissions: string[]`.

## Punkty rozszerzenia

- **Niestandardowe stringi uprawnień** — definiuj nowe przy pierwszym użyciu;
  zestaw uprawnień jest otwarty i nie jest enumerowany po stronie serwera.
- **Role hierarchiczne** — `permission-service.hasPermission` może rozwiązywać
  dziedziczone uprawnienia; dziś każda Rola jest płaska.

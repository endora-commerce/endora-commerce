---
title: admin_roles
description: Role administratorów i uprawnienia poszczególnych modułów
---

# `admin_roles`

Definicje ról administratorów oraz macierz uprawnień modułów, które rola przyznaje.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/roles` | Lista ról |
| `POST /api/v1/admin/roles` | Utworzenie roli z zestawem uprawnień |
| `PATCH /api/v1/admin/roles/:id` | Aktualizacja roli |
| `DELETE /api/v1/admin/roles/:id` | Usunięcie (odrzucane, gdy rola jest przypisana do aktywnych administratorów) |

## Model uprawnień

Uprawnienia to stringi w postaci `module:action` (np. `catalog:write`, `integrations:manage`,
`audit:read`). `permission-service.ts` udostępnia `hasPermission(adminUser, 'module:action')`;
pre-handler `requireAdmin(permission?)` w `auth/plugin.ts` sprawdza je na każdej chronionej trasie.
Rola może też wymagać 2FA — `requireAdmin` wymusza wtedy weryfikację drugiego składnika, zanim
wykona się handler trasy.

## Encje

`AdminRole`, z `requires2fa: boolean` i kolumną `permissions: string[]`.

## Punkty rozszerzenia

- **Własne kody uprawnień** — definiuj nowe przy pierwszym użyciu; zbiór uprawnień jest otwarty i
  serwer go nie wylicza.
- **Role hierarchiczne** — `permission-service.hasPermission` mogłoby uwzględniać uprawnienia
  dziedziczone; dziś każda rola jest płaska.

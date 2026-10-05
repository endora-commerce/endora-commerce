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

## Rola administratora platformy

Każda instancja ma jedną rolę, którą platforma tworzy sama: `platform_admin`, wyświetlaną jako
*Administrator platformy*, z symbolem wieloznacznym `*` — czyli z każdym uprawnieniem. Instalacja
modułu tworzy tę rolę, a każdy start sprawdza, czy nadal istnieje i daje pełny dostęp, więc rola
przypisywana administratorowi domyślnie jest zawsze dostępna. Zestawu jej uprawnień nie można
zawęzić, a samej roli nie można usunąć (409 `ADMIN_ROLE_PROTECTED`), niezależnie od tego, czy
ktokolwiek ją ma. Zmiana nazwy jest dozwolona i zostaje zachowana.

Administrator musi mieć rolę. `hasPermission` odrzuca aktywnego administratora bez roli kodem
403 `ADMIN_ROLE_REQUIRED`, zamiast odpowiadać „nie”, dzięki czemu operator wie, co naprawić;
sposób naprawy opisuje strona modułu `admin_users`.

## Encje

`AdminRole`, z `requires2fa: boolean` i kolumną `permissions: string[]`.

## Punkty rozszerzenia

- **Własne kody uprawnień** — definiuj nowe przy pierwszym użyciu; zbiór uprawnień jest otwarty i
  serwer go nie wylicza.
- **Role hierarchiczne** — `permission-service.hasPermission` mogłoby uwzględniać uprawnienia
  dziedziczone; dziś każda rola jest płaska.

---
title: Role administratorów
description: Role administratorów i uprawnienia poszczególnych modułów
---

# Role administratorów (`admin_roles`)

Definicje ról administratorów oraz macierz uprawnień modułów, które rola przyznaje.

## API publiczne

Ten moduł nie ma własnych tras. Trasy ról obsługuje `admin_users`, korzystając z usług tego
modułu, wszystkie z uprawnieniem `admin_users:manage`; strona tamtego modułu opisuje każdą
odpowiedź.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/admin-roles` | Lista ról z tablicami uprawnień |
| `PUT /api/v1/admin/admin-roles/:code` | Utworzenie lub aktualizacja roli o tym kodzie (nieznane kody uprawnień dają `400 VALIDATION_FAILED`) |
| `GET /api/v1/admin/admin-roles/:code/two-factor-impact` | Ilu posiadaczy roli zostałoby wylogowanych po włączeniu jej wymagania weryfikacji dwuetapowej |
| `DELETE /api/v1/admin/admin-roles/:id` | Usunięcie (`409 ADMIN_ROLE_IN_USE`, dopóki ma ją jakikolwiek administrator, także usunięty miękko) |
| `GET /api/v1/admin/permissions` | Katalog kodów uprawnień, które operator może przyznać |

## Model uprawnień

Uprawnienia to stringi w postaci `module:action` (np. `catalog:write`, `integrations:manage`,
`audit_log:read`). `permission-service.ts` udostępnia `hasPermission(adminUserId, 'module:action')`;
zabezpieczenie `requireAdmin(permission?)`, port modułu `auth`, sprawdza je na każdej chronionej
trasie. Rola może też wymagać weryfikacji dwuetapowej (`requiresTwoFactor`): jej posiadacze są
proszeni o drugi składnik przy logowaniu, przez moduł `mfa`, a włączenie wymagania wylogowuje
posiadaczy, którzy go nie mają (zob. `admin_users`).

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

`AdminRole`, z `requiresTwoFactor: boolean` i kolumną `permissions: string[]` (JSON).

## Punkty rozszerzenia

- **Własne kody uprawnień** — moduł deklaruje swoje kody w polu `permissions` manifestu; katalog
  (`permission-catalogue.service.ts`) oferuje na `/admin-roles` kody wszystkich obecnych modułów,
  a rolę zapisuje się tylko ze znanymi kodami (także wyłączonego modułu) albo z symbolem
  wieloznacznym `*`.
- **Role hierarchiczne** — `permission-service.hasPermission` mogłoby uwzględniać uprawnienia
  dziedziczone; dziś każda rola jest płaska.

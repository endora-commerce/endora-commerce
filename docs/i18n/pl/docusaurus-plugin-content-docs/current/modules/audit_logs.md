---
title: audit_logs
description: Dziennik audytu wrażliwych operacji
---

# `audit_logs`

Dziennik audytu każdej wrażliwej operacji, do którego można wyłącznie dopisywać. Każdy wpis
zapisuje, kto, co i kiedy zrobił — a podczas logowania jako klient także w czyim imieniu.

Wykonawca jest jednym z trzech. Administrator (`actorAdminUserId`) jest pokazywany z imieniem,
nazwiskiem i adresem e-mail. Klient działający we własnym imieniu w sklepie
(`actorCustomerAccountId`), na przykład administrator organizacji zarządzający rolami,
zaproszeniami lub członkami, jest pokazywany jako *Klient: …*. Wpis bez żadnego z nich jest
pokazywany jako *system*. Podczas logowania jako klient wpis wskazuje faktycznego administratora,
a klienta zapisuje w `impersonatedCustomerAccountId`; `actorCustomerAccountId` pozostaje wtedy puste.

## API publiczne

Wymaga uprawnienia `audit_log:read`.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/audit-log` | Zapytanie do dziennika. Filtry: `filter[actor]`, `filter[customer]`, `filter[action]`, `filter[objectType]`, `filter[objectId]`. Domyślnie `limit=100`, najwyżej 500. Każdy wiersz zawiera od razu JSON `stateBefore` / `stateAfter`, aby przeglądarka w panelu mogła pokazać różnice obok siebie bez drugiego zapytania. Wiersz zawiera też `actorCustomerAccountId` i `actorCustomerLabel` — etykietę klienta w dzienniku audytu: osobę w postaci *Imię Nazwisko (e-mail)*, a gdy konto nie ma imienia ani nazwiska — sam adres e-mail. Klient, pod którego podszywa się administrator, jest opisywany tak samo. |

## Zapisywanie

`AuditPort.record({ ... })` jest wywoływany przy każdej wrażliwej zmianie: zmianie ceny w katalogu,
zmianie roli, korekcie limitu kredytowego, zmianie statusu zamówienia lub płatności „w imieniu”
klienta, rozpoczęciu i zakończeniu logowania jako klient, użyciu klucza API poza jego zakresem i
innych. Dodanie nowej wrażliwej zmiany to dwa wiersze w miejscu wywołania.

Port to typ, którego używa moduł, a publikuje jądro (`packages/platform/src/kernel/ports/audit.ts`);
nazwa w kontenerze, pod którą jest rejestrowany, to `auditLogService` i się nie zmieniła.
Implementacja za nim, `AuditLogService`, należy do platformy i jest dostępna tylko przez ścieżkę
względną — moduł, który odwoływałby się do tej klasy, zależałby od kształtu mechanizmu zapisu,
który jednolity audyt zapisów omija, bo zapis domenowy przechodzi przez `CommandBus.run`, a to
Command Bus zapisuje wpis.

## Encje

`AuditLogEntry` — `actorAdminUserId`, opcjonalne `impersonatedCustomerAccountId`, opcjonalne
`actorCustomerAccountId`, `action`,
`objectType`, `objectId`, `stateBefore`, `stateAfter`, `ipAddress`, `userAgent`, `requestId`,
`actedAt`.

## Punkty rozszerzenia

- **Wysyłka do zewnętrznego systemu SIEM** — emituj zdarzenie domenowe przy każdym nowym wpisie
  audytu i pozwól integracji przekazywać strumień do Splunk, Elastic itp.
- **Okres przechowywania** — dziś wpisy nie są automatycznie usuwane; okres przechowywania określa
  ten, kto utrzymuje platformę.

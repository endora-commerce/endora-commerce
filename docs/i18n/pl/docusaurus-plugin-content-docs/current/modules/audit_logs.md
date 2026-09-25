---
title: audit_logs
description: Ślad audytu wrażliwych akcji
---

# `audit_logs`

Append-only ślad audytu każdej wrażliwej akcji. Każdy wiersz rejestruje kto,
co, kiedy — i (podczas impersonacji) w czyim imieniu.

## Publiczne API

Gated przez uprawnienie `audit_log:read`.

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/audit-log` | Zapytanie do append-only logu. Filtry: `filter[actor]`, `filter[customer]`, `filter[action]`, `filter[objectType]`, `filter[objectId]`. Domyślnie `limit=100`, limit górny 500. Każdy wiersz niesie `stateBefore` / `stateAfter` JSON inline, aby viewer admina mógł renderować diffy obok siebie bez drugiego roundtripu. |

## Rejestrowanie

`AuditPort.record({ ... })` jest wywoływany z każdej wrażliwej mutacji: zmiana
ceny w katalogu, zmiana roli, korekta limitu kredytowego, zmiana statusu
zamówienia / statusu płatności „w imieniu”, start/koniec impersonacji, klucz
API poza zakresem i inne. Dodanie nowej wrażliwej mutacji to dwulinijkowa
zmiana w miejscu wywołania.

Port to to, co moduł typuje, a kernel publikuje
(`packages/platform/src/kernel/ports/audit.ts`); nazwa kontenera, pod
którą jest rejestrowany, to `auditLogService` i się nie zmieniła. Implementacja
za nim, `AuditLogService`, należy do platformy i jest osiągalna tylko po
ścieżce względnej — moduł, który nazwałby klasę, zależałby od kształtu
writera, który jednolity audyt zapisów omija, bo zapis domenowy idzie przez
`CommandBus.run`, a bus zapisuje wiersz.

## Encje

`AuditLogEntry` — `actorAdminUserId`, opcjonalne
`impersonatedCustomerAccountId`, `action`, `objectType`, `objectId`,
`stateBefore`, `stateAfter`, `ipAddress`, `userAgent`, `requestId`,
`actedAt`.

## Punkty rozszerzenia

- **Wysyłka do zewnętrznego SIEM** — emituj zdarzenie domenowe przy każdym
  nowym wierszu audytu i pozwól integracji odprowadzać strumień do Splunk /
  Elastic / itd.
- **Retencja** — dziś brak automatycznego przycinania; okna retencji należą do
  tego, kto uruchamia platformę.

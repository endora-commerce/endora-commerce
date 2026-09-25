---
title: Endpoint health
description: Sonda liveness + readiness
---

# Endpoint health

Sonda liveness + readiness.

To jest element platformy, a nie modułu. Każda instancja Endora go udostępnia,
ponieważ jest instancją Endora: `@endora-commerce/platform` rejestruje trasę ze swojej
własnej kompozycji aplikacji, więc nie ma nic do instalacji, nic do włączenia i nie ma
polecenia, które mogłoby go usunąć. Kiedyś był modułem `health_checks`, co oznaczało, że
instancja ze scaffoldu — którego zestaw modułów wynika z modułów deklarujących się jako
niewyłączalne — go nie miała, a kontener API nigdy nie stawał się zdrowy.

Ta strona znajduje się w drzewie samej witryny, a nie obok źródeł modułu, na precedencie
[Cyklu życia modułu](../modules/lifecycle.md), którego temat jest również częścią pakietu
platformy.

## Publiczne API

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/_health` | Zwraca `200` z JSON-em ze statusem dostępności Postgres, Redis i Meilisearch. Zwraca `503`, gdy któraś zależność jest niedostępna. |

## Przypadki użycia

- Sonda readiness/liveness orchestratora kontenerów.
- Health check load balancera przy graceful drain.
- Monitoring syntetyczny.

## Punkty rozszerzenia

Dodaj nowe zależności do sondy, rozszerzając listę sprawdzeń w
`packages/platform/src/http/health.ts`. Każda sonda powinna być tania (pojedynczy ping
/ `SELECT 1`) i ograniczona czasowo (timeout ≤ 200 ms).

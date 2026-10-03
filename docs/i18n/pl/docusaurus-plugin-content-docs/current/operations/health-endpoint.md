---
title: Endpoint stanu (health)
description: Sprawdzanie, czy usługa działa i jest gotowa (liveness i readiness)
---

# Endpoint stanu (health)

Sprawdzanie, czy usługa działa i jest gotowa do obsługi ruchu (liveness i readiness).

To część platformy, a nie modułu. Udostępnia go każda instancja Endory, właśnie dlatego, że jest
instancją Endory: `@endora-commerce/platform` rejestruje tę trasę we własnej kompozycji aplikacji,
więc nie ma czego instalować ani włączać i nie ma polecenia, które mogłoby ją usunąć. Kiedyś był to
moduł `health_checks`, przez co instancja utworzona z szablonu — której zestaw modułów wynika z
modułów deklarujących się jako niewyłączalne — go nie miała, a kontener API nigdy nie przechodził w
stan „healthy”.

Ta strona znajduje się w drzewie samej witryny, a nie obok kodu modułu, tak samo jak strona
[Cykl życia modułu](../modules/lifecycle.md), której temat też jest częścią pakietu platformy.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/_health` | Zwraca `200` z JSON-em opisującym dostępność Postgresa, Redis i Meilisearch. Zwraca `503`, gdy któraś z tych usług jest niedostępna. |

## Zastosowania

- Sprawdzanie gotowości i działania przez orkiestrator kontenerów.
- Sprawdzanie stanu przez load balancer przy łagodnym wyłączaniu instancji.
- Monitoring syntetyczny.

## Punkty rozszerzenia

Nowe zależności dodaje się do sprawdzania, rozszerzając listę testów w
`packages/platform/src/http/health.ts`. Każdy test powinien być tani (pojedynczy ping albo
`SELECT 1`) i ograniczony czasowo (limit ≤ 200 ms).

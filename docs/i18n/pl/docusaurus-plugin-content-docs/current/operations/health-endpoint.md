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
| `GET /api/v1/admin/platform-info` | Tylko dla zalogowanych administratorów. Zwraca `200` z `{ "version": … }`, czyli wydaniem opisanym niżej. Nie sprawdza żadnej zależności. |

## Pole `version`

Pole `version` w odpowiedzi to **wydanie Endora Commerce**, na którym działa instancja — wersja
pakietu `@endora-commerce/platform` załadowanego przez proces serwera, na przykład `0.104.0`.
Wszystkie pakiety `@endora-commerce/*` są wydawane pod jedną wspólną wersją, więc ten jeden numer
nazywa całe wydanie.

Nie jest to wersja z pliku `package.json` Twojej instancji i żadne ustawienie środowiska jej nie
zmienia. Przed tą poprawką pole czytało `npm_package_version`, czyli wersję z manifestu aplikacji
hosta, której w ogóle nie ma, gdy kontener uruchamia serwer poleceniem `node dist/index.js`;
dlatego każde wdrożenie zgłaszało `0.0.0`. Jeśli platforma nie potrafi odczytać własnego wydania,
pole ma wartość `unknown`, a nie liczbę.

Panel administracyjny pokazuje ten sam numer jako znaczek pod nazwą w nagłówku paska bocznego.
Odczytuje go z `GET /api/v1/admin/platform-info` — endpointu dla zalogowanego administratora,
który odpowiada `{ "version": "0.104.0" }` (albo `null`) i nie sprawdza żadnej zależności — a nie
z tego endpointu stanu, który odpowiada `503`, gdy któraś zależność jest niedostępna. Gdy wydanie
jest nieznane, znaczek w ogóle się nie pojawia. Przy zwiniętym pasku bocznym wydanie jest w
podpowiedzi nad logo.

## Zastosowania

- Sprawdzanie gotowości i działania przez orkiestrator kontenerów.
- Sprawdzanie stanu przez load balancer przy łagodnym wyłączaniu instancji.
- Monitoring syntetyczny.

## Punkty rozszerzenia

Nowe zależności dodaje się do sprawdzania, rozszerzając listę testów w
`packages/platform/src/http/health.ts`. Każdy test powinien być tani (pojedynczy ping albo
`SELECT 1`) i ograniczony czasowo (limit ≤ 200 ms).

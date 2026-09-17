---
title: webhooks
description: Subskrypcje zdarzeń wychodzących z podpisem HMAC
---

# `webhooks`

Subskrypcje zdarzeń wychodzących z podpisem HMAC. Zdarzenia domenowe na
in-process event bus są bridgowane do kolejki BullMQ; worker podpisuje i POST'uje
każdą dostawę na URL subskrybenta.

## Publiczne API

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/webhooks` | Lista subskrypcji |
| `POST /api/v1/admin/webhooks` | Utworzenie — secret zwracany raz |
| `PATCH /api/v1/admin/webhooks/:id` | Aktualizacja (status, eventTypes, url) |
| `DELETE /api/v1/admin/webhooks/:id` | Usunięcie |
| `GET /api/v1/admin/webhooks/deliveries` | Ostatnie dostawy (filtrowalne po statusie) |
| `POST /api/v1/admin/webhooks/deliveries/:id/replay` | Replay dostawy `failed` / `dead_lettered` |

## Kontrakt dostawy

Nagłówki: `Content-Type: application/json`,
`X-Webhook-Event-Id`, `X-Webhook-Event-Type`,
`X-Webhook-Signature-256`, `X-Webhook-Attempt`. Odbiorcy MUSZĄ weryfikować
podpis przez `timingSafeEqual` i deduplikować po id zdarzenia.
Sekcja *Subscribing to webhooks* w przewodniku Integrations Endora niesie
przykład weryfikacji.

## Model retry

Do 8 prób na dostawę, exponential backoff od 1 s, timeout 10 s per próba.
Ostatnia próba → `dead_lettered`. Endpoint replay kopiuje wiersz
failed/dead-lettered do świeżej dostawy `pending`.

## Encje

`Webhook` (name, url, eventTypes, secret, status), `WebhookDelivery`
(wiersz audytu per próba).

## Punkty rozszerzenia

- **Niestandardowy schemat podpisu** — `webhook-delivery-worker.ts#process` to
  jedyne miejsce, gdzie ustawiane są nagłówki HMAC; zamień na inny format
  podpisu lub dodaj wariant JWS tutaj.
- **Polityka scope subskrypcji** — `webhook-service.ts#create` dziś akceptuje
  dowolny typ zdarzenia; nałóż autoryzację (np. tylko wybrane integracje
  mogą subskrybować `payment.*`) przez wstrzyknięcie callbacku polityki.

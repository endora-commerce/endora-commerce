---
title: webhooks
description: Subskrypcje zdarzeń wychodzących podpisywanych HMAC
---

# `webhooks`

Subskrypcje zdarzeń wychodzących podpisywanych HMAC. Zdarzenia domenowe z działającej w procesie
szyny zdarzeń są przekazywane do kolejki BullMQ; worker podpisuje każdą wysyłkę i wysyła ją
żądaniem POST na adres URL subskrybenta.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/webhooks` | Lista subskrypcji |
| `POST /api/v1/admin/webhooks` | Utworzenie — sekret jest zwracany tylko raz |
| `PATCH /api/v1/admin/webhooks/:id` | Aktualizacja (status, eventTypes, url) |
| `DELETE /api/v1/admin/webhooks/:id` | Usunięcie |
| `GET /api/v1/admin/webhooks/deliveries` | Ostatnie wysyłki (z filtrowaniem według statusu) |
| `POST /api/v1/admin/webhooks/deliveries/:id/replay` | Ponowienie wysyłki `failed` / `dead_lettered` |
| `GET /api/v1/admin/webhooks/event-types` | Typy zdarzeń wnoszone przez inne moduły, których właściciel jest włączony |

## Kontrakt wysyłki

Nagłówki: `Content-Type: application/json`, `X-Webhook-Event-Id`, `X-Webhook-Event-Type`,
`X-Webhook-Signature-256`, `X-Webhook-Attempt`. Odbiorcy MUSZĄ weryfikować podpis przez
`timingSafeEqual` i usuwać duplikaty według identyfikatora zdarzenia. Przykład weryfikacji zawiera
sekcja *Subscribing to webhooks* w przewodniku po integracjach Endory.

## Ponawianie

Do 8 prób na wysyłkę, z wykładniczo rosnącym odstępem od 1 s i limitem czasu 10 s na próbę. Po
ostatniej próbie wysyłka przechodzi w stan `dead_lettered`. Endpoint ponowienia kopiuje wiersz
`failed` / `dead_lettered` jako nową wysyłkę `pending`.

## Typy zdarzeń wnoszone przez inne moduły

Ten moduł sam z siebie przekazuje dwa typy zdarzeń: `order.created.v1` i
`order.status_changed.v1`. Każdy inny moduł może zaoferować własne typy zdarzeń
przez **`webhookEventRegistry`** — ten moduł nie wymienia zdarzeń żadnego innego
modułu.

Moduł wnoszący zdarzenia zgłasza ich nazwy w haku startowym, który nie robi nic
innego:

```ts
ctx.onBoot(() => {
  const registry = lazyPort<WebhookEventRegistryPort>(ctx, 'webhookEventRegistry');
  registry.register({ ownerModuleId: 'acme_loyalty', eventType: 'acme_loyalty.points_granted.v1' });
});
```

i deklaruje tę zależność w swoim manifeście:
`nonBindingDependencies: [{ moduleId: 'webhooks', name: 'webhookEventRegistry', kind: 'contributes-to' }]`.

Co wynika ze zgłoszenia:

- **Typ zdarzenia jest przekazywany** do kolejki wysyłek dokładnie tak jak typy
  wbudowane — przez własną subskrypcję tego modułu, więc zatrzymuje się, gdy ten
  moduł zostaje wyłączony. **Treść zdarzenia jest wysyłana w całości**, więc
  zdarzenie oferowane przez moduł jest jego publicznym kontraktem.
- **Typ jest oferowany w formularzu subskrypcji** — za własną listą formularza —
  dopóki jego właściciel jest włączony. `GET /api/v1/admin/webhooks/event-types`
  odpowiada `{ "data": [{ "ownerModuleId", "eventType" }] }`.
- **Gdy właściciel jest wyłączony**, typ nie jest oferowany. Subskrypcje, które
  go wskazują, zostają zachowane i nic nie dostają, dopóki właściciel nie wróci.
- Subskrypcja przypisana do jednej organizacji dostaje wniesione zdarzenie tylko
  wtedy, gdy jego treść zawiera to `organizationId`.
- Zgłoszenie tego samego typu dwa razy albo typu, który ten moduł już
  przekazuje, daje jedną wysyłkę.

## Encje

`Webhook` (name, url, eventTypes, secret, status), `WebhookDelivery` (wiersz audytu dla każdej
próby).

## Punkty rozszerzenia

- **Własny schemat podpisu** — `webhook-delivery-worker.ts#process` to jedyne miejsce, w którym
  ustawiane są nagłówki HMAC; tam zmienisz format podpisu albo dodasz wariant JWS.
- **Zasady dotyczące zakresu subskrypcji** — `webhook-service.ts#create` przyjmuje dziś dowolny typ
  zdarzenia; ogranicz to (np. tak, by `payment.*` mogły subskrybować tylko wybrane integracje),
  wstrzykując funkcję sprawdzającą.

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
| `POST /api/v1/admin/webhooks` | Utworzenie — sekret jest zwracany tylko raz. `eventTypes` muszą być dostarczane |
| `PATCH /api/v1/admin/webhooks/:id` | Aktualizacja (status, eventTypes, url). Dodawane typy zdarzeń muszą być dostarczane |
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

## Które zdarzenia są dostarczane

Zdarzenie jest dostarczane tylko wtedy, gdy jest przekazywane do kolejki wysyłek. Ten moduł sam z
siebie przekazuje dwa typy zdarzeń: `order.created.v1` i `order.status_changed.v1`; każdy inny
dostarczany typ wnosi moduł, który go emituje (następna sekcja). Zdarzenie jedynie wyemitowane na
działającej w procesie szynie zdarzeń nie jest dostarczane.

Dwie nazwy wbudowane to jedna stała, `WEBHOOK_BUILT_IN_EVENT_TYPES` w `@endora-commerce/contracts`.
Backend zakłada z niej swoje przekazywanie, a formularz subskrypcji z niej oferuje, więc formularz
nie może zaoferować zdarzenia, które nie jest dostarczane.

**Subskrypcja może wskazywać wyłącznie dostarczane typy zdarzeń.** Utworzenie subskrypcji albo
dodanie do niej typu zdarzenia o nazwie, która nie jest ani wbudowana, ani wniesiona przez włączony
moduł, jest odrzucane z `422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`; `error.details.eventTypes` zawiera
odrzucone nazwy.

**Subskrypcje zapisane przed wprowadzeniem tej reguły pozostają bez zmian.** Reguła jest stosowana
przy zapisie subskrypcji i tylko do nazw, które ten zapis dodaje:

- nic nie jest migrowane ani usuwane, a lista nigdy nie zawodzi z powodu zapisanej nazwy;
- taką subskrypcję nadal można wstrzymać, przemianować, skierować pod inny adres i usunąć, a
  aktualizacja `eventTypes` może zachować nazwę, którą subskrypcja już zawiera;
- usuniętej nazwy nie da się dodać z powrotem;
- ekran Webhooki pokazuje każdą zapisaną nazwę i oznacza te, które nie są dostarczane;
- dostarczanie się nie zmienia — nazwa, której nic nie przekazuje, nic nie dostaje, tak jak dotąd.

## Typy zdarzeń wnoszone przez inne moduły

Każdy inny moduł może zaoferować własne typy zdarzeń przez **`webhookEventRegistry`** — ten moduł
nie wymienia zdarzeń żadnego innego modułu.

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
- **Typ jest oferowany w formularzu subskrypcji** — za typami wbudowanymi — i
  przyjmowany przez API, dopóki jego właściciel jest włączony. `GET /api/v1/admin/webhooks/event-types`
  odpowiada `{ "data": [{ "ownerModuleId", "eventType" }] }`.
- **Gdy właściciel jest wyłączony**, typ nie jest oferowany, a nowa subskrypcja
  tego typu jest odrzucana. Subskrypcje, które go wskazują, zostają zachowane i
  nic nie dostają, dopóki właściciel nie wróci.
- Subskrypcja przypisana do jednej organizacji dostaje wniesione zdarzenie tylko
  wtedy, gdy jego treść zawiera to `organizationId`.
- Zgłoszenie tego samego typu dwa razy albo typu, który ten moduł już
  przekazuje, daje jedną wysyłkę.

### Kto dziś wnosi zdarzenia

| Moduł | Typy zdarzeń | Treść opisana |
| --- | --- | --- |
| `catalog` | `product.created.v1`, `product.updated.v1`, `product.archived.v1` | na stronie modułu `catalog` |
| `quote_requests` | `rfq.created.v1`, `rfq.expired.v1` | na stronie modułu `quote_requests` |
| `credit_limits` | `credit_limit.adjusted.v1` | na stronie modułu `credit_limits` |
| `crm` | `crm.opportunity.status_changed.v1`, `crm.opportunity.created.v1`, `crm.opportunity.closed.v1` | w `packages/contracts/src/crm.ts` |

Jedna reguła dla wszystkich: zdarzenie oferuje ten moduł, który je emituje. `order.created.v1` i
`order.status_changed.v1` to dwa zdarzenia, które ten moduł przekazywał, zanim powstał rejestr, i
pozostają wbudowane.

### Kto dostaje zdarzenie

Subskrypcje tworzy administrator z uprawnieniem `integrations:manage`; klient nie ma żadnego
sposobu, by utworzyć subskrypcję. Subskrypcja obejmuje całą platformę albo jest powiązana z jedną
organizacją, a o każdym zdarzeniu rozstrzyga przekazywanie:

- zdarzenie, którego treść zawiera `organizationId`, trafia do każdej subskrypcji obejmującej całą
  platformę, która wskazuje jego typ, oraz do subskrypcji powiązanych z **tą** organizacją — takie
  są zdarzenia zapytań ofertowych, limitu kredytowego, zamówień i CRM;
- zdarzenie, którego treść go nie zawiera, trafia tylko do subskrypcji obejmujących całą
  platformę — takie są zdarzenia produktów, więc subskrypcja powiązana z organizacją nigdy ich nie
  dostaje.

Subskrypcje nie mają wymiaru kanału sprzedaży: zdarzenie nie jest filtrowane według kanału, w
którym nastąpiło.

### Ile kosztuje jedno zdarzenie

Dla każdego przekazywanego zdarzenia moduł raz odczytuje aktywne subskrypcje i dodaje do kolejki
wysyłek jedno zadanie na każdą subskrypcję, która wskazuje dany typ i spełnia regułę organizacji.
Gdy takiej subskrypcji nie ma, do kolejki nic nie trafia. Nic nie jest łączone w paczki ani
scalane: edycja zbiorcza, import albo synchronizacja z PIM, które zapisują tysiąc produktów, to
tysiąc zdarzeń `product.updated.v1` i — na każdą subskrypcję wskazującą ten typ — tysiąc wysyłek.

## Encje

`Webhook` (name, url, eventTypes, secret, status), `WebhookDelivery` (wiersz audytu dla każdej
próby).

## Punkty rozszerzenia

- **Własny schemat podpisu** — `webhook-delivery-worker.ts#process` to jedyne miejsce, w którym
  ustawiane są nagłówki HMAC; tam zmienisz format podpisu albo dodasz wariant JWS.
- **Zasady dotyczące zakresu subskrypcji** — `webhook-service.ts` przyjmuje dowolny dostarczany typ
  zdarzenia; ogranicz to (np. tak, by zdarzenia jednego modułu mogły subskrybować tylko wybrane
  integracje), wstrzykując funkcję sprawdzającą.

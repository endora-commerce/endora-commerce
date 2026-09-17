---
title: orders
description: Składanie zamówień, maszyna statusów, powiązanie płatności i dostawy
---

# `orders`

Składanie zamówień, cykl życia i kontrola dostępu. Komponuje rozwiązywanie cen koszyka,
rezerwację stanu magazynowego, dispatch sterownika płatności, generowanie faktur
oraz logowanie audytu.

## Publiczne API

Trasy admina są chronione przez `orders:read` (odczyt) / `orders:write` (mutacje).

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `POST /api/v1/orders` | customer | Złożenie zamówienia z aktywnego Cart |
| `GET /api/v1/orders` | customer | Lista zamówień w zakresie roli (Regular vs Org Admin) |
| `GET /api/v1/orders/:id` | customer | Szczegóły zamówienia |
| `GET /api/v1/orders/:id/invoice` | customer | Pobranie faktury PDF |
| `GET /api/v1/admin/orders` | admin | Lista wszystkich zamówień (cross-organization) |
| `GET /api/v1/admin/orders/:id` | admin | Szczegóły zamówienia (pomija zakres klienta) |
| `POST /api/v1/admin/orders/:id/status` | admin | Przejście statusu (audytowane) |
| `POST /api/v1/admin/orders/:id/payment-status` | admin | Przejście statusu płatności (audytowane) |

## Maszyna statusów (konfigurowalna — feature 038)

Cykl życia zamówienia jest **konfigurowalny w adminie**: statusy i dozwolone
przejścia żyją w tabelach `order_statuses` i `order_status_transitions`,
seedowanych przy instalacji z dziewięcioma domyślnymi — `new` (początkowy,
nieusuwalny), `pending`, `paid`, `processing`, `shipment_ready`,
`shipment_sent`, `completed` (terminalny), `on_hold`, `cancelled` (terminalny) —
plus predefiniowane krawędzie oraz uniwersalne krawędzie `→ on_hold` / `→ cancelled`
(oraz `on_hold → any`). Admini zarządzają nimi przez endpointy
`/api/v1/admin/orders/statuses` + `/transitions`; graf jest cache'owany
in-process i ponownie walidowany przy każdej edycji.

`OrderTransitionService.apply()` to jedyna autorytatywna maszyna stanów:
odrzuca przejścia bez skonfigurowanej krawędzi lub ze statusu terminalnego,
uruchamia **before-guards** z możliwością weta (`onOrderTransitionGuard`), a następnie
emituje zdarzenia szablonowe (poniżej). Zdarzenia płatności/wysyłki napędzają
automatyczne przejścia przez `OrderStatusRegistry` (kolumny `statusOn*` odnoszą się
do tych kodów statusu); `payment_status` pozostaje polem pochodnym/drugorzędnym.

## Encje

`Order`, `OrderItem`, `Payment`, plus feature 038: `OrderStatus`,
`OrderStatusTransition`, `OrderComment`, `OrderListSavedView` oraz kolumna
`organizations.order_confirmation_emails` (właściciel: `organizations`,
odczyt przez port). `OrderItem` snapshotuje produkt + wariant + cenę jednostkową +
stawkę podatku w momencie składania, aby historyczne zamówienia przetrwały zmiany
cen / katalogu.

## Emitowane zdarzenia

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`. Każde
przejście X→Y dodatkowo emituje cztery **szablonowe** zdarzenia (feature 038,
budowane przez `events/order-status-events.ts`):
`order.status.from_<x>_to_<y>.before`, `order.status.from_<x>.before`
(synchroniczne, z możliwością weta) oraz `order.status.from_<x>_to_<y>.after`,
`order.status.to_<y>.after` (po commicie, izolowane).

## Operacje admina (feature 038)

- **Tworzenie w imieniu** — `POST /api/v1/admin/orders` buduje koszyk klienta
  z pozycji wprowadzonych przez admina i uruchamia `placeOrder` on-behalf; klient
  dostaje e-mail z prośbą o opłacenie.
- **Lista** — `GET /api/v1/admin/orders` filtr/sort/wyszukiwanie po stronie serwera +
  liczniki per status; `GET …/export` streamuje CSV; zapisane widoki przez
  `…/list-views` (prywatne lub współdzielone).
- **Bulk** — `POST …/bulk/status` (kwalifikujące się zamówienia przechodzą; pominięte
  raportowane z powodem) oraz `…/bulk/print-invoices`.
- **Komentarze** — admin/klient `…/:id/comments` z flagami widoczności dla klienta +
  notify; zamknięte na zamówieniach terminalnych.
- **Reorder** — `…/:id/reorder` odbudowuje koszyk (gated przez
  `orders.reorder_enabled`); **clone-to-quote** — `…/:id/clone-to-quote`.

## Ustawienia (feature 038)

`orders.min_order_value` (number, bramkuje Checkout + admin create),
`orders.reorder_enabled` (boolean), `orders.confirmation_recipients`
(lista stringów) — wszystkie globalnie lub per sales channel. Plus per-org
`order_confirmation_emails`. E-mail potwierdzający CC-uje klienta + listę org
+ listę zakresu (best-effort, nigdy nie blokuje składania).

## E-mail potwierdzenia zamówienia (feature 034)

Po udanym checkout `OrderService.placeOrder` wysyła e-mail potwierdzający
(po commicie, best-effort — błąd poczty nigdy nie cofa złożonego zamówienia).
Zbudowany przez `email-templates/order-confirmation.ts`, zawiera zamówione
produkty z kwotami, metodę dostawy + koszt, metodę płatności z ewentualnym
dodatkowym kosztem płatności (np. `+5.00 PLN` przy pobraniu), zastosowane
rabaty, podsumowanie sumy zamówienia oraz adresy wysyłki i rozliczeniowe. Linia
płatności renderowana jest przez rejestr rendererów e-mail płatności
(`payments/services/payment-email-renderer.ts`) — klucz `renderers.email` adaptera
nadpisuje domyślny renderer platformy.

## Punkty rozszerzenia

- **Adaptery płatności** — zobacz moduł `payment_methods`. `placeOrder`
  dispatchuje start-payment przez `PaymentAdapterRegistry`; nowe metody
  rejestrują adapter zamiast edytować serwis zamówień.
- **Zakres dostępu** — `order-access-service.ts` to jedyne miejsce egzekwujące
  regułę zakresu Regular User / Organization Admin / Admin User;
  nowe rodzaje aktorów dodajesz tutaj.

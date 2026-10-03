---
title: orders
description: Składanie zamówień, statusy i ich przejścia, powiązanie z płatnością i dostawą
---

# `orders`

Składanie zamówień, ich cykl życia i kontrola dostępu. Łączy wyznaczanie cen w koszyku, rezerwację
stanów magazynowych, uruchomienie sterownika płatności, generowanie faktur i zapis do dziennika
audytu.

## API publiczne

Trasy administracyjne są chronione przez `orders:read` (odczyt) i `orders:write` (zmiany).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/orders` | klient | Złożenie zamówienia z aktywnego koszyka |
| `GET /api/v1/orders` | klient | Lista zamówień ograniczona rolą (zwykły użytkownik lub administrator organizacji) |
| `GET /api/v1/orders/:id` | klient | Szczegóły zamówienia |
| `GET /api/v1/orders/:id/invoice` | klient | Pobranie faktury PDF |
| `GET /api/v1/admin/orders` | administrator | Lista wszystkich zamówień (we wszystkich organizacjach) |
| `GET /api/v1/admin/orders/:id` | administrator | Szczegóły zamówienia (bez ograniczenia do klienta) |
| `POST /api/v1/admin/orders/:id/status` | administrator | Zmiana statusu (audytowana) |
| `POST /api/v1/admin/orders/:id/payment-status` | administrator | Zmiana statusu płatności (audytowana) |

## Statusy i przejścia (konfigurowalne)

Cykl życia zamówienia **konfiguruje się w panelu administracyjnym**: statusy i dozwolone przejścia
są zapisane w tabelach `order_statuses` i `order_status_transitions`, wypełnianych przy instalacji
dziewięcioma domyślnymi statusami — `new` (początkowy, nie da się go usunąć), `pending`, `paid`,
`processing`, `shipment_ready`, `shipment_sent`, `completed` (końcowy), `on_hold`, `cancelled`
(końcowy) — wraz z predefiniowanymi przejściami oraz przejściami dostępnymi z każdego statusu
`→ on_hold` / `→ cancelled` (i `on_hold → any`). Administratorzy zarządzają nimi przez endpointy
`/api/v1/admin/orders/statuses` i `/transitions`; graf jest przechowywany w pamięci procesu i
sprawdzany ponownie przy każdej zmianie.

`OrderTransitionService.apply()` to jedyne miejsce, które rozstrzyga o przejściach: odrzuca
przejście, dla którego nie skonfigurowano krawędzi, albo przejście ze statusu końcowego, uruchamia
**zabezpieczenia wstępne** z możliwością zablokowania (`onOrderTransitionGuard`), a następnie
emituje zdarzenia według szablonu (niżej). Zdarzenia płatności i wysyłki wywołują automatyczne
przejścia przez `OrderStatusRegistry` (kolumny `statusOn*` odwołują się do tych kodów statusów);
`payment_status` pozostaje polem pochodnym, drugorzędnym.

## Encje

`Order`, `OrderItem`, `Payment`, `OrderStatus`, `OrderStatusTransition`, `OrderComment`,
`OrderListSavedView` oraz kolumna `organizations.order_confirmation_emails` (właściciel:
`organizations`, odczyt przez port). `OrderItem` zapisuje kopię produktu, wariantu, ceny
jednostkowej i stawki podatku z chwili złożenia zamówienia, aby historyczne zamówienia nie zmieniały
się po zmianach cen i katalogu.

## Emitowane zdarzenia

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`. Każde przejście X→Y emituje
dodatkowo cztery zdarzenia **według szablonu** (budowane przez `events/order-status-events.ts`):
`order.status.from_<x>_to_<y>.before`, `order.status.from_<x>.before` (synchroniczne, z możliwością
zablokowania) oraz `order.status.from_<x>_to_<y>.after`, `order.status.to_<y>.after` (po
zatwierdzeniu, odizolowane).

## Operacje w panelu administracyjnym

- **Tworzenie w imieniu klienta** — `POST /api/v1/admin/orders` buduje koszyk klienta z pozycji
  wprowadzonych przez administratora i uruchamia `placeOrder` w imieniu klienta; klient dostaje
  e-mail z prośbą o opłacenie.
- **Lista** — `GET /api/v1/admin/orders` filtruje, sortuje i wyszukuje po stronie serwera, z
  licznikami dla każdego statusu; `GET …/export` zwraca CSV strumieniowo; zapisane widoki przez
  `…/list-views` (prywatne lub współdzielone).
- **Operacje masowe** — `POST …/bulk/status` (zamówienia, które się kwalifikują, zmieniają status;
  pominięte są zgłaszane z powodem) oraz `…/bulk/print-invoices`.
- **Komentarze** — `…/:id/comments` dla administratora i klienta, z flagą widoczności dla klienta i
  powiadomieniem; zablokowane w zamówieniach o statusie końcowym.
- **Ponowne zamówienie** — `…/:id/reorder` odtwarza koszyk (zależnie od ustawienia
  `orders.reorder_enabled`); **kopia jako zapytanie ofertowe** — `…/:id/clone-to-quote`.

## Ustawienia

`orders.min_order_value` (liczba; dotyczy checkoutu i tworzenia zamówień w panelu),
`orders.reorder_enabled` (wartość logiczna), `orders.confirmation_recipients` (lista stringów) —
wszystkie globalnie albo dla kanału sprzedaży. Do tego `order_confirmation_emails` dla każdej
organizacji. E-mail z potwierdzeniem trafia do klienta, a w kopii do listy organizacji i listy z
ustawień (bez gwarancji doręczenia, nigdy nie blokuje składania zamówienia).

## E-mail z potwierdzeniem zamówienia

Po udanym checkoucie `OrderService.placeOrder` wysyła e-mail z potwierdzeniem (po zatwierdzeniu
transakcji, bez gwarancji doręczenia — błąd poczty nigdy nie wycofuje złożonego zamówienia).
Wiadomość budowana przez `email-templates/order-confirmation.ts` zawiera zamówione produkty z
kwotami, metodę dostawy i jej koszt, metodę płatności z ewentualną dopłatą (np. `+5.00 PLN` przy
pobraniu), zastosowane rabaty, podsumowanie wartości zamówienia oraz adresy dostawy i do faktury.
Wiersz płatności jest generowany przez rejestr szablonów e-mail płatności
(`payments/services/payment-email-renderer.ts`) — klucz `renderers.email` adaptera zastępuje domyślny
szablon platformy.

## Punkty rozszerzenia

- **Adaptery płatności** — zobacz moduł `payment_methods`. `placeOrder` rozpoczyna płatność przez
  `PaymentAdapterRegistry`; nowe metody rejestrują adapter zamiast zmieniać usługę zamówień.
- **Zakres dostępu** — `order-access-service.ts` to jedyne miejsce egzekwujące regułę dostępu dla
  zwykłego użytkownika, administratora organizacji i administratora platformy; nowe rodzaje
  użytkowników dodaje się właśnie tam.

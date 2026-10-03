---
title: returns
description: Zwroty i reklamacje (RMA) — zgłoszenie, weryfikacja, przesyłki zwrotne i rozliczenie według konfigurowalnego grafu statusów
---

# `returns`

Zwroty i reklamacje (RMA). Obsługuje cykl życia sprawy zwrotu lub reklamacji dotyczącej
zrealizowanego zamówienia — zgłoszenie, weryfikację i nadanie numeru RMA, przesyłki zwrotne oraz
rozliczenie (zwrot pieniędzy, środki na koncie w sklepie, wymiana lub naprawa), łącznie z fakturą
korygującą. Działa na konfigurowalnym grafie statusów, tak jak moduł `orders`.

## API publiczne

Trasy administracyjne są chronione przez `returns:read` (odczyt) i `returns:write` (zmiany).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/orders/:orderId/returnable` | klient | Pozycje, które można zwrócić, i warunki dla zamówienia |
| `POST /api/v1/returns` | klient | Otwarcie sprawy zwrotu lub reklamacji |
| `GET /api/v1/returns` | klient | Lista spraw wywołującego |
| `GET /api/v1/returns/:id` | klient | Szczegóły sprawy (tylko komentarze widoczne dla klienta) |
| `POST /api/v1/returns/:id/comments` | klient | Odpowiedź w sprawie |
| `POST /api/v1/returns/:id/select-delivery-method` | klient | Wybór metody dostawy zwrotu |
| `POST /api/v1/returns/:id/cancel` | klient | Wycofanie sprawy |
| `GET /api/v1/returns/reasons` | klient | Aktywne powody do formularza w storefroncie |
| `GET /api/v1/admin/returns` | administrator | Lista spraw z filtrowaniem i wyszukiwaniem oraz licznikami dla każdego statusu |
| `GET /api/v1/admin/returns/export` | administrator | Eksport bieżącego widoku do CSV |
| `POST /api/v1/admin/returns/bulk-transition` | administrator | Masowa zmiana statusu (pomija niedozwolone) |
| `GET /api/v1/admin/returns/:id` | administrator | Szczegóły sprawy (łącznie z komentarzami wewnętrznymi) |
| `POST /api/v1/admin/returns/:id/authorize` | administrator | Nadanie numeru RMA i przejście do `authorized` |
| `POST /api/v1/admin/returns/:id/reject` | administrator | Odrzucenie z obowiązkowym powodem |
| `POST /api/v1/admin/returns/:id/transition` | administrator | Kontrolowana zmiana statusu |
| `GET\|POST /api/v1/admin/returns/:id/settlement` | administrator | Wstępne wypełnienie / wykonanie rozliczenia |
| `GET\|POST /api/v1/admin/returns/:id/comments` | administrator | Lista / dodanie komentarza (widoczność i powiadomienie) |
| `GET\|POST /api/v1/admin/returns/:id/shipments` + `/:shipmentId/receive` | administrator | Przesyłki zwrotne |
| `…/statuses`, `…/transitions`, `…/reasons`, `…/delivery-methods`, `…/list-views` | administrator | Konfiguracja i zapisane widoki |

## Statusy i przejścia (konfigurowalne)

Cykl życia sprawy **konfiguruje się w panelu administracyjnym** (`return_statuses` i
`return_status_transitions`, wypełniane przy instalacji). Domyślnie:

- **new** (początkowy) → **authorized** → **received** → **resolved** → **closed** (końcowy)
- **rejected** (końcowy) — dostępny z new / authorized / received; **cancelled** (końcowy) — z new /
  authorized.

Przejścia są egzekwowane; statusu początkowego nie można zmienić; ze statusów końcowych nie prowadzą
żadne przejścia. Każde przejście emituje zdarzenia `return.status.*` before/after według szablonu i
trafia do dziennika audytu.

## Najważniejsze zachowania

- **Uprawnienie do zwrotu i okres bezpłatnego zwrotu** — sprawę można otworzyć, gdy zamówienie
  osiągnie status kończący realizację; okres bezpłatnego zwrotu (`returns.free_return_days`,
  domyślnie **14** zgodnie z dyrektywą (UE) 2023/2673) liczy się od tej chwili i decyduje, kto
  ponosi koszt przesyłki zwrotnej.
- **Numeracja RMA** — `${prefix}${sequence}${suffix}` z `returns.rma_number_prefix` /
  `returns.rma_number_suffix`, nadawana przy autoryzacji, unikalna i nigdy nieużywana ponownie.
- **Zwroty częściowe i wielokrotne** — ilość w każdej pozycji jest ograniczona do pozostałej ilości
  możliwej do zwrotu, bez ilości objętych już sprawami, które nie zostały odrzucone ani anulowane.
- **Rozliczenie** — domyślna kwota zwrotu dla pozycji to kwota zapłacona za zwracaną ilość i nigdy
  jej nie przekracza. Sposoby rozliczenia: zwrot pieniędzy, środki na koncie (zasilają limit
  kredytowy organizacji w `credit_limits`), wymiana albo naprawa. Przy rozliczeniu pieniędzmi lub
  środkami na koncie wymagana jest faktura korygująca (`invoices` rodzaju `correction`). Zamówienie,
  które nigdy nie zostało zafakturowane, nie ma dokumentu VAT do skorygowania, więc korekta nie
  powstaje: rozliczenie się udaje, zwrot jest zapisany w sprawie i w rekordzie płatności, a wynik
  zawiera `correctiveInvoice: { issued: false, reason: "order_not_invoiced" }`.
- **Wyłączona bramka płatności blokuje rozliczenie.** Rozliczenia pieniężne zamówień opłaconych
  przez bramkę wywołują moduł operatora płatności, który przyjął płatność; gdy operator wyłączył ten
  moduł — albo wdrożenie go nie oferuje — rozliczenie zwraca `503 MODULE_DISABLED` z nazwą modułu i
  nagłówkiem `Retry-After`. Nic się nie zmienia: sprawa zachowuje status, nie powstaje wiersz
  `refunds`, nie jest wystawiana faktura korygująca i nie wychodzi e-mail do klienta. Jedyna
  potrzebna naprawa to ponowne włączenie modułu. To co innego niż wdrożenie, które w ogóle **nie
  ma** integracji zwrotów z operatorem płatności — tam rozliczenie nadal kończy się stanem
  `pending_manual`, aby człowiek wypłacił pieniądze ręcznie, bo nie ma czego włączyć.

## Interfejsy między modułami

Moduł odczytuje i zmienia dane innych domen wyłącznie przez udokumentowane porty, nigdy przez
importy wnętrza innych modułów:

- `OrderReturnContextPort` (orders) — kwoty zapłacone za każdą pozycję i czas osiągnięcia statusu
  kończącego realizację.
- `PaymentRefundPort` (payments) — wykonanie zwrotu, odpowiedź `pending_manual`, gdy nie ma
  integracji z operatorem płatności, albo odmowa, gdy bramka, która przyjęła płatność, jest
  wyłączona.
- `CorrectiveInvoicePort` (invoices) — utworzenie faktury `correction` albo odpowiedź, że korekta nie
  jest potrzebna, bo zamówienie nie ma faktury.
- `CreditTopupPort` (credit_limits) — zasilenie limitu kredytowego organizacji.
- `ShipmentService` (shipments) — opcjonalna przesyłka z towarem na wymianę.

## Schemat

Migracja `080_returns_init.ts` tworzy `return_cases`, `return_case_items`, `return_case_comments`,
`return_statuses`, `return_status_transitions`, `return_reasons`, `return_delivery_methods`,
`refunds`, `return_shipments`, `return_case_attachments`, `return_list_saved_views` oraz sekwencję
`return_cases_rma_seq`.

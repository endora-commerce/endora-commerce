---
title: returns
description: Zwroty i reklamacje (RMA) — zgłoszenie, weryfikacja, wysyłki reverse-logistics i rozliczenie na konfigurowalnym grafie statusów
---

# `returns`

Zwroty i reklamacje (Refunds, RMA). Zarządza cyklem życia sprawy zwrotu lub
reklamacji wobec zrealizowanego zamówienia — zgłoszenie, weryfikacja i
przypisanie numeru RMA, wysyłki reverse-logistics oraz rozliczenie (zwrot pieniędzy,
store credit, wymiana lub naprawa), w tym faktura korygująca. Odzwierciedla
konfigurowalny workflow grafu statusów modułu `orders`.

## Publiczne API

Trasy admina są chronione przez `returns:read` (odczyt) / `returns:write` (mutacje).

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/orders/:orderId/returnable` | customer | Linie do zwrotu + kwalifikacja dla zamówienia |
| `POST /api/v1/returns` | customer | Otwórz sprawę zwrotu/reklamacji |
| `GET /api/v1/returns` | customer | Lista spraw wywołującego |
| `GET /api/v1/returns/:id` | customer | Szczegóły sprawy (tylko komentarze widoczne dla klienta) |
| `POST /api/v1/returns/:id/comments` | customer | Odpowiedź w sprawie |
| `POST /api/v1/returns/:id/select-delivery-method` | customer | Wybór metody dostawy zwrotu |
| `POST /api/v1/returns/:id/cancel` | customer | Wycofanie sprawy |
| `GET /api/v1/returns/reasons` | customer | Aktywne powody dla formularza storefront |
| `GET /api/v1/admin/returns` | admin | Lista/filtr/szukanie spraw + liczniki per status |
| `GET /api/v1/admin/returns/export` | admin | Eksport CSV bieżącego widoku |
| `POST /api/v1/admin/returns/bulk-transition` | admin | Masowa zmiana statusu (pomija niedozwolone) |
| `GET /api/v1/admin/returns/:id` | admin | Szczegóły sprawy (w tym komentarze wewnętrzne) |
| `POST /api/v1/admin/returns/:id/authorize` | admin | Przypisz numer RMA, przejdź do `authorized` |
| `POST /api/v1/admin/returns/:id/reject` | admin | Odrzucenie z obowiązkowym powodem |
| `POST /api/v1/admin/returns/:id/transition` | admin | Strzeżone przejście statusu |
| `GET\|POST /api/v1/admin/returns/:id/settlement` | admin | Prefill / wykonanie rozliczenia |
| `GET\|POST /api/v1/admin/returns/:id/comments` | admin | Lista / dodanie komentarza (widoczność + notify) |
| `GET\|POST /api/v1/admin/returns/:id/shipments` + `/:shipmentId/receive` | admin | Wysyłki zwrotu |
| `…/statuses`, `…/transitions`, `…/reasons`, `…/delivery-methods`, `…/list-views` | admin | Konfiguracja + zapisane widoki |

## Maszyna statusów (konfigurowalna — US3)

Cykl życia sprawy jest **konfigurowalny w adminie** (`return_statuses` +
`return_status_transitions`, seedowane przy instalacji). Domyślnie:

- **new** (początkowy) → **authorized** → **received** → **resolved** → **closed** (terminalny)
- **rejected** (terminalny) osiągalny z new/authorized/received; **cancelled** (terminalny) z new/authorized.

Przejścia są egzekwowane; status początkowy jest niemutowalny; statusy terminalne
nie mają wychodzących krawędzi. Każde przejście emituje szablonowe zdarzenia
`return.status.*` before/after i trafia do audit log.

## Kluczowe zachowania

- **Kwalifikacja i okno darmowego zwrotu** — sprawa jest dozwolona, gdy zamówienie
  osiągnie status kończący realizację; okno darmowego zwrotu
  (`returns.free_return_days`, domyślnie **14** wg dyrektywy UE (EU) 2023/2673)
  liczy się od tego momentu i decyduje, kto ponosi koszt wysyłki zwrotnej.
- **Numeracja RMA** — `${prefix}${sequence}${suffix}` z
  `returns.rma_number_prefix` / `returns.rma_number_suffix`, przypisywana przy
  autoryzacji, unikalna i nigdy nieużywana ponownie.
- **Częściowe / powtarzane zwroty** — ilość per linia do pozostałej kwoty
  do zwrotu, z wyłączeniem ilości już objętych nienieodrzuconymi /
  nieanulowanymi sprawami.
- **Settlement** — domyślny zwrot per linia to kwota zapłacona za zwracaną
  ilość i nigdy jej nie przekracza. Rozwiązania: refund (pieniądze), credit (doładowuje
  grant `credit_limits` organizacji), replacement lub repair. Faktura korygująca
  (`invoices` kind `correction`) jest żądana dla rozliczeń money/credit.
  Zamówienie, które nigdy nie było fakturowane, nie ma dokumentu VAT do
  korekty, więc żaden nie wychodzi: rozliczenie się udaje, zwrot jest zapisany
  na sprawie zwrotu i rekordzie płatności, a wynik podaje
  `correctiveInvoice: { issued: false, reason: "order_not_invoiced" }`.
- **Wyłączona bramka płatności odmawia rozliczenia** (issue #104, D-71).
  Rozwiązania pieniężne przy zamówieniu opłaconym bramką wołają moduł PSP, który
  przyjął płatność; gdy operator ma ten moduł wyłączony — albo wdrożenie go nie
  oferuje — rozliczenie odpowiada `503 MODULE_DISABLED` z nazwą modułu i
  `Retry-After`. Nic się nie przesuwa: sprawa zachowuje status, nie powstaje wiersz
  `refunds`, nie wychodzi faktura korygująca i nie idzie e-mail do klienta.
  Włączenie modułu z powrotem to cała naprawa. To odróżnia się od wdrożenia **bez**
  integracji zwrotu PSP w ogóle, które nadal rozlicza jako `pending_manual`, żeby
  człowiek wypłacił ręcznie — nie ma tam nic do włączenia.

## Interfejsy cross-module (Zasada I)

Moduł czyta/wpływa na inne domeny tylko przez udokumentowane porty, nigdy
wewnętrzne importy:

- `OrderReturnContextPort` (orders) — kwoty zapłacone per linia + czas statusu kończącego realizację.
- `PaymentRefundPort` (payments) — wykonaj zwrot, odpowiedz `pending_manual`
  gdy brak integracji PSP, albo odmów, gdy bramka, która przyjęła płatność, jest wyłączona (D-71).
- `CorrectiveInvoicePort` (invoices) — utwórz fakturę `correction`, albo odpowiedz,
  że żadna nie jest należna, bo zamówienie nie ma faktury do korekty.
- `CreditTopupPort` (credit_limits) — doładuj grant organizacji.
- `ShipmentService` (shipments) — opcjonalna wysyłka wymiany wychodząca.

## Schemat

Migracja `080_returns_init.ts` tworzy `return_cases`, `return_case_items`,
`return_case_comments`, `return_statuses`, `return_status_transitions`,
`return_reasons`, `return_delivery_methods`, `refunds`, `return_shipments`,
`return_case_attachments`, `return_list_saved_views` oraz sekwencję
`return_cases_rma_seq`.

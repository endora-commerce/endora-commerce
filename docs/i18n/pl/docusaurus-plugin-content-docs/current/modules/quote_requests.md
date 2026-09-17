---
title: quote_requests
description: Cykl życia RFQ (draft → quote → accept/reject)
---

# `quote_requests`

Moduł Quote Requests — feature 008 — implementuje pętlę negocjacji B2B. Klient
(lub sales representative w jego imieniu) tworzy szkic Quote Request, druga
strona go przegląda, każda strona może modyfikować wniosek i wymagać jawnej
ponownej akceptacji, a zatwierdzony Quote Request można przekształcić w
zamówienie przez standardowy checkout. Każde przejście trafia do append-only
event log, więc strona szczegółów klienta i admin renderują tę samą historię
chronologiczną.

## Statusy

Sześć wartości, zastępujących zestaw z ery foundation:

- `Created from admin` — utworzony przez sales rep / admin, oczekuje akceptacji klienta.
- `Pending` — wysłany przez klienta, oczekuje odpowiedzi strony wewnętrznej.
- `Approved` — zatwierdzony przez odpowiedzialną stronę.
- `Completed` — zamówienie złożone z tego Quote Request.
- `Canceled` — odrzucony przez którąkolwiek stronę (z opcjonalnym powodem).
- `Expired` — auto-flip przez expiry worker po upływie skonfigurowanego progu.

`Canceled`, `Completed` i `Expired` są terminalne.

## Publiczne API

Endpointy klienta wymagają sesji customer; endpointy admin są gated przez
`rfqs:handle`. Endpointy PATCH-shaped akceptują wersje `If-Match` dla optimistic
concurrency, a customer accept/reject revision dodatkowo pinuje
`expectedRevisionNumber`.

| Verb + Path | Audience | Cel |
| --- | --- | --- |
| `GET /api/v1/quote-requests` | customer | Lista widocznych Quote Requests (rola org-admin rozszerza widoczność na całą org). |
| `GET /api/v1/quote-requests/:id` | customer | Szczegóły z opcjonalnym blokiem `comparisonAgainstLastSeen` podczas oczekiwania na akceptację. |
| `POST /api/v1/quote-requests` | customer | Utworzenie + submit w jednym wywołaniu. |
| `PATCH /api/v1/quote-requests/:id` | customer | Edycja Pending RFQ, którego strona wewnętrzna jeszcze nie dotknęła. |
| `POST /api/v1/quote-requests/:id/accept-revision` | customer | Akceptacja najnowszej rewizji (obejmuje też `Created from admin`). |
| `POST /api/v1/quote-requests/:id/reject-revision` | customer | Odrzucenie najnowszej rewizji z opcjonalnym powodem. |
| `POST /api/v1/quote-requests/:id/resubmit` | customer | Klon starego Quote Request do nowego Pending po bieżącym cenniku klienta. |
| `GET /api/v1/admin/quote-requests` | admin | Lista, scoped przez sales-rep assignment + filtrowalna po status / organization. |
| `GET /api/v1/admin/quote-requests/:id` | admin | Szczegóły z pełną tożsamością aktora w event log. |
| `POST /api/v1/admin/quote-requests` | admin | Utworzenie w imieniu klienta → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | admin | Modyfikacja Pending lub Created from admin RFQ → wymusza ponowną akceptację klienta. |
| `POST /api/v1/admin/quote-requests/:id/approve` | admin | Approve Pending RFQ. |
| `POST /api/v1/admin/quote-requests/:id/cancel` | admin | Cancel z opcjonalnym powodem. |
| `POST /api/v1/admin/quote-requests/:id/assign` | admin | Ustawienie `assignedAdminUserId` (informacyjne). |
| `GET /api/v1/admin/sales-reps/:adminUserId/organizations` | admin | Widok odwrotny — organizations, za które rep odpowiada, z liczbą otwartych quote requests w każdej. |
| `GET /api/v1/storefront/settings/quote-requests` | public | Zwraca dwie flagi widoczności storefront. |

Trzy endpointy przypisujące sales representative *do* organization —
`GET`, `POST` i `DELETE` pod
`/api/v1/admin/organizations/:id/sales-reps` — należą do modułu **organizations**
i są gated przez `organizations:assign-sales-rep`, nie przez `rfqs:handle`.
Kiedyś były rejestrowane tutaj; podział nie jest kosmetyczny: przypisanie rep
kwalifikuje organization, więc musi działać, gdy quote requests jest wyłączone,
i nie może być gated kodem uprawnienia z modułu, który może zniknąć. Jeden
endpoint pozostały powyżej czyta quote request i jest gated `rfqs:handle` dokładnie
po to, aby znikał wraz z tym modułem.

## Model widoczności

Sales representative to platform administrator z rolą
`sales_representative`. Predykat
`SalesRepAssignmentService.canSeeOrganization(adminUserId, organizationId)`
centralizuje regułę widoczności:

1. rola `platform_admin` → widzi każdą organization.
2. W przeciwnym razie admin widzi organization wtedy i tylko wtedy, gdy wiersz w
   `organization_sales_rep_assignments` je łączy LUB organization ma zero wierszy
   w tej tabeli (fallback „unassigned-org” — widoczne dla każdego sales rep).

Klient z rolą `org_admin` we własnej organization widzi każdy Quote Request w
organization, nie tylko własny.

## Ustawienia

Trzy ustawienia sterują modułem — wszystkie w grupie `quote_requests` i
konfigurowane przez istniejący moduł settings.

| Code | Type | Default | Effect |
| --- | --- | --- | --- |
| `quote_requests.expiry_days` | integer | `0` | Auto-expire Pending / Created from admin RFQ po N dniach. `0` wyłącza. |
| `quote_requests.show_add_to_quote_on_card` | boolean | `true` | Przełącza przycisk „Add to quote” na kartach produktów storefront. |
| `quote_requests.show_add_to_quote_on_pdp` | boolean | `true` | Przełącza przycisk „Add to quote” na stronach szczegółów produktu. |

## Zadania w tle

`RfqExpiryWorker.sweep()` uruchamia się co 30 minut przez foundation
BullMQ scheduler. Czyta `quote_requests.expiry_days` ze snapshotu settings;
gdy wartość to 0, sweep to no-op. W przeciwnym razie przechodzi każdy Pending i
Created from admin wiersz, gdzie
`updated_at < now() - INTERVAL <expiryDays> days`, na `Expired`, zapisuje po
jednym evencie `expired` per wiersz i rozsyła powiadomienia obu stronom.

## Model danych

Trzy tabele nad foundation `quote_requests` i
`quote_request_items`:

- `quote_request_revisions` — pełny snapshot per zdarzenie modify.
- `quote_request_events` — append-only historia (jeden wiersz per przejście stanu
  lub modyfikacja, z payload discriminated-union).
- `quote_request_notification_events` — jeden wiersz per odbiorca ×
  kanał; unique na `(quote_request_id, source_event_id, recipient*,
  channel)`, więc retry są idempotentne.

`organization_sales_rep_assignments` — relacja m:n między organizations a admin
users, z której czyta model widoczności powyżej — **nie** jest jedną z nich:
należy do modułu `organizations`, który nią kwalifikuje organization, a ten moduł
sięga po nią przez `organizationSalesRepScopePort` tego modułu.

Kanoniczny wiersz `quote_requests` niesie bieżący stan plus
`current_revision_number`, `last_customer_seen_revision_number` i
`awaiting_customer_revision_acceptance`. Diff klienta „co się zmieniło od
ostatniej wizyty” liczony jest przy odczycie przez porównanie rewizji
identyfikowanej przez `last_customer_seen_revision_number` z rewizją
identyfikowaną przez `current_revision_number`.

### `sales_channel_id` jest nullable i pozostaje nullable

Każdy wniosek zapisuje sales channel, na którym powstał, z resolved request
channel. Kolumna jest nullable i pozostanie taka.

Dodano ją nullable celowo: deploy, który ją wysłał, nie może zależeć od tego, że
boot-time default-channel reconciler już zadziałał — to zwykły phased shape:
dodaj nullable, zacznij pisać, backfill, flip na `NOT NULL`. Środkowego kroku tu
nie da się wykonać. Nic nie pisało kolumny między migracją, która ją dodała, a
zmianą, która zaczęła ją wypełniać, więc każdy wniosek z tego okna ma `null`, a
żaden rekord nie mówi, z którego kanału pochodził. Projekcja system-default
channel nad tą luką nie odzyskałaby atrybucji — wymyśliłaby ją — a guard
usuwania sales-channel zacząłby odmawiać kasowania na dowodzie wymyślonym przez
platformę.

Deploy, który naprawdę potrzebuje kolumny non-nullable, usuwa null tail albo bierze
odpowiedź per wiersz ze źródła, które ją zna. Nie ma skryptu backfill i
celowo nigdy nie będzie.

## Powiadomienia

Każde przejście stanu rozsyła przez `RfqNotificationService` do właściwych
odbiorców (klient przy akcjach admin, sales reps + platform admins przy akcjach
klienta, obie strony przy expiry). Oba kanały — e-mail i in-account — odpalają.
Unique constraint na `quote_request_notification_events` gwarantuje once-only
delivery per (transition, recipient, channel).

## Konwersja na zamówienie

Gdy zamówienie powstaje z wypełnionym `source_quote_request_id`,
subscriber wewnątrz modułu przełącza źródłowy Quote Request na `Completed`,
wypełnia `converted_order_id` i odpala powiadomienie `completed`. Krok tworzenia
koszyka, który blokuje uzgodnione ceny RFQ w checkout cart, dostarczany jest przez
istniejące flow cart i checkout.

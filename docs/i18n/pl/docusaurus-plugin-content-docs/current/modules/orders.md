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

## Co wynika z przejścia: działania następcze

Anulowanie zamówienia zwalnia to, co zamówienie trzymało: jego **rezerwacje stanów magazynowych**
oraz — w przypadku zamówienia złożonego w ramach limitu kredytowego — jego **rezerwację limitu**.
Oznaczenie takiego zamówienia jako opłaconego zwalnia rezerwację limitu. Te zwolnienia to
*działania następcze* przejścia.

Działanie następcze jest zapisywane **w tej samej transakcji co status**, jako wiersz w tabeli
`order_transition_effects`, i wykonywane zaraz potem, w tym samym żądaniu. W zwykłym przypadku
stan magazynowy i limit są więc zwolnione, zanim wywołujący dostanie odpowiedź. Zmieniło się to,
co dzieje się, gdy zwolnienia nie da się dokończyć:

- **Przejście i tak jest wykonane, a wywołujący dostaje taką odpowiedź.** Każda odmowa — nieznany
  status, brak skonfigurowanej krawędzi, status końcowy, blokada zabezpieczenia wstępnego — zapada,
  zanim cokolwiek zostanie zapisane. Po zatwierdzeniu statusu nic nie zamieni odpowiedzi w błąd.
- **Zwolnienie jest ponawiane aż do skutku.** Zadanie w tle uruchamia się co minutę i próbuje
  wykonać każde zaległe działanie, na które przyszła pora, wydłużając odstęp między próbami od
  jednej minuty do jednej godziny. Nie ma stanu „porzucone”; od piątego niepowodzenia każde
  kolejne jest zapisywane w logu na poziomie `warn` wraz z identyfikatorem zamówienia, rodzajem
  zwolnienia i ostatnim błędem.
- **Działania następcze są od siebie niezależne.** Nieudane zwolnienie limitu nie wstrzymuje
  zwolnienia stanu magazynowego — i odwrotnie.
- **Zdarzenia zmiany statusu są emitowane zawsze** po zatwierdzeniu, bez względu na to, co stało
  się ze zwolnieniami.

Powtórzenie przejścia do statusu, który zamówienie już ma, niczego nie zmienia — i jest to
bezpieczne: to, co wynika ze statusu, jest zapisane obok niego i zostanie wykonane.

### Gdy moduł `inventory` lub `credit_limits` jest wyłączony

Działanie następcze, którego moduł-właściciel jest wyłączony, **czeka**. Dopóki moduł jest
wyłączony, nic w jego danych nie jest zapisywane, oczekiwanie nie liczy się jako nieudana próba, a
zwolnienie następuje w ciągu jednego przebiegu zadania w tle (minuty) od ponownego włączenia
modułu.

- Przy wyłączonym `inventory` anulowane zamówienie zachowuje swoje rezerwacje do czasu powrotu
  modułu.
- Przy wyłączonym `credit_limits` zamówienie złożone w ramach limitu nadal można anulować albo
  oznaczyć jako opłacone; jego rezerwacja zostanie zwolniona po powrocie modułu. Złożenie nowego
  zamówienia w ramach limitu kredytowego jest przy wyłączonym module nadal odrzucane.

### Na stronie zamówienia

Strona zamówienia w panelu administracyjnym pokazuje komunikat, dopóki zamówienie ma zaległe
działania następcze: które zwolnienie, czy czeka na moduł i ile prób się nie powiodło. Odpowiedź
administracyjna z zamówieniem zawiera te same informacje w polu `pendingEffects` — obecnym tylko
wtedy, gdy coś jest zaległe, i nigdy w odpowiedziach przeznaczonych dla kupującego.

### Naprawa zamówień pozostawionych przez wcześniejszą wersję

Zanim działania następcze zaczęły być zapisywane, zwolnienie, które się nie powiodło albo zostało
odrzucone, mogło zostawić zamówienie anulowane (albo opłacone), a mimo to nadal trzymające stan
magazynowy lub limit — i nic nie mogło go już potem zwolnić. Takie zamówienia nie mają wiersza
działania następczego. Znajduje je i naprawia polecenie dla operatora:

```bash
# Wypisuje, co zostałoby zwolnione. Niczego nie zapisuje.
pnpm --filter backend run cli orders transition-effects-repair

# Zwalnia.
pnpm --filter backend run cli orders transition-effects-repair --apply
```

Przebieg próbny wypisuje każde zamówienie, które nadal trzyma rezerwacje stanów magazynowych lub
aktywną rezerwację limitu, choć powinno było je zwolnić — wraz z tym, co trzyma. `--apply` zapisuje
zwolnienia tym samym mechanizmem działań następczych, od razu próbuje je wykonać i tworzy jeden
wpis audytu na stronę zamówień; to, czego nie uda się dokończyć, ponawia zadanie w tle. Ponowne
uruchomienie niczego już nie znajduje.

**Po aktualizacji uruchom raz przebieg próbny** i przeczytaj listę, zanim ją zastosujesz:
zwolnienie zmienia liczniki zarezerwowanego stanu i dostępny limit. Naprawa nigdy nie uruchamia się
sama.

**Czego przebieg próbny nie pokaże.** Wypisuje to, co według własnych wierszy zamówienia zamówienie
trzyma. Jeśli ktoś już ręcznie poprawił licznik stanu dla któregoś z tych zamówień, zamówienie
nadal jest na liście — jego rezerwacja nie jest oznaczona jako zwolniona — a zastosowanie naprawy
obniży licznik po raz drugi, więc zarezerwowane będzie mniej, niż faktycznie trzymają aktywne
zamówienia (licznik nigdy nie spada poniżej zera, co ukrywa błąd, zamiast mu zapobiec). Takie
zamówienie pomiń albo napraw tylko wskazane zamówienia; obie opcje przyjmują identyfikator
zamówienia wypisany na liście w nawiasie i można je powtarzać:

```bash
pnpm --filter backend run cli orders transition-effects-repair --apply --except=<identyfikator zamówienia>
pnpm --filter backend run cli orders transition-effects-repair --apply --order=<identyfikator zamówienia>
```

Jeśli `inventory` lub `credit_limits` jest wyłączony, polecenie nie może zapytać tego modułu, co
trzymają zamówienia. Informuje o tym, naprawia resztę i należy je uruchomić ponownie po włączeniu
modułu.

## Encje

`Order`, `OrderItem`, `Payment`, `OrderStatus`, `OrderStatusTransition`, `OrderTransitionEffect`,
`OrderComment`, `OrderListSavedView` oraz kolumna `organizations.order_confirmation_emails` (właściciel:
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
  pominięte są zgłaszane z powodem — pominięte zamówienie nie zmieniło statusu) oraz
  `…/bulk/print-invoices`.
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

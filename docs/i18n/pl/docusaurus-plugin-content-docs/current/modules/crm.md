---
title: crm
description: Szanse sprzedażowe z konfigurowalnym przepływem statusów, za którym podążają powiązane zamówienia
---

# `crm`

Moduł CRM prowadzi **szanse sprzedażowe**: transakcje, nad którymi
przedstawiciel handlowy pracuje z jedną organizacją klienta — od pierwszego
kontaktu do chwili, gdy szansa zostaje wygrana albo przegrana.

Ta strona rośnie razem z modułem. Sekcje oznaczone jako *wkrótce* opisują
możliwości, które są zaprojektowane, ale jeszcze niedostępne.

## Co robi

Szansa należy do dokładnie jednej organizacji i przechodzi przez **przepływ
statusów** konfigurowany przez operatora: zbiór statusów oraz dozwolonych
przejść między nimi. Każdy status jest jednego z trzech rodzajów:

- **open** — nad szansą nadal trwa praca;
- **won** — szansa jest zamknięta, a transakcja doszła do skutku;
- **lost** — szansa jest zamknięta bez transakcji.

Świeża instalacja zaczyna od domyślnego przepływu sześciu statusów:

| Kod | Rodzaj | Przechodzi do |
| --- | --- | --- |
| `new` (status początkowy) | open | `qualified`, `lost` |
| `qualified` | open | `proposal`, `lost` |
| `proposal` | open | `negotiation`, `won`, `lost` |
| `negotiation` | open | `won`, `lost` |
| `won` | won | — |
| `lost` | lost | `new` |

Zamknięta szansa nie musi być zakończona: ze statusu `lost` można wrócić do
`new`, więc transakcję, która odżywa, otwiera się ponownie, zamiast wprowadzać
ją od nowa.

Szanse są widoczne zgodnie z organizacjami, które administrator może
oglądać. Administrator ograniczony do wybranych organizacji widzi wyłącznie
ich szanse; z jego perspektywy szansa innej organizacji nie istnieje.

## Konfigurowanie przepływu

Przepływ należy do operatora. Status ma **kod** (małe litery, cyfry
i podkreślenia; po utworzeniu nigdy się nie zmienia), nazwę w każdym języku,
rodzaj, kolor oraz wagę, która ustala jego kolejność na ekranie. Dokładnie
jeden status jest **statusem początkowym** — tym, w którym zaczyna nowa
szansa — i musi to być status otwarty.

Przejście to skierowany krok z jednego statusu do drugiego. Szansa może
wykonać tylko skonfigurowany krok, więc zbiór przejść wyznacza to, co kontrolka
statusu proponuje przedstawicielowi handlowemu. Status zamykający może mieć
przejścia wychodzące: ponowne otwarcie jest przejściem jak każde inne.

Zmiana, która zepsułaby przepływ, jest odrzucana, a odmowa wskazuje regułę,
którą by naruszyła:

| Reguła | Co chroni |
| --- | --- |
| `exactly_one_initial` | Status początkowy jest jeden — nigdy żaden i nigdy dwa. |
| `initial_must_be_open` | Nowa szansa nie zaczyna jako zamknięta. |
| `won_status_required` | Szansę zawsze da się zamknąć jako wygraną. |
| `lost_status_required` | Szansę zawsze da się zamknąć jako przegraną. |
| `transition_unknown_status` | Przejście łączy dwa istniejące statusy. |
| `mapping_unknown_status` | Mapowanie wskazuje istniejący status szansy. |
| `mapping_duplicate` | Status szansy mapuje się na jeden status zamówienia, a nie na kilka. |

Statusu, w którym znajdują się szanse, nie można usunąć ani zmienić jego
rodzaju; najpierw trzeba przenieść szanse. Statusu początkowego również nie
można usunąć — należy oznaczyć inny status jako początkowy, a dopiero potem
usunąć ten. Usunięcie statusu usuwa razem z nim jego przejścia i mapowania.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/workflow` | `crm:read` | Skonfigurowane statusy wraz z liczbą szans w każdym z nich, przejścia między nimi, mapowania statusów zamówień oraz statusy wliczane do wartości obliczanej. |
| `POST /api/v1/admin/crm/statuses` | `crm:configure` | Dodanie statusu. |
| `PATCH /api/v1/admin/crm/statuses/:code` | `crm:configure` | Zmiana nazwy lub koloru statusu, zmiana jego rodzaju albo oznaczenie go jako początkowego. |
| `DELETE /api/v1/admin/crm/statuses/:code` | `crm:configure` | Usunięcie statusu, w którym nie ma żadnej szansy. |
| `PUT /api/v1/admin/crm/transitions` | `crm:configure` | Dodawanie i usuwanie przejść. |
| `PUT /api/v1/admin/crm/order-status-mappings` | `crm:configure` | Zastąpienie zbioru mapowań statusów zamówień. |

Każdy z tych zapisów zwraca cały przepływ w stanie po zmianie.

## Praca z szansą

Szansę tworzy się dla jednej organizacji i w jednej walucie; żadnej z nich nie
można później zmienić. Szansa otrzymuje własny numer (`OPP-000123`) i zaczyna
w statusie początkowym. Może mieć opis, osobę kontaktową — która musi należeć
do tej organizacji — kanał sprzedaży, wartość oraz przewidywaną datę
zamknięcia.

Przeniesienie szansy zapisuje, kto ją przeniósł, kiedy, z którego statusu do
którego oraz powód, jeśli został podany. Wejście w status rodzaju **won** lub
**lost** zamyka szansę i zapisuje ten moment; wyjście z takiego statusu otwiera
ją ponownie.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities` | `crm:read` | Lista z wyszukiwaniem (tytuł, numer, nazwa organizacji), filtrami według statusu, stanu (`open` / `won` / `lost`), organizacji, kanału sprzedaży i daty utworzenia, z sortowaniem i stronicowaniem. |
| `POST /api/v1/admin/crm/opportunities` | `crm:write` | Utworzenie szansy. |
| `GET /api/v1/admin/crm/opportunities/:id` | `crm:read` | Jedna szansa wraz ze statusami, do których może przejść, powiązanymi zamówieniami i każdą odrzuconą zmianą zamówienia. |
| `PATCH /api/v1/admin/crm/opportunities/:id` | `crm:write` | Edycja. Odczytaną wersję należy przesłać w nagłówku `If-Match`; nieaktualna jest odrzucana kodem `409`. |
| `DELETE /api/v1/admin/crm/opportunities/:id` | `crm:configure` | Usunięcie szansy razem z jej powiązaniami i historią. |
| `POST /api/v1/admin/crm/opportunities/:id/transition` | `crm:write` | Przeniesienie szansy do innego statusu. |

## Wiązanie zamówień

Istniejące zamówienie można powiązać z szansą. Zamówienie musi należeć do
organizacji szansy, a jedno zamówienie należy do **co najwyżej jednej**
szansy — próba powiązania zamówienia już powiązanego jest odrzucana ze
wskazaniem szansy, do której ono należy.

Każde powiązanie ma przełącznik **podążaj za statusem szansy**, domyślnie
włączony. Wyłącz go dla zamówienia, które ma pozostać powiązane — dla
informacji albo ze względu na jego wartość — ale nie ma być przenoszone.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/links` | `crm:write` | Powiązanie zamówienia. |
| `PATCH /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Włączenie lub wyłączenie podążania za statusem. |
| `DELETE /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Usunięcie powiązania. |

## Zamówienia podążające za szansą

**Mapowanie** mówi: gdy szansa wchodzi w *ten* status, poproś jej powiązane
zamówienia o przejście w *tamten* status zamówienia. Jeden status szansy
mapuje się na co najwyżej jeden status zamówienia, a status bez mapowania
nikogo o nic nie prosi.

Gdy szansa się przesuwa, każde powiązane zamówienie, które za nią podąża,
jest proszone osobno. Prośba przechodzi przez własne reguły przepływu
zamówień — przejścia skonfigurowane dla zamówień i wszystko inne, co może
odrzucić zmianę zamówienia — dokładnie tak, jakby administrator zmienił
zamówienie ręcznie. Niczego się nie wymusza.

**Przesunięcie szansy pozostaje w mocy bez względu na odpowiedź zamówień.**
Odmowa nie jest błędem: szansa została przesunięta, a obok podany jest los
każdego zamówienia.

| Wynik | Co stało się z zamówieniem |
| --- | --- |
| `applied` | Przeszło do zmapowanego statusu. |
| `already_there` | Było już w zmapowanym statusie; nic się nie zmieniło. |
| `not_permitted` | Przepływ zamówień nie ma przejścia z bieżącego statusu zamówienia do zmapowanego — albo zamówienie jest w statusie końcowym. |
| `vetoed` | Coś, co obserwuje zmiany zamówień, odrzuciło tę zmianę; podany jest powód. |
| `unknown_status` | Mapowanie wskazuje status zamówienia, który już nie istnieje. Popraw mapowanie. |
| `not_found` | Powiązane zamówienie już nie istnieje. |
| `failed` | Prośba nie została dokończona. Podany jest powód i można ją ponowić. |

Każdy wynik poza dwoma pierwszymi pozostaje przy szansie jako **nierozwiązany**,
dopóki ktoś się nim nie zajmie:

- **Ponów** prosi zamówienie jeszcze raz — po poprawieniu mapowania albo gdy
  zamówienie przeszło do statusu, z którego zmapowany jest osiągalny.
  Zamówienie jest proszone o to, na co status szansy mapuje się *teraz*.
- **Odrzuć** przyjmuje odmowę do wiadomości i zostawia zamówienie tam, gdzie
  jest.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/propagations/:propagationId/retry` | `crm:write` | Ponowna prośba do zamówienia. |
| `POST /api/v1/admin/crm/opportunities/:id/propagations/:propagationId/dismiss` | `crm:write` | Przyjęcie odmowy do wiadomości. |

## Własna logika przy zmianie statusu

Inny moduł — zwykle moduł nakładkowy danego wdrożenia — może zareagować na
przejście szansy ze statusu X do statusu Y, a także je odrzucić. Oba punkty
zaczepienia są opublikowane w `@endora-commerce/contracts`; żaden nie wymaga
zmiany w CRM.

**Reakcja na przejście** polega na subskrypcji zdarzenia. Dla przejścia z `x`
do `y` CRM emituje, w tej kolejności:

| Zdarzenie | Kiedy |
| --- | --- |
| `crm.opportunity.status.from_<x>_to_<y>.before` | przed zapisaniem zmiany |
| `crm.opportunity.status.from_<x>.before` | przed zapisaniem zmiany |
| `crm.opportunity.status_changed.v1` | po zapisaniu i po tym, jak poproszono powiązane zamówienia |
| `crm.opportunity.status.from_<x>_to_<y>.after` | jak wyżej |
| `crm.opportunity.status.to_<y>.after` | jak wyżej |
| `crm.opportunity.closed.v1` | jak wyżej, gdy `y` zamyka szansę |

Nazwy buduje funkcja `opportunityStatusEventName`, więc subskrybent nie
zapisuje wzorca ręcznie. Subskrybent nie może zatrzymać przejścia, a jego błąd
go nie cofa.

```ts
ctx.subscribe(opportunityStatusEventName('toAfter', { to: 'won' }), async (event) => {
  await notifyFinance(event.opportunityId);
});
```

**Odrzucenie przejścia** polega na zarejestrowaniu strażnika. Strażnik
wskazuje przejścia, które obserwuje — ze statusu, do statusu albo oba — i
odmawia, rzucając `OpportunityTransitionVetoError`. Zdanie, które rzuca, czyta
przedstawiciel handlowy; gdy strażnik odmawia, nic nie jest zapisywane.

```ts
ctx.onBoot(() => {
  lazyPort<OpportunityTransitionGuardRegistryPort>(ctx, 'opportunityTransitionGuardRegistry').register({
    ownerModuleId: 'acme_rules',
    match: { to: 'won' },
    guard: (event) => {
      if (event.reason === null) throw new OpportunityTransitionVetoError('Say why the deal was won.', event.from, event.to);
    },
  });
});
```

Moduł rejestrujący strażnika deklaruje to w swoim manifeście:
`nonBindingDependencies: [{ moduleId: 'crm', name: 'opportunityTransitionGuardRegistry', kind: 'contributes-to' }]`.
Strażnik należący do wyłączonego modułu jest pomijany — moduł, który jest
wyłączony, niczego nie odrzuca.

## Włączanie i wyłączanie

CRM jest modułem opcjonalnym. Domyślnie jest włączony, a operator wyłącza go
i włącza ponownie na ekranie **Moduły** w Admin UI (`/platform/modules`).

Gdy jest wyłączony:

- każdy punkt końcowy `/api/v1/admin/crm/…` odpowiada kodem `503` z kodem
  błędu `MODULE_DISABLED`;
- jego ekrany, grupa w menu bocznym, pozycje palety poleceń i ustawienia
  znikają z Admin UI;
- jego uprawnień nie można już nadać roli;
- nic, co moduł robiłby w tle, się nie dzieje.

Nic nie jest usuwane. Każda szansa, jej historia i konfiguracja przepływu
pozostają w bazie danych, a po ponownym włączeniu modułu wszystko wraca
dokładnie do poprzedniego stanu.

## Uprawnienia

| Kod | Na co pozwala |
| --- | --- |
| `crm:read` | Przeglądanie szans sprzedażowych i przepływu statusów. |
| `crm:write` | Tworzenie i edycja szans, przenoszenie ich w przepływie, wiązanie i odłączanie zamówień, ponawianie lub odrzucanie odmowy zmiany zamówienia. |
| `crm:configure` | Zmiana przepływu — statusów, przejść i mapowań statusów zamówień — oraz usuwanie szansy. |

Rola z uprawnieniem `crm:read` powinna mieć także `orders:read`: szansa
pokazuje powiązane z nią zamówienia, a te są odczytywane z modułu Zamówienia.
Uprawnienia `crm:write` i `crm:configure` opierają się na `crm:read`.

Żadna rola nie otrzymuje uprawnień CRM automatycznie. Nadaje się je na
ekranie **Role**.

## Ustawienia

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `crm.enabled` | włączone | Przełącznik opisany powyżej. |
| `crm.auto_create_from_orders` | wyłączone | *Wkrótce.* Tworzenie szansy dla każdego nowo złożonego zamówienia. |
| `crm.auto_create_from_quote_requests` | wyłączone | *Wkrótce.* Tworzenie szansy dla każdego nowo przesłanego zapytania ofertowego. |

## Wkrótce

- Ekrany w Admin UI dla wszystkiego, co opisano powyżej.
- Przesuwanie szansy, gdy jedno z jej zamówień osiągnie wskazany status.
- Przypisywanie szans przedstawicielom handlowym.
- Notatki, wiadomości wewnętrzne, załączniki i tagi.
- Widok tablicy z kolumną dla każdego statusu.
- Wiązanie zapytań ofertowych oraz wartość obliczana z powiązanych dokumentów.
- Historia zmian każdej szansy.
- Analityka: czas obsługi, czas w poszczególnych statusach, wyniki
  przedstawicieli handlowych.

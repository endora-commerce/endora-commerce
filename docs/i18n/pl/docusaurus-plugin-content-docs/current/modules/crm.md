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

### Przepływ przez API

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/workflow` | `crm:read` | Skonfigurowane statusy wraz z liczbą szans w każdym z nich, przejścia między nimi, mapowania statusów zamówień oraz statusy wliczane do wartości obliczanej. |

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

Rola z uprawnieniem `crm:read` powinna mieć także `orders:read`: szansa
pokazuje powiązane z nią zamówienia, a te są odczytywane z modułu Zamówienia.

Żadna rola nie otrzymuje uprawnień CRM automatycznie. Nadaje się je na
ekranie **Role**.

## Ustawienia

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `crm.enabled` | włączone | Przełącznik opisany powyżej. |
| `crm.auto_create_from_orders` | wyłączone | *Wkrótce.* Tworzenie szansy dla każdego nowo złożonego zamówienia. |
| `crm.auto_create_from_quote_requests` | wyłączone | *Wkrótce.* Tworzenie szansy dla każdego nowo przesłanego zapytania ofertowego. |

## Wkrótce

- Tworzenie i edycja szans oraz konfiguracja przepływu w Admin UI.
- Wiązanie zamówień z szansą i podążanie powiązanego zamówienia za statusem
  szansy.
- Przesuwanie szansy, gdy jedno z jej zamówień osiągnie wskazany status.
- Przypisywanie szans przedstawicielom handlowym.
- Notatki, wiadomości wewnętrzne, załączniki i tagi.
- Widok tablicy z kolumną dla każdego statusu.
- Wiązanie zapytań ofertowych oraz wartość obliczana z powiązanych dokumentów.
- Historia zmian każdej szansy.
- Analityka: czas obsługi, czas w poszczególnych statusach, wyniki
  przedstawicieli handlowych.

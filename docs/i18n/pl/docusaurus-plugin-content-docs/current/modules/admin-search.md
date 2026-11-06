---
title: Wyszukiwanie globalne
description: Wyszukiwanie globalne w panelu administracyjnym — znajdowanie organizacji, klientów, zamówień, zapytań ofertowych, szans sprzedażowych, produktów i kategorii z palety poleceń, z konfigurowalnymi polami wyszukiwania
---

# Wyszukiwanie globalne (`admin_search`)

Wyszukiwanie globalne pozwala administratorowi znaleźć rekord bez wcześniejszego
ustalania, na której liście się on znajduje. Naciśnij **⌘K** (macOS) lub
**Ctrl+K** albo kliknij pole wyszukiwania na górze paska bocznego i wpisz
fragment numeru zamówienia, adresu e-mail, NIP-u, SKU lub nazwy: pod ekranami i
akcjami, które paleta poleceń już wyświetla, pojawią się pasujące rekordy
pogrupowane według typu. Klawisze strzałek i **Enter** otwierają ekran
wybranego rekordu.

Moduł nie ma własnych tabel. Każdy typ rekordu dostarcza moduł, do którego te
rekordy należą: to on decyduje, po jakich polach można go przeszukiwać, i
stosuje te same zasady widoczności co jego własna lista w panelu. Ten moduł
przechowuje konfigurację, wykonuje samo wyszukiwanie i udostępnia dwa ekrany.

## Co jest przeszukiwane

Rekordy są przeszukiwane na bieżąco, więc zmianę można znaleźć od razu po
zapisaniu. Typy rekordów, w kolejności, w jakiej pojawiają się ich grupy:

| Typ rekordu | Dostępne pola (przeszukiwane domyślnie **pogrubione**) | Otwiera |
| --- | --- | --- |
| Zamówienia | **Numer zamówienia**, **Nazwa organizacji**, **Imię i nazwisko lub e-mail klienta**, Nazwa firmy do faktury, NIP do faktury | zamówienie |
| Zapytania ofertowe | **Numer zapytania ofertowego**, **Nazwa organizacji**, **Imię i nazwisko lub e-mail klienta**, Uwagi klienta | zapytanie ofertowe |
| Szanse sprzedażowe | **Numer szansy sprzedażowej**, **Tytuł**, **Nazwa organizacji**, Opis | szansę sprzedażową |
| Organizacje | **Nazwa**, **NIP**, Nazwa prawna | organizację |
| Klienci | **E-mail**, **Imię i nazwisko** | klienta |
| Produkty | **SKU**, **Nazwa**, Klucz URL (slug), Atrybuty szybkiego wyszukiwania | produkt |
| Kategorie | **Nazwa**, **Klucz URL (slug)** | drzewo kategorii z wyróżnioną kategorią |

Typ rekordu bierze udział w wyszukiwaniu tylko wtedy, gdy jego moduł jest
włączony: po wyłączeniu CRM na **/platform/modules** szanse sprzedażowe znikają z
wyników i z ekranu konfiguracji, a po ponownym włączeniu wracają z dotychczasową
konfiguracją.

Jak dopasowywany jest tekst:

- Wielkość liter nie ma znaczenia, a tekst może wystąpić w dowolnym miejscu
  pola. Znaki wieloznaczne, takie jak `%` i `_`, są dopasowywane dosłownie.
- Dokładne dopasowanie numeru, NIP-u, SKU, slugu lub adresu e-mail rekordu jest
  pokazywane jako pierwsze w swojej grupie, potem wartości zaczynające się od
  tekstu, a potem pozostałe — od ostatnio zmienionych.
- Nazwy organizacji są dopasowywane bez względu na polskie znaki diakrytyczne —
  `lodz` znajduje *Łódź*. Pozostałe pola są dopasowywane w takiej postaci, w
  jakiej zostały zapisane.
- Wklejenie wewnętrznego identyfikatora rekordu (widocznego w adresie strony)
  znajduje ten rekord niezależnie od konfiguracji pól.
- Wersje robocze, rekordy nieaktywne i zablokowane oraz anulowane zamówienia są
  znajdowane i pokazują swój status. Rekordy usunięte, zanonimizowani klienci i
  organizacje prywatne (B2C) nie są znajdowane; osoby stojące za organizacjami
  prywatnymi można znaleźć jako klientów.
- Nazwy produktów i kategorii są dopasowywane we wszystkich językach i
  wyświetlane w języku administratora.

Wyszukiwany tekst nie jest nigdzie zapisywany ani rejestrowany poza
standardowym dziennikiem żądań platformy.

## Kto co widzi

Wyszukiwanie globalne nigdy nie pokazuje rekordu, który lista danego typu w
panelu ukryłaby przed tym samym administratorem:

- Typ rekordu pojawia się tylko dla roli, która ma uprawnienie wymagane przez
  jego listę — `orders:read` dla zamówień, `rfqs:handle` dla zapytań
  ofertowych, `crm:read` dla szans sprzedażowych, `customers:read` (lub
  `customers:manage`) dla organizacji, `customers:read` dla klientów oraz
  `catalog:read` dla produktów i kategorii.
- Przedstawiciel handlowy widzi tylko zamówienia, zapytania ofertowe, szanse
  sprzedażowe i klientów organizacji, które zostały mu przypisane.
- Organizacje są widoczne dokładnie tak jak na liście organizacji:
  przedstawiciel handlowy widzi każdą organizację, którą pokazuje mu ta lista, a
  przypisane mu organizacje są wyświetlane na początku.

## Paleta poleceń

Wyszukiwanie rekordów zaczyna się, gdy tekst osiągnie minimalną długość (domyślnie
3 znaki). Każdy typ rekordu pokazuje domyślnie do pięciu wyników; jeśli pasuje
ich więcej, informuje o tym nagłówek grupy, a ostatni wiersz, **Zobacz wszystkie
wyniki**, otwiera pełną stronę wyników. Typ rekordu, którego nie udało się
przeszukać na czas, jest oznaczony jako niedostępny, a wyniki pozostałych typów
są nadal wyświetlane.

## Strona wyników

**/global-search** pokazuje do 20 wyników na typ rekordu dla tekstu wpisanego w
polu wyszukiwania. Przyciski typów zawężają wyniki do jednego typu rekordu. Adres
strony zawiera tekst i wybrany typ, więc można go dodać do zakładek albo wysłać
współpracownikowi — który zobaczy tylko to, co sam może zobaczyć.

## Konfiguracja pól wyszukiwania

Użytkownicy z uprawnieniem `admin_search:configure` otwierają **System →
Wyszukiwanie globalne** (albo *Konfiguruj wyszukiwanie globalne* w palecie
poleceń). Każdy typ rekordu ma kartę z dostępnymi polami, a pola domyślne są
oznaczone:

- zaznacz lub odznacz pola, aby wybrać, po czym typ jest przeszukiwany;
- odznacz **Uwzględniaj w wyszukiwaniu globalnym**, aby całkowicie pominąć typ;
- **Przywróć domyślne** przywraca typowi pola dostarczone z modułem.

Typ biorący udział w wyszukiwaniu potrzebuje co najmniej jednego pola, więc
przycisk **Zapisz** jest nieaktywny, dopóki pole nie zostanie zaznaczone albo typ
pominięty. Konfiguracja obowiązuje każdego administratora od jego następnego
wyszukiwania. Jeśli ktoś inny zapisał konfigurację po tym, jak ją otworzyłeś,
zapis proponuje jej ponowne wczytanie zamiast nadpisania jego zmian. Każdy zapis
trafia do dziennika audytu z wartością przed zmianą i po niej.

## Ustawienia

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `admin_search.enabled` | włączone | Przełącznik modułu na **/platform/modules**. |
| `admin_search.minimum_query_length` | 3 | Liczba znaków, po której wpisaniu przeszukiwane są rekordy (2–10). |
| `admin_search.results_per_entity` | 5 | Liczba wyników na typ rekordu w palecie poleceń (1–10). |

Konfiguracja pól wyszukiwania też jest przechowywana jako ustawienie
(`admin_search.entity_fields`), ale edytuje się ją wyłącznie na jej własnym
ekranie.

## Uprawnienia

| Kod | Daje dostęp do |
| --- | --- |
| `admin_search:configure` | Podglądu i zmiany konfiguracji pól wyszukiwania. |

Samo wyszukiwanie nie wymaga osobnego uprawnienia: każdy typ rekordu jest
filtrowany według uprawnienia wymaganego przez jego własną listę.

## Wyłączanie

Po wyłączeniu **Wyszukiwania globalnego** na **/platform/modules** paleta poleceń
znajduje tylko ekrany i akcje. Strona wyników, ekran konfiguracji i ich wpisy w
palecie znikają, ustawień nie można edytować, a API odpowiada tak, jakby modułu
nie było. Nic nie jest usuwane: po ponownym włączeniu wyszukiwanie globalne
działa z dotychczasową konfiguracją.

## Wydajność

Rekordy są odczytywane na bieżąco z tabel poszczególnych modułów, a liczba
pobieranych wierszy jest niewielka. Przy wolumenie referencyjnym — 100 000
zamówień, 50 000 klientów i produktów, 20 000 zapytań ofertowych i szans
sprzedażowych, 10 000 organizacji i 2 000 kategorii — wyszukiwanie we
wszystkich siedmiu typach zwraca wyniki w ciągu kilkuset milisekund. Gdyby
instalacja przerosła ten wolumen, rozwiązaniem jest indeks wyszukiwania na
kolumnach wolnego modułu, dodany przez ten moduł.

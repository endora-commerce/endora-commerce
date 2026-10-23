---
title: Hierarchia organizacji
---

# Hierarchia organizacji

Organizacje można zagnieżdżać w **drzewo**: centrala ma oddziały, a oddziały mogą mieć
pododdziały. W drzewie przekazywane są dwie rzeczy — **zakres dostępu** (użytkownik organizacji
nadrzędnej z włączonym wglądem w strukturę albo handlowiec z ograniczonym zakresem widzi całe
poddrzewo) oraz **warunki handlowe** (organizacja podrzędna bez własnej ceny danego produktu albo
bez limitu kredytowego dziedziczy je po najbliższej organizacji nadrzędnej).

To warstwa dodana do płaskiego modelu organizacji. Każda organizacja zaczyna jako **korzeń** (bez
organizacji nadrzędnej), a płaska instalacja działa bajt w bajt tak samo jak przed wprowadzeniem
hierarchii.

## Drzewo

Każda organizacja ma opcjonalne odwołanie do samej tabeli, `parent_id` (NULL ⇒ korzeń), oraz
utrzymywaną przez serwer ścieżkę `path` (`/<rootId>/…/<thisId>/`). Jedno indeksowane wyszukiwanie
po prefiksie odpowiada na pytania „podrzędne X” i „nadrzędne X” — bez przechodzenia węzeł po węźle.

- **Ustawienie lub zmiana organizacji nadrzędnej** — `POST /api/v1/admin/organizations/:id/parent`
  z `{ "parentId": "<uuid>" | null }`. `null` zamienia organizację z powrotem w korzeń. Przeniesienie
  jest sprawdzane pod kątem **cykli** (węzeł nie może stać się dzieckiem własnego potomka) i
  **maksymalnej głębokości 10 poziomów**, a także audytowane przez Command Bus
  (`organization.set_parent` / `organization.move`, oba odwracalne).
- **Odczyt poddrzewa** — `GET /api/v1/admin/organizations/:id/subtree` zwraca organizacje podrzędne
  (łącznie z samym węzłem) w kolejności pre-order, każdą jako `{ id, name, parentId, depth, status }`.
- **Odczyt organizacji nadrzędnych** — `GET /api/v1/admin/organizations/:id/ancestors` zwraca
  łańcuch od najbliższej organizacji nadrzędnej do korzenia.
- **Usunięcie jest zablokowane** — organizacji, która ma jakąkolwiek organizację podrzędną, nie
  można usunąć (`409 has_children`), co zabezpiecza też klucz obcy `parent_id … ON DELETE RESTRICT`.
  Najpierw przenieś albo usuń organizacje podrzędne.

Zmiana organizacji nadrzędnej działa **wstecz**: przynależność do poddrzewa, wgląd w strukturę i
dziedziczenie warunków są zawsze wyznaczane według *bieżącego* drzewa, więc po przeniesieniu historia
oddziału staje się widoczna dla użytkowników nowej organizacji nadrzędnej z wglądem w strukturę, a
oddział dziedziczy jej warunki.

Panel administracyjny ma na stronie szczegółów organizacji wybór organizacji nadrzędnej oraz widok
poddrzewa i organizacji nadrzędnych.

## Wgląd w strukturę

Widoczność organizacji podrzędnych wymaga uprawnienia `organizations:rollup` („Act across
organization descendants”).

- **Handlowiec z ograniczonym zakresem**, który ma to uprawnienie, ma każde przypisanie rozszerzone
  na poddrzewo przypisanego węzła. Organizacja podrzędna z **własnym** przypisaniem zastępuje
  odziedziczone dla swojego poddrzewa — wygrywa **najbliższe przypisanie w łańcuchu organizacji
  nadrzędnych**. Bez tego uprawnienia handlowiec widzi tylko organizacje przypisane mu bezpośrednio.
- Użytkownik oddziału bez wglądu w strukturę widzi wyłącznie własną organizację.

Rozszerzenie jest obliczane **po stronie serwera** i poszerza istniejące zabezpieczenie zakresu
tenanta (`allowedOrganizationIds`) dokładnie o poddrzewo — nigdy o organizacje siostrzane, dalsze
gałęzie ani organizacje nadrzędne powyżej przypisanego węzła. Rekordu spoza poddrzewa nie da się
odróżnić od rekordu, który nie istnieje. Trzy ekrany odczytu w panelu — zamówienia, oferty i klienci —
już korzystają z poszerzonego zakresu i nie wymagają żadnych zmian.

## Dziedziczenie warunków

Organizacja podrzędna bez własnego warunku handlowego przejmuje warunek najbliższej organizacji
nadrzędnej.

### Cenniki

Cennik dla organizacji wskazuje swoich odbiorców w nagłówku. Oddział jest wyceniany przez cenniki
wskazujące sam oddział **oraz** przez cenniki wskazujące którąkolwiek z jego organizacji nadrzędnych:
wycena buduje łańcuch organizacji kupującego jako `[thisOrg, rodzic, dziadek, …]` (od najbliższej), a
udział biorą wszystkie cenniki wskazujące członka tego łańcucha.

W kolejności cen łańcuch rozstrzyga **wewnątrz komórki**: gdy własny cennik oddziału i cennik
centrali wyceniają produkt w tej samej komórce — na przykład oba linią *organizacja × produkt* —
wygrywa bliższa organizacja, więc **cena oddziału zawsze wygrywa** z ceną centrali dla tego samego
rodzaju linii. Komórka nadal jest pierwsza: przy domyślnej kolejności *Najpierw umowa, rabat ogólny
na końcu* cena centrali za produkt wygrywa z własnym rabatem oddziału na kategorię tego produktu,
bo *organizacja × produkt* stoi wyżej niż *organizacja × kategoria*. Oddział bez linii w danej
komórce dziedziczy w niej linię centrali. Cenniki rodzeństwa nie wpływają na siebie nawzajem.
Cenniki grup klientów obowiązują przez jedną grupę klientów kupującego, nigdy przez grupę organizacji
nadrzędnej.

Pełna kolejność cen jest na stronie modułu `price_lists`; strona szczegółów organizacji wymienia
cenniki, które do niej docierają, także te dziedziczone.

### Limity kredytowe

Organizacja podrzędna bez własnego limitu kredytowego korzysta z limitu **najbliższej organizacji
nadrzędnej**, która go ma. Sposób korzystania z limitu organizacji nadrzędnej to **tryb ustawiany
dla każdej organizacji**, wyłącznie przez administratora platformy:

- **`shared_pool`** — każda organizacja w poddrzewie korzysta ze wspólnej puli zapisanej w wierszu
  organizacji nadrzędnej, do której należy limit. Równoczesne pobrania są wykonywane po kolei na tym
  wierszu, więc pula nie może zostać przekroczona (nie ma podwójnego wydania).
- **`independent_default`** — odziedziczona kwota jest osobnym limitem każdego oddziału; każdy oddział
  może wykorzystać pełną odziedziczoną kwotę niezależnie od organizacji siostrzanych.

Oddział z **własnym** limitem kredytowym nie korzysta z limitu odziedziczonego.

#### Ustawienie trybu dziedziczenia limitu

Wartością domyślną jest ustawienie dla całej platformy
`organizations.hierarchy.credit_inheritance_mode` (domyślnie **`shared_pool`**). Nadpisanie dla
konkretnej organizacji jest zapisywane w organizacji i ustawiane przez
`PUT /api/v1/admin/organizations/:id/credit-inheritance-mode` z
`{ "mode": "shared_pool" | "independent_default" | null }` (`null` przywraca wartość z ustawień).
Endpoint jest **dostępny tylko dla administratora platformy** — użytkownik z ograniczonym zakresem
albo wglądem w strukturę dostaje `403` — a zmiana jest audytowana (`organization.set_credit_mode`).

## Gwarancja zachowania płaskiego modelu

Dla organizacji będącej korzeniem poddrzewo to `{itself}`, łańcuch organizacji dla cenników to
`[itself]`, a właścicielem limitu jest sama organizacja (albo nikt). Zakres dostępu, ceny i limity
kredytowe działają więc dokładnie tak jak w modelu jednej organizacji sprzed tej funkcji, bajt w
bajt.

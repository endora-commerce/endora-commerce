---
title: Organization hierarchy
---

# Organization hierarchy

Organizations mogą być zagnieżdżane w **drzewo**: centrala (head-office) posiada
oddziały, które mogą mieć pododdziały. Po drzewie płyną dwie rzeczy — **scope**
(użytkownik rodzica z włączonym roll-up lub scoped sales-rep widzi całe poddrzewo)
oraz **warunki handlowe** (potomek bez własnego cennika lub limitu kredytowego
dziedziczy najbliższego przodka).

To addytywna warstwa nad płaskim modelem organization. Każda organization
startuje jako **root** (bez rodzica), a płaska instalacja zachowuje się
bajt-w-bajt tak jak przed hierarchią.

## Drzewo

Każda organization zapisuje nullable self-referential `parent_id` (NULL ⇒ root)
oraz utrzymywaną przez serwer materializowaną `path` (`/<rootId>/…/<thisId>/`).
Pojedyncze indeksowane skanowanie prefiksu odpowiada na „potomkowie X” i
„przodkowie X” — bez chodzenia per węzeł.

- **Przypisanie / przeniesienie rodzica** — `POST /api/v1/admin/organizations/:id/parent`
  z `{ "parentId": "<uuid>" | null }`. `null` odcina organization z powrotem do
  root. Przeniesienie jest walidowane względem **cykli** (węzeł nie może stać się
  dzieckiem własnego potomka) oraz **maksymalnej głębokości 10 poziomów** i jest
  audytowane przez Command Bus (`organization.set_parent` / `organization.move`,
  oba odwracalne).
- **Odczyt poddrzewa** — `GET /api/v1/admin/organizations/:id/subtree` zwraca
  potomków (włącznie z samym węzłem) w kolejności pre-order, każdego jako
  `{ id, name, parentId, depth, status }`.
- **Odczyt łańcucha przodków** — `GET /api/v1/admin/organizations/:id/ancestors`
  zwraca łańcuch parent → … → root, od najbliższego.
- **Usunięcie jest zablokowane** — organization z dowolnym dzieckiem nie może
  zostać usunięta (`409 has_children`), wspierane przez FK
  `parent_id … ON DELETE RESTRICT`. Najpierw przypisz ponownie lub usuń dzieci.

Re-parenting jest **retroaktywny**: członkostwo w poddrzewie, widoczność roll-up
i dziedziczenie warunków liczone są zawsze względem *bieżącego* drzewa, więc po
przeniesieniu historia oddziału staje się widoczna dla roll-up userów nowego
rodzica i dziedziczy jego warunki.

Panel admin wystawia parent picker oraz widok poddrzewa/przodków na stronie
szczegółów organization.

## Roll-up scope

Widoczność wśród potomków jest **permission-gated** przez capability
`organizations:rollup` („Act across organization descendants”).

- **Scoped sales-rep** z tą capability ma każde przypisanie rozszerzone do
  poddrzewa przypisanego węzła. Potomek z **własnym** przypisaniem nadpisuje
  dziedziczone dla swojego poddrzewa — wygrywa **najbliższe przypisanie na
  łańcuchu przodków**. Bez capability rep pozostaje ograniczony do organizations
  bezpośrednio mu przypisanych.
- Użytkownik tylko oddziałowy (bez roll-up) widzi wyłącznie własną organization.

Ekspansja jest liczona **po stronie serwera** i poszerza istniejący guard
tenant-scope (`allowedOrganizationIds`) dokładnie do poddrzewa — nigdy do
rodzeństwa, kuzynostwa ani przodka poza przyznanym węzłem. Rekord poza
poddrzewem jest nieodróżnialny od „nie istnieje”. Trzy powierzchnie odczytu
admin — orders, quotes i customers — czytają już poszerzony scope i nie
wymagają własnej zmiany.

## Dziedziczenie warunków

Potomek bez własnego warunku handlowego rozwiązuje najbliższego przodka.

### Price lists

Cenniki targetują organizations przez regułę aplikacji (brak FK organization).
Resolver buduje zbiór kandydatów org jako `[thisOrg, …ancestors]` (nearest-first)
i zachowuje istniejący porządek priorytetów
(`organization` > `customerGroup` > `category` > `salesChannel`):

- cennik wskazujący **bliższą** organization przeważa nad dalszym przodkiem, więc
  **override oddziału zawsze wygrywa**;
- dziedziczony cennik org-named przodka nadal przeważa nad customer-group,
  category lub sales-channel;
- oddział bez własnego cennika spada do org-named listy najbliższego przodka,
  zanim przejdzie do poziomów bez org.

Tylko ta gałąź odbiega — rodzeństwo pozostaje nietknięte. Rozwiązanie to jeden
przebieg (bez re-run per ancestor).

### Credit limits

Potomek bez własnego limitu kredytowego transakcjonuje względem **najbliższego
przodka**, który limit ma. Sposób konsumpcji limitu przodka to **tryb per
organization**, ustawiany wyłącznie przez platform administrator:

- **`shared_pool`** — każda organization w poddrzewie czerpie ze wspólnej puli
  na wierszu owning ancestor. Równoległe pobrania serializują się na tym wierszu,
  więc pula nie może być przekroczona (brak double-spend).
- **`independent_default`** — dziedziczona kwota to własny limit każdego
  oddziału; każdy oddział może wykorzystać pełną dziedziczoną kwotę niezależnie
  od rodzeństwa.

Oddział z **własnym** limitem kredytowym nadpisuje dziedziczony.

#### Ustawienie credit-inheritance-mode

Domyślna fabryka to platform-wide Settings value
`organizations.hierarchy.credit_inheritance_mode` (default **`shared_pool`**).
Override per organization trzymany jest na organization i ustawiany przez
`PUT /api/v1/admin/organizations/:id/credit-inheritance-mode` z
`{ "mode": "shared_pool" | "independent_default" | null }` (`null` wraca do
domyślnej Settings). Endpoint jest **tylko dla platform-admin** — scoped lub
roll-up actor dostaje `403` — a zmiana jest audytowana
(`organization.set_credit_mode`).

## Gwarancja zachowania płaskiego

Dla root organization poddrzewo to `{itself}`, łańcuch org cennika to
`[itself]`, a credit owner to sama organization (albo brak). Scope, pricing i
credit resolution więc zapadają się do zachowania single-organization sprzed
feature, bajt-w-bajt.

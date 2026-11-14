---
title: Megamenu
sidebar_position: 1
description: Konfigurowalne drzewo nawigacji przypisywane osobno do każdej pary kanału i języka
---

# Megamenu

Moduł Megamenu odpowiada za główną nawigację storefrontu. Wprowadza konfigurowalne drzewo pozycji
menu, tworzone w panelu administracyjnym i przypisywane do par `(kanał sprzedaży × język)`,
generowane po stronie serwera w Next.js: na komputerze jako pasek zakładek — każda otwiera się jako
link, lista, panel z kolumnami albo panel katalogu — a na telefonie jako wysuwane menu z kolejnymi
poziomami. Pozycje mogą na bieżąco rozwijać drzewo kategorii z katalogu, dziedziczyć etykiety po
tym, do czego prowadzą, i być widoczne tylko dla wybranych odbiorców.

## Encje i rodzaje pozycji

| Encja              | Identyfikator                          | Uwagi                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| **Megamenu**        | `id` (uuid)                         | Wiersz konfiguracji — nazwa, opis, wersja.      |
| **MegamenuItem**    | `id` (uuid) + `parentId` (odwołanie do tej samej tabeli)  | Węzeł drzewa zapisanego listą sąsiedztwa, z `target` zależnym od rodzaju. |
| **MegamenuBinding** | `(megamenuId, salesChannelId, language)` | Flaga `active` dla danego zakresu, pilnowana częściowym indeksem unikalnym. |

Zamknięty zbiór rodzajów pozycji:

| `kind`            | Postać celu                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `category-link`   | `{ categoryId, iconAssetId?, iconPosition? }`                         |
| `cms-page-link`   | `{ pageId, iconAssetId?, iconPosition? }`                             |
| `external-link`   | `{ url, iconAssetId?, iconPosition? }` (URL: `http\|https\|tel\|mailto`) |
| `button`          | `{ url, variant: 'primary'\|'secondary'\|'ghost' }`                   |
| `asset`           | `{ assetId, kind: 'image'\|'video' }`                                 |
| `cms-block-embed` | `{ blockId, embedSide: 'left'\|'right' }`                             |
| `group`           | `{}` — nagłówek bez linku; kolumna panelu `mega`                      |
| `category-tree`   | `{ rootCategoryId: uuid \| null, depth: 1\|2\|3 }` — drzewo kategorii rozwijane na bieżąco z katalogu |

Opcjonalne `iconAssetId` przyjmuje tylko pliki z biblioteki mediów rodzaju `image`; walidacja
odrzuca pliki innego rodzaju.

## Pasek nawigacji

Pozycje najwyższego poziomu to **zakładki** paska nawigacji storefrontu, w swojej kolejności. Każda
zakładka ma `presentation`, czyli sposób otwierania, oraz `alignment`, czyli koniec paska, przy
którym stoi (`start`, domyślnie, albo `end`). Żadna pozycja poniżej najwyższego poziomu nie ma tych
pól; baza danych to odrzuca (`megamenu_items_tab_fields_check`).

| `presentation` | Zakładka… | Jej pozycje podrzędne wyświetlają się jako |
| -------------- | --------- | ------------------------------------------ |
| `link`         | prowadzi pod adres i niczego nie otwiera | — zakładka `link` nie ma pozycji podrzędnych |
| `dropdown`     | otwiera wąską listę pod sobą | jeden poziom; pozycja `group` jest nagłówkiem sekcji |
| `mega`         | otwiera panel na całą szerokość | luźne linki w pierwszej kolumnie, kolumna dla każdej `group`, osadzenia i pliki w miejscu na promocję |
| `catalog`      | otwiera panel z listą po lewej (*Panel z listą po lewej* w edytorze) | pozycje zakładki jako lista po lewej; ta pod kursorem pokazuje po prawej swoje pozycje jako nagłówki kolumn z ich pozycjami pod spodem — a gdy jest kategorią, także link *Wszystko w: …* — oraz miejsce na promocję |

Zakładką może być `category-link`, `cms-page-link`, `external-link`, `button` albo `group`. Pozycje
`asset`, `cms-block-embed` i `category-tree` otwierają się pod zakładką i jako zakładka są odrzucane
(`400 MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`). Zakładka `link` musi gdzieś prowadzić i nie może mieć
pozycji podrzędnych (`400 MEGAMENU_LINK_TAB_INVALID`).

Panel `catalog` to układ, a nie katalog: pasuje do każdej zakładki z wieloma pozycjami, z których
każda ma własną listę, a drzewo kategorii jest jego najczęstszą zawartością.

Domyślnie kliknięcie zakładki z panelem otwiera panel. Zakładka `category-link`, `cms-page-link`
albo `external-link` może zamiast tego **po kliknięciu prowadzić pod własny adres**
(`clickNavigates: true`, *Kliknięcie zakładki otwiera jej link* w edytorze): zakładka jest wtedy
linkiem i osobnym przyciskiem ze strzałką, który otwiera panel, a panel otwiera się też po
najechaniu. Każda inna zakładka albo pozycja poniżej najwyższego poziomu jest odrzucana z
`400 VALIDATION_FAILED`. Na telefonie własny link zakładki, do której się przeszło, jest zawsze
pierwszym wierszem jej poziomu.

Zakładka, której wszystkie pozycje podrzędne są ukryte przed odwiedzającym (zob. *Odbiorcy*) albo
której drzewo kategorii nic nie zawiera, znika z jego paska — chyba że ma własny link; wtedy
wyświetla się jako zwykły link.

### Drzewa kategorii

Pozycja `category-tree` jest przy każdym odczycie zastępowana aktywnymi kategoriami katalogu poniżej
swojego korzenia (albo poniżej najwyższego poziomu katalogu, gdy korzeń to `null`), do swojej
głębokości, w kolejności z katalogu. Kategoria nieaktywna lub usunięta znika razem z całą gałęzią.
Kategoria utworzona, przemianowana lub przesunięta w katalogu trafia do menu w czasie życia pamięci
podręcznej menu, bez edycji menu. Każda rozwinięta kategoria jest w wynikowym drzewie pozycją
`category-link` z własną nazwą i linkiem `/c/<slug>`; jej identyfikator to
`<id pozycji drzewa>:<id kategorii>`, bo nie ma własnego wiersza.

## Etykiety

Pozycje `category-link`, `cms-page-link` i `category-tree` mogą mieć pustą etykietę w dowolnym
języku. Pusta etykieta przyjmuje nazwę celu w obsługiwanym języku, a w razie jej braku w języku
domyślnym kanału (w przypadku kategorii — ostatecznie dowolną jej nazwę). Wpisana etykieta zawsze ma
pierwszeństwo. `cms-page-link` podąża za nazwą i slugiem strony w każdym języku oraz za ścieżką jej
strony nadrzędnej (`findStorefrontLinks` z `@endora-commerce/mod-cms`), więc prowadzi pod adres
strony w obsługiwanym języku. Prefiks języka dokłada sklep, jak przy każdym linku menu.

Pozycje `external-link`, `button` i `group` nie mają nazwy, którą mogłyby odziedziczyć, i potrzebują
etykiety w co najmniej jednym języku (`400 MEGAMENU_LABEL_REQUIRED`).

## Odbiorcy

Każda pozycja ma `audience`:

| `audience.kind`   | Kto widzi pozycję |
| ----------------- | ----------------- |
| `everyone`        | każdy odwiedzający (domyślnie) |
| `guests`          | odwiedzający, który nie jest zalogowany |
| `signed_in`       | zalogowany klient |
| `customer_groups` | zalogowany klient, którego **efektywna grupa klientów** — grupa jego konta, a w razie jej braku grupa jego organizacji, czyli ta sama reguła co w cenach (`effectiveCustomerGroupId`) — jest jedną z `customerGroupIds` |

Ukrycie pozycji ukrywa całe jej poddrzewo. Odbiorcy wskazujący nieistniejącą grupę klientów są
odrzucani przy zapisie (`400 MEGAMENU_TARGET_OUT_OF_SCOPE`); grupa usunięta później nie pasuje do
nikogo, więc pozycja zawęża się do pozostałych grup, a gdy żadna nie zostanie — jest ukryta. Klucz
API albo administrator odczytujący API storefrontu widzi to, co gość.

API storefrontu zwraca każdemu odwiedzającemu tylko pozycje jego odbiorców i nic z pozostałych —
ani etykiety, ani adresu, ani reguły odbiorców.

## Zapisy i audyt

Każdy zapis — utworzenie, zmiana i usunięcie menu, zapis drzewa pozycji oraz dodanie, usunięcie,
aktywacja i dezaktywacja przypisania — wykonuje się jako komenda (`megamenu.create`,
`megamenu.update`, `megamenu.delete`, `megamenu.items.set`, `megamenu.binding.add`,
`megamenu.binding.remove`, `megamenu.binding.activate`, `megamenu.binding.deactivate`) i zapisuje
jeden wpis audytu z typem obiektu `megamenu`. Wpis zapisu drzewa zawiera drzewo: rodzaj, sposób
otwierania, położenie, odbiorców, etykiety i cel każdej pozycji.

## Zasady aktywacji

W danej chwili dla pary `(kanał sprzedaży, język)` aktywne (`active`) może być najwyżej jedno
megamenu. Baza danych wymusza to przez:

```sql
CREATE UNIQUE INDEX megamenu_bindings_active_uniq
  ON megamenu_bindings (sales_channel_id, language)
  WHERE active = true;
```

Transakcja aktywacji:

1. `UPDATE megamenu_bindings SET active = false WHERE sales_channel_id = ? AND language = ? AND active = true;` — dezaktywuje dotychczas aktywne menu (jeśli było).
2. `UPDATE megamenu_bindings SET active = true WHERE megamenu_id = ? AND sales_channel_id = ? AND language = ?;` — aktywuje wskazane przypisanie.

Obie instrukcje wykonują się w jednej transakcji, więc częściowy indeks unikalny nigdy nie widzi
stanu z dwoma aktywnymi menu. Endpoint aktywacji zwraca dotychczas aktywne menu w
`previouslyActive`, aby okno potwierdzenia w panelu mogło pokazać „przełączono z `<name>`”.

Aktywacja pustego drzewa jest odrzucana z `400 MEGAMENU_EMPTY_TREE`. Usunięcie konfiguracji jest
odrzucane z `409 MEGAMENU_HAS_ACTIVE_BINDINGS`, gdy choć jedno przypisanie ma `active = true`
(administrator musi najpierw je dezaktywować).

## Zakres: kanał sprzedaży i język

Konfiguracja może mieć wiele przypisań `(salesChannelId, language)`. Endpoint przypisań odrzuca
język spoza zbioru języków skonfigurowanych dla kanału z `400 MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.
Po usunięciu przypisania dany zakres nie ma megamenu, dopóki nie zostanie aktywowana inna
konfiguracja.

Wartość zastępcza etykiety: gdy pozycja nie ma etykiety w żądanym języku, storefront używa języka
domyślnego kanału. Pozycje bez etykiety w obu językach są po cichu pomijane w wynikowym drzewie
(administrator widzi ostrzeżenie w edytorze).

## Głębokość drzewa

Głębokość drzewa to wskazówka dotycząca użyteczności, a nie twarde ograniczenie. Model danych nie
ma limitu. Formularz w panelu pokazuje nieblokujące ostrzeżenie po przekroczeniu 4 poziomów:

```
meta.warnings: [{ code: "MEGAMENU_DEPTH_EXCEEDED", message: "..." }]
```

Zapis i tak się udaje; każdy poziom jest wyświetlany w storefroncie.

## Ochrona odwołań

Pozycje megamenu mają luźne odwołania do encji z innych modułów (kategorii, stron CMS, bloków CMS,
plików z biblioteki mediów). Usunięcie którejkolwiek z nich jest odrzucane, dopóki megamenu się do
niej odwołuje:

| Encja | Rejestr / moduł                       | Dopasowanie w megamenu_items.target  |
| --------------- | --------------------------------------- | ------------------------------------ |
| Plik z biblioteki mediów   | `AssetReferenceRegistry`                | `assetId` OR `iconAssetId`           |
| Strona CMS        | `CmsReferenceRegistry`                  | `kind='cms-page-link' AND pageId = ?` |
| Blok CMS       | `CmsReferenceRegistry`                  | `kind='cms-block-embed' AND blockId = ?` |
| Kategoria        | (rejestr odwołań do kategorii w katalogu)   | `kind='category-link' AND categoryId = ?` (planowane) |

Każda rejestracja to jedno wywołanie we własnym hooku startowym modułu megamenu (`ctx.onBoot` w
`src/backend/index.ts` modułu). Istniejące
`findBlockReferences` / `findTemplateReferences` modułu CMS rozszerzono tak, aby sprawdzały
zewnętrzne skanery; `registerMegamenuCmsReferences` modułu megamenu rejestruje tam swój skaner.

Rejestr odwołań do kategorii jest planowany w module katalogu; dopóki nie powstanie, ochrona przed
usunięciem kategorii używanej w megamenu działa na poziomie walidacji (megamenu nie może zapisać
pozycji wskazującej usuniętą kategorię — sprawdzenie kategorii zwraca `false`, a administrator widzi
czytelny błąd).

## Odczyt w storefroncie i pamięć podręczna w Redis

Jeden endpoint odczytu:

```
GET /api/v1/megamenu/by-channel?language=<bcp-47>
X-Sales-Channel: <channel-code>
```

Mechanizm odczytu:

1. Wyszukuje aktywne przypisanie przez częściowy indeks unikalny (1 zapytanie).
2. Odczytuje wszystkie pozycje tego megamenu w kolejności `(parent_id, position)` (1 zapytanie).
3. Odczytuje kategorie katalogu jeden raz, gdy menu ma link do kategorii albo drzewo kategorii, oraz
   jeden raz linki storefrontu wszystkich stron, do których prowadzi menu, w obsługiwanym języku.
4. Przechodzi drzewo, obsługując każdy rodzaj `kind`: rozwija drzewa kategorii, ustala etykiety i
   adresy, podpisuje adresy plików przez bibliotekę mediów, wstawia bloki CMS przez mechanizm odczytu
   CMS dla storefrontu i uzupełnia ikony.
5. Zachowuje pozycje wszystkich odbiorców, każdą z jej odbiorcami, i zapisuje to drzewo w pamięci
   podręcznej.
6. Filtruje drzewo dla odwiedzającego i zwraca rekurencyjną strukturę `ResolvedMegamenu`.

Drzewa są przechowywane w Redis pod kluczem `megamenu:v2:<channel>:<language>` z TTL 5 minut —
jeden wpis na zakres obsługuje wszystkich odwiedzających, bo filtr odbiorców działa po odczycie z
pamięci podręcznej. Unieważnianie:

- `POST /menus`, `PATCH /menus/:id`, `PUT /menus/:id/items`, `DELETE /menus/:id` → usunięcie
  wszystkich kluczy `megamenu:v2:*` (jedno menu może obsługiwać wiele przypisań).
- `POST /menus/:id/bindings` / `DELETE /menus/:id/bindings/:channel/:language` → usunięcie klucza
  dla zmienionego zakresu.
- `POST /menus/:id/activate` / `POST /menus/:id/deactivate` → usunięcie klucza dla aktywowanego lub
  dezaktywowanego zakresu.
- Zapis bloku lub strony CMS (`cms.content_changed.v1`) → usunięcie wszystkich kluczy
  `megamenu:v2:*`, ponieważ odpowiedź menu zawiera drzewo każdego osadzonego bloku oraz nazwę i
  adres każdej strony, do której prowadzi pozycja.
- Zapis pliku, który zmienia jego wygląd (`assets_library.asset_changed.v1` — podmiana pliku,
  przywrócenie wersji, ustawienie lub usunięcie stałego linku, zmiana widoczności, usunięcie lub
  przywrócenie, zmiana nazwy pliku, etykiety, tekstu alternatywnego lub typu MIME) → usunięcie
  wszystkich kluczy `megamenu:v2:*`, ponieważ odpowiedź menu zawiera adres i etykietę każdej pozycji
  typu plik oraz adres każdej ikony. Gdy modułu `assets_library` nie ma, nic nie jest ogłaszane, a
  wyłączony moduł `megamenu` nie reaguje.

Odpowiedź dla zalogowanego wywołującego ma nagłówek `Cache-Control: private, no-store`; odpowiedź
anonimowa go nie ma. Storefront pobiera menu zalogowanego kupującego z jego sesją i nigdzie go nie
przechowuje; menu gościa trafia do Data Cache Next.js na 60 sekund, oznaczone tagiem `megamenu`
(`MEGAMENU_STOREFRONT_CACHE_TAG` w `@endora-commerce/contracts`). Każde z powyższych
unieważnień wysyła też ten tag do `/api/revalidate` storefrontu, po usunięciu kluczy z Redis, więc
zmienione menu jest widoczne przy następnym żądaniu. Wymaga to zmiennych `STOREFRONT_BASE_URL` i
`REVALIDATE_SECRET`, bez nich jest pomijane i nigdy nie powoduje błędu zapisu, gdy storefront jest
niedostępny.

Pamięć podręczna działa dokładnie tak jak `CmsCache` modułu CMS (ten sam schemat przedrostka, ten
sam TTL, to samo unieważnianie oparte na SCAN).

## Wyświetlanie w storefroncie

### Komputer

Nagłówek wyświetla zakładki aktywnego menu jako jeden pasek (`NavigationBar`): najpierw zakładki
wyrównane do początku, na końcu wyrównane do końca, i żadnej pozycji nawigacji, której menu nie
zawiera. Zakładka `link` oraz zakładka, która nie ma czego otworzyć, jest linkiem; zakładka `button`
wyświetla się w swoim wariancie. Każda inna zakładka to przycisk rozwijający jej panel: najechanie
(z opóźnieniem zapobiegającym przypadkowym zmianom), kliknięcie, Enter lub Spacja go otwiera; Escape
przywraca fokus na zakładkę; zjechanie kursorem lub kliknięcie gdzie indziej go zamyka. Zakładki,
które nie mieszczą się w szerokości paska, trafiają do zakładki *Więcej* na jego końcu. Serwer
generuje każdą zakładkę i linki każdego panelu, więc roboty wyszukiwarek i odwiedzający bez
JavaScriptu docierają do wszystkich.

Każda pozycja wyświetla się zgodnie ze swoim rodzajem: linki z ikoną (a w panelach `dropdown` i
`mega` także z opisem), przyciski jako przyciski, grupy jako nagłówki bez linku, pliki jako obraz lub
wideo, osadzenia jako wygenerowany blok. Teksty samego paska (*Więcej*, *Wszystko w: …*) pochodzą z
tłumaczeń storefrontu.

### Telefon

Poniżej `768px` wyświetla się przycisk menu. Dotknięcie otwiera wysuwane menu z kolejnymi
poziomami, którego pierwszy poziom zawiera zakładki odwiedzającego: zakładka `link` prowadzi pod
adres, każda inna przechodzi do swoich pozycji. Grupa wyświetla się jako nagłówek sekcji z
pozycjami pod spodem. Kolejny poziom pokazuje okruszki i link do samej pozycji. Osadzone bloki CMS,
przyciski i pliki są wyświetlane jeden pod drugim. Teksty wysuwanego menu są tłumaczone.

## API HTTP

### Panel administracyjny (`/api/v1/admin/megamenu`)

| Metoda  | Ścieżka                                                        | Przeznaczenie                                              |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| GET     | `/menus`                                                    | Lista konfiguracji z liczbą przypisań.              |
| POST    | `/menus`                                                    | Utworzenie megamenu (bez pozycji i przypisań).     |
| GET     | `/menus/:id`                                                | Szczegóły z drzewem i przypisaniami.                  |
| PATCH   | `/menus/:id`                                                | Edycja metadanych. Uwzględnia `If-Match` przez `version`. |
| DELETE  | `/menus/:id`                                                | Odrzucane, gdy którekolwiek przypisanie ma `active = true`. |
| PUT     | `/menus/:id/items`                                          | Zapis całego drzewa pozycji (pełne nadpisanie).         |
| GET     | `/menus/:id/bindings`                                       | Lista wszystkich przypisań konfiguracji.               |
| POST    | `/menus/:id/bindings`                                       | Dodanie przypisania `(channel, language)` (zawsze nieaktywnego). |
| DELETE  | `/menus/:id/bindings/:salesChannelId/:language`             | Usunięcie przypisania (idempotentne).                   |
| POST    | `/menus/:id/activate`                                       | Atomowa zamiana aktywnego menu.                           |
| POST    | `/menus/:id/deactivate`                                     | Dezaktywacja przypisania.                             |

### Storefront (`/api/v1/megamenu`)

| Metoda | Ścieżka                              | Zwraca                                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/by-channel?language=…`          | Megamenu dla żądanego zakresu; `404 MEGAMENU_NOT_FOUND`, gdy nie ma aktywnego przypisania. |

## Migracje

Migracja `20260505T193836_megamenu_init.ts` dodaje trzy nowe tabele i częściowy indeks unikalny. Nie tworzy
żadnych wierszy; administratorzy tworzą pierwszą konfigurację w panelu.

Migracja `20261029T190956_megamenu_tab_click_navigates.ts` dodaje kolumnę `click_navigates`
(domyślnie wyłączoną, tylko dla pozycji najwyższego poziomu).

Migracja `20261029T162855_megamenu_navigation_bar.ts` dodaje do `megamenu_items` kolumny
`presentation`, `alignment` i `audience`, zamienia każdą zapisaną pozycję najwyższego poziomu w
zakładkę `mega` wyrównaną do początku, aby spełniała nowe ograniczenie, i niczego więcej nie
przekształca: zapisane menu zachowuje swoje pozycje, a jego nowy kształt nadaje się w edytorze.

Megamenu jest umieszczone w głównym układzie storefrontu, między `<Header>` a istniejącym hookiem
`header.bottom`. Integracja z hookami CMS pozostaje bez zmian.

## Kody błędów

`MEGAMENU_NOT_FOUND`, `MEGAMENU_HAS_ACTIVE_BINDINGS`, `MEGAMENU_EMPTY_TREE`,
`MEGAMENU_BINDING_NOT_FOUND`, `MEGAMENU_BINDING_ALREADY_EXISTS`,
`MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `MEGAMENU_TARGET_OUT_OF_SCOPE`,
`MEGAMENU_ASSET_KIND_MISMATCH`, `MEGAMENU_ASSET_URL_UNSUPPORTED`, `MEGAMENU_REFERENCED`,
`MEGAMENU_DEPTH_EXCEEDED`, `MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`, `MEGAMENU_LINK_TAB_INVALID`, `MEGAMENU_LABEL_REQUIRED`.

Zapis drzewa zwraca też nieblokujące ostrzeżenia w `meta.warnings`: `MEGAMENU_DEPTH_EXCEEDED`,
`MEGAMENU_DROPDOWN_DEPTH_IGNORED` (zakładka `dropdown` pokazuje jeden poziom) i
`MEGAMENU_PROMO_SLOT_TAKEN` (dwa osadzenia jednego panelu po tej samej stronie; wyświetla się
pierwsze).

Wszystkie odpowiedzi z błędem mają strukturę zgodną z kontraktem błędów platformy w
`packages/contracts/src/errors.ts`.

## Poza zakresem (v1)

- Odbiorcy wskazani jako organizacje: zbiór kupujących wskazują grupy klientów.
- Odznaki, widoczność w zaplanowanym czasie i miejsca menu poza nagłówkiem (stopka, górny pasek).
- Testy A/B wariantów menu.
- Podgląd w panelu bez publikacji.
- Pozycje wskazujące bezpośrednio stronę produktu (użyj linku do kategorii albo linku zewnętrznego).
- Pozycje z plikiem podanym dowolnym adresem URL: naturalnym miejscem na pobieranie, sprawdzanie i
  przechowywanie zewnętrznych plików jest `importFromUrl` po stronie serwera w bibliotece mediów;
  walidacja modułu Megamenu odrzuca takie pozycje, dopóki ta funkcja nie powstanie, odpowiedzią
  `400 MEGAMENU_ASSET_URL_UNSUPPORTED` z identyfikatorem pozycji `itemId` w `details` (do zgłoszenia
  #640 była to odpowiedź `400 VALIDATION_FAILED`). Administratorzy najpierw przesyłają plik do
  biblioteki i odwołują się do niego po identyfikatorze.
- Budowanie drzewa przez przeciąganie w panelu: edytor v1 korzysta z przycisków w górę, w dół, usuń
  i dodaj pozycję podrzędną. `@dnd-kit` nie jest dołączany do aplikacji panelu, a założenia
  kładły nacisk na samą edycję drzewa, a nie na wyrafinowane gesty.

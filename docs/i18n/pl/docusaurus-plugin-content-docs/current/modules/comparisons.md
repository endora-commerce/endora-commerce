---
title: Porównywarka produktów
description: 'Porównywarka produktów: zestaw wybrany przez klienta, z trybami wyświetlania, linkiem do udostępnienia i eksportem do PDF'
---

# Porównywarka produktów

Moduł porównywania produktów po stronie klienta. Odpowiada za pełnoprawny zasób `Comparison`
(zestaw produktów wybrany przez klienta, z wybranym trybem wyświetlania i stałym linkiem do
udostępnienia), podgląd porównań w panelu administracyjnym oraz eksport do PDF generowany w Node.
Moduł celowo nie przechowuje danych katalogu; produkty i flagę atrybutu `is_comparable` odczytuje
przez port `CatalogQueryService`.

Ta strona jest przeznaczona dla dwóch grup odbiorców:

- **Kupujących i administratorów platformy**, którzy chcą wiedzieć, *co* robi ta funkcja (sekcje „Co
  robi kupujący”, „Co widzi administrator”, „Co konfiguruje administrator”).
- **Programistów**, którzy muszą rozszerzyć moduł albo go utrzymywać (wszystkie sekcje od „API
  publiczne”).

## Co robi kupujący

### 1. Wybierz produkty do porównania

Na dowolnej liście produktów albo stronie produktu kliknij **Compare** na karcie produktu. Przycisk
działa jak przełącznik — kliknij ponownie, aby usunąć produkt z porównania. Przycisk w nagłówku
(**Compare (N)**) pokazuje, ile produktów jest w porównaniu.

Przy pierwszym oznaczeniu produktu storefront rozpoczyna sesję porównania. Nie trzeba być zalogowanym.

### 2. Otwórz stronę porównania

Kliknij przycisk w nagłówku albo przejdź do `/compare`. Zobaczysz tabelę z produktami obok siebie:

- Wiersz nagłówka zawsze pokazuje **nazwę**, **cenę** w walucie kanału sprzedaży i **główne zdjęcie**
  każdego produktu.
- Niżej widać każdy atrybut, który administrator katalogu oznaczył jako porównywalny (waga, materiał,
  wymiary itd. — zależnie od kategorii).

### 3. Zmień widok

Pasek nad tabelą ma trzy przyciski:

- **All attributes** — pokazuje wszystko; wiersze jednakowe dla wszystkich produktów są wyciszone, a
  różniące się — wyróżnione.
- **Common attributes only** — pokazuje tylko wiersze, w których wszystkie produkty się zgadzają, aby
  potwierdzić wspólne cechy.
- **Differences only** — pokazuje tylko wiersze, w których co najmniej jeden produkt się różni, aby
  łatwiej było podjąć decyzję.

Zmiana widoku jest natychmiastowa — bez przeładowania.

### 4. Udostępnij współpracownikowi

Kliknij **Copy share link**. Storefront kopiuje do schowka adres w postaci
`https://your-store/compare/share/<token>`. Każdy, kto otworzy ten link, zobaczy to samo porównanie —
bez konta i bez możliwości wprowadzania zmian. Może lokalnie przełączać widoki, ale nie może usuwać
produktów, kasować porównania ani używać przycisku *Add to cart*.

Link działa, dopóki porównanie istnieje. Po usunięciu porównania link przestaje działać dla
wszystkich.

**To, co widzi odbiorca, zależy od tego, kim jest odbiorca**, a nie od tego, kto wysłał link. Link
daje dostęp do porównania, nigdy do niczego, co się w nim znajduje:

- **Ceny** — zalogowany odbiorca widzi ceny uzgodnione z *jego* organizacją, a niezalogowany —
  standardowe ceny sklepu. Twoje negocjowane ceny nigdy nie wyciekną przez wysłany przez ciebie
  link, a strona informuje, czyje ceny pokazuje.
- **Produkty** — jeśli porównanie zawiera produkt dostępny tylko dla twojej organizacji, odbiorca
  spoza niej nie zobaczy tej kolumny. Strona informuje, że część produktów jest dla niego
  niedostępna, zamiast po cichu skrócić tabelę. Odbiorca, którego organizacja może widzieć produkt,
  widzi go normalnie.

### 5. Dodaj wybrany produkt do koszyka

Po podjęciu decyzji kliknij **Add to cart** w kolumnie wybranego produktu. Koszyk przyjmuje produkt
według tych samych zasad co ze strony produktu (dostępność w kanale, stan magazynowy). Samo porównanie
się nie zmienia.

### 6. Eksport do PDF

Kliknij **Export to PDF**. Storefront pobiera plik `comparison-<token>.pdf`, który odpowiada temu, co
jest na ekranie — te same produkty, ten sam widok, ta sama kolejność kolumn. PDF jest generowany za
każdym razem od nowa; zmiana widoku i ponowny eksport daje nowy plik z nowym widokiem.

PDF z trzema lub więcej produktami ma orientację poziomą, a z jednym lub dwoma — pionową.

### 7. Zakończ

Po zakończeniu kliknij **Delete comparison**. Zestaw zostaje wyczyszczony, a wysłane linki przestają
działać.

## Limity i przypadki szczególne

- **Najwięcej produktów w porównaniu** — domyślnie **4**. Operator platformy może zwiększyć albo
  zmniejszyć ten limit dla kanału sprzedaży w ustawieniach (`compare.max_products`). Dodanie produktu
  ponad limit jest odrzucane z komunikatem; istniejące porównanie się nie zmienia.
- **Usunięcie produktu** — usuwa kolumnę. Dla pozostałych kolumn ponownie wyznaczane jest, które
  wiersze są wspólne, a które się różnią.
- **Jeden produkt w zestawie** — strona się wyświetla, ale proponuje dodanie co najmniej jeszcze
  jednego produktu, aby porównanie miało sens.
- **Pusty zestaw** — strona zachęca do dodania produktów z katalogu.
- **Produkt znika z katalogu** — gdy produkt zostanie wycofany, będąc w porównaniu, jego kolumna
  zostaje, ale jest oznaczona jako niedostępna, a przycisk *Add to cart* w tej kolumnie jest
  nieaktywny.
- **Link otwarty w innym kanale sprzedaży** — odbiorca widzi ceny w walucie swojego kanału, a produkt
  niesprzedawany w jego kanale nadal jest widoczny, ale oznaczony jako niedostępny.
- **Link otwarty przez kupującego z innej organizacji** — ceny w kolumnach są wyznaczane według umów
  tego kupującego, a produkt, którego nie może widzieć, jest pomijany z informacją o tym.
- **Atrybuty wielowartościowe** — dwa produkty są zgodne w atrybucie wielowartościowym (np. lista
  certyfikatów) tylko wtedy, gdy mają identyczne zbiory wartości.
- **Brakujące wartości** — produkt bez wartości w danym wierszu pokazuje `—`, a wiersz jest liczony
  jako różnica.

## Co widzi administrator

Otwórz **Comparisons** na pasku bocznym panelu. Lista pokazuje wszystkie porównania utworzone przez
klientów, z e-mailem klienta (albo *Anonymous* dla niezalogowanych), kanałem sprzedaży, aktywnym
widokiem, liczbą produktów i czasem utworzenia. Można filtrować według kanału, rodzaju właściciela
albo okresu; domyślnie najnowsze są na górze.

Kliknij wiersz, aby otworzyć szczegóły. Zobaczysz każdy produkt i każdy wiersz atrybutu, który klient
umieścił w porównaniu — łącznie z produktami dostępnymi tylko dla innych organizacji — w kontekście
kanału sprzedaży klienta. **Ceny są tu standardowymi cenami kanału, a nie cenami negocjowanymi przez
klienta**: porównanie pokazuje ceny dla osoby, która je ogląda, a administrator nie ma organizacji
kupującej, dla której można by je wyznaczyć. Ekran mówi o tym wprost, aby ceny podawane klientowi nie
były mylone z tym, co klient widział. W widoku administratora celowo nie ma przycisków edycji,
usunięcia ani udostępnienia (to podgląd do celów kontrolnych, a nie narzędzie do zmiany danych
klienta).

Gdy klient usunie porównanie w storefroncie, wiersz znika z listy w panelu po następnym odświeżeniu.

## Co konfiguruje administrator

| Gdzie | Co |
| --- | --- |
| **Catalog → Attributes**, pole `Comparable` | Wybór atrybutów, które są wierszami na stronie porównania. Niezależne od `Searchable` / `Filterable`. |
| **Settings → Compare**, ustawienie `compare.max_products` | Limit liczby produktów w jednym porównaniu, osobno dla każdego kanału. |

## Po co to jest

W zakupach B2B kupujący rzadko decyduje sam — swoje zdanie mają inżynierowie, dział finansów i
kierownicy. Sednem tej funkcji jest jednorazowe przygotowanie porównania, udostępnienie linku i
eksport do PDF do archiwum. Widok w panelu istnieje po to, aby zespół platformy mógł badać zgłoszenia,
w których klienci podają udostępniony link.

---

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/comparisons/me` | storefront (anonimowy lub zalogowany klient) | Odczyt porównania wywołującego; `204 No Content`, gdy go nie ma |
| `POST /api/v1/comparisons/me/products` | storefront | Dodanie produktu (przy pierwszym wywołaniu tworzy porównanie i ciasteczko `compare_token`); ponad limit kanału odrzucane z `409 COMPARISON_FULL` |
| `DELETE /api/v1/comparisons/me/products/:productId` | storefront | Usunięcie produktu; `404 PRODUCT_NOT_IN_COMPARISON`, gdy go nie ma |
| `PATCH /api/v1/comparisons/me` | storefront | Zmiana zapisanego widoku (`all` / `common` / `differences`) |
| `DELETE /api/v1/comparisons/me` | storefront | Trwałe usunięcie porównania; token udostępnienia przestaje działać dla wszystkich |
| `GET /api/v1/comparisons/me/pdf` | storefront (tylko właściciel) | Eksport do PDF dla właściciela; PDF odzwierciedla aktywny widok i zawiera główne zdjęcia produktów; `409 COMPARISON_EMPTY` dla porównania bez produktów |
| `GET /api/v1/comparisons/share/:token` | publiczny, bez uwierzytelniania | Widok dla odbiorcy; ta sama postać co odczyt właściciela, bez `maxProducts`, z `meta.viewerIsOwner`; ceny i filtrowanie dla *odbiorcy* (`data.pricedFor`, `data.hiddenProductCount`); `404 COMPARISON_NOT_FOUND` dla usuniętego lub nigdy nieistniejącego tokenu |
| `GET /api/v1/admin/comparisons` | administrator (`comparisons:read`) | Lista wszystkich porównań z filtrami (kanał, rodzaj właściciela, okres) i stronicowaniem kursorowym |
| `GET /api/v1/admin/comparisons/:id` | administrator (`comparisons:read`) | Szczegóły tylko do odczytu; pokazywane w kontekście kanału sprzedaży zapisanego w porównaniu, aby widok odpowiadał temu, co zgłosił klient |

Moduł porównań **nie** pośredniczy w obsłudze koszyka. Przycisk *Add to cart* na stronie porównania
w storefroncie wywołuje bezpośrednio istniejące `POST /api/v1/cart/items`.

## Ustawienia

Jedno ustawienie w grupie `compare`, rejestrowane przez `packages/modules/comparisons/src/manifest.ts`:

| Kod | Typ | Wartość domyślna | Przeznaczenie |
| --- | --- | --- | --- |
| `compare.max_products` | `number` | `4` | Największa liczba produktów w jednym porównaniu; storefront odrzuca dodanie produktu ponad limit kanału. Rozsądny zakres to `1..16`. |

Limit jest odczytywany w trakcie żądania w `ComparisonService.addProduct(...)`. Obniżenie limitu w
trakcie sesji **nie** przycina wstecznie istniejących porównań; nową wartość uwzględni dopiero
następne dodanie produktu.

## Flaga w katalogu

Moduł korzysta z kolumny logicznej `is_comparable` w `product_attributes`. Właścicielem kolumny jest
katalog (migracja modułu catalog
`20260501T185835_catalog_product_attribute_is_comparable.ts`); moduł porównań odczytuje ją przez
`CatalogQueryService.comparableAttributeKeys()`.

`<AttributesManager>` w części panelu należącej do katalogu ma pole `Comparable` obok `Searchable` i
`Filterable`; jego zmiana nie ma skutków ubocznych (nie emituje zdarzeń ani nie wywołuje ponownego
indeksowania) — następne wyświetlenie strony porównania odczytuje zmianę bezpośrednio z Postgresa.

## Przechowywanie

Dwie tabele, obie należące do modułu porównań (`20260501T185834_comparisons_init.ts`):

- `comparisons` — klucz główny, 22-znakowy `share_token` w base64url (`UNIQUE`), wzajemnie
  wykluczające się kolumny właściciela (`customer_account_id` *albo* `anonymous_token`; ograniczenie
  CHECK w bazie wymusza XOR), `sales_channel_id` (klucz obcy z `ON DELETE RESTRICT`), `display_mode`,
  `created_at`, `updated_at`. Indeksy częściowe na każdej kolumnie właściciela; osobny indeks na
  `(sales_channel_id, created_at desc)` obsługuje filtr kanału w przeglądzie w panelu.
- `comparison_products` — złożony klucz główny `(comparison_id, product_id)`, `position` (smallint),
  `added_at`. Oba klucze obce są usuwane kaskadowo. Indeks na `product_id` obsługuje liczenie
  produktów na liście w panelu.

Nie ma usuwania miękkiego. Usunięte porównanie musi dla odbiorców linku dawać jednoznaczny stan „już
nie istnieje” — brak wiersza i `404 COMPARISON_NOT_FOUND` wystarczą, bez dodatkowej flagi.

## Klient anonimowy → zalogowany

Anonimowi klienci mają ciasteczko `compare_token` (HttpOnly, SameSite=Lax, Path=/, Max-Age = 1 rok).
Przy logowaniu istniejący hook `onLogin` w `organizationsModule` odczytuje to ciasteczko i wywołuje
`ComparisonService.adoptAnonymousComparison(...)`:

- Klient bez porównania → porównanie anonimowe zostaje do niego przypisane (ustawiane jest
  `customer_account_id`, a `anonymous_token` czyszczone).
- Klient, który ma już porównanie → porównanie anonimowe jest trwale usuwane; wygrywa zestaw wybrany
  wcześniej przez klienta.

## Eksport do PDF

PDF jest generowany po stronie serwera przez `pdfmake` — jedyną nową zależność modułu w czasie
działania. Definicja dokumentu jest budowana deklaratywnie z `ComparisonOwnerView`; główne zdjęcia
produktów są pobierane wcześniej przez `AssetByteFetcher` (z pamięcią podręczną na czas żądania i
przezroczystym obrazem PNG 1×1 jako wartością zastępczą) i osadzane jako data URI. Orientacja strony
jest pozioma przy co najmniej 3 produktach, a w przeciwnym razie pionowa.

Ścisła zasada `setUrlAccessPolicy` odrzucająca wszystko gwarantuje, że pdfmake nigdy nie otwiera
własnych połączeń sieciowych — każdy obraz trafia do dokumentu przez AssetByteFetcher.

## Izolacja modułu

| Kierunek | Od czego zależymy | W jaki sposób |
| --- | --- | --- |
| Odczyt | Produkty z katalogu i flaga `is_comparable` | `CatalogQueryService.comparableAttributeKeys()` i odczyty encji przez EntityManager |
| Odczyt | `compare.max_products` | `SettingsService.get(...)` — tak samo jak w wyszukiwarce |
| Odczyt | Kontekst kanału sprzedaży (waluta, flaga publiczności) | `getResolvedChannel()` — kanał, który warstwa pośrednia wyznaczania kanału umieściła w zakresie żądania |
| Odczyt | E-mail klienta na liście w panelu | encja `CustomerAccount` — łączenie tylko do odczytu |
| Zapis | Nic poza własnymi dwiema tabelami | — |

Moduł porównań nie ma w czasie kompilacji żadnych zależności od modułu `carts`. Usunięcie modułu
porównań nie wpływa na działanie katalogu, ustawień, kanałów sprzedaży i koszyków — nie zostają
żadne wiszące odwołania.

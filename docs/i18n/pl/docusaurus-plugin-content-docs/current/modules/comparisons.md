---
title: Compare Products
description: 'Compare Products: zestaw kuratorowany przez klienta z trybami wyświetlania, linkiem do udostępnienia i eksportem PDF'
---

# Compare Products

Moduł porównywania produktów po stronie klienta. Posiada first-class
zasób `Comparison` (zestaw produktów kuratorowany przez klienta z wybranym
trybem wyświetlania i stabilnym linkiem do udostępnienia), powierzchnię
obserwowalności admin oraz eksport PDF po stronie Node. Moduł celowo nie
trzyma danych katalogu; konsumuje produkty i flagę atrybutu `is_comparable`
przez port `CatalogQueryService`.

Ta strona jest napisana dla dwóch odbiorców:

- **Kupujących i administratorów platformy**, którzy chcą wiedzieć, *co*
  robi funkcja (sekcje „Co robi kupujący”, „Co widzi administrator”,
  „Co konfiguruje administrator”).
- **Developerów**, którzy muszą rozszerzyć lub operować moduł (każda
  sekcja po „Public surface”).

## Co robi kupujący

### 1. Wybierz produkty do porównania

Na dowolnej liście katalogu lub stronie szczegółów produktu kliknij **Compare**
na karcie produktu. Przycisk przełącza się — kliknij ponownie, żeby usunąć
produkt z zestawu porównania. Pill w nagłówku (**Compare (N)**) pokazuje,
ile produktów masz w kolejce.

Przy pierwszym oznaczeniu produktu storefront otwiera sesję porównania.
Nie musisz być zalogowany.

### 2. Otwórz stronę porównania

Kliknij pill w nagłówku albo przejdź do `/compare`. Zobaczysz tabelę
obok siebie:

- Wiersz nagłówka zawsze pokazuje **nazwę**, **cenę** w walucie sales channel
  oraz **obraz bazowy** każdego produktu.
- Ciało pokazuje każdy porównywalny atrybut, który administrator katalogu
  oznaczył do porównania (waga, materiał, wymiary itd. — zależy od kategorii).

### 3. Przełącz widok

Toolbar nad tabelą ma trzy przyciski:

- **All attributes** — pokazuje wszystko; wiersze identyczne między produktami
  są wyróżnione spokojniejszym stylem, wiersze różniące się wybijają.
- **Common attributes only** — pokazuje tylko wiersze, gdzie każdy produkt
  się zgadza, żeby potwierdzić baseline.
- **Differences only** — pokazuje tylko wiersze, gdzie co najmniej jeden
  produkt się różni, żeby sygnał decyzyjny był czytelny.

Przełączanie jest natychmiastowe — bez przeładowania.

### 4. Udostępnij koledze

Kliknij **Copy share link**. Storefront zapisuje URL postaci
`https://your-store/compare/share/<token>` do schowka. Każdy, kto otworzy
link, widzi to samo porównanie — bez konta i bez możliwości czegokolwiek
zmieniać. Może przełączać tryby lokalnie, ale nie może usuwać produktów,
kasować porównania ani używać *Add to cart*.

Link działa, dopóki porównanie istnieje. Po usunięciu porównania link
przestaje działać dla wszystkich.

**To, co widzi odbiorca, zależy od tego, kim odbiorca jest**, nie od tego,
kto wysłał link. Link udostępnia dostęp do porównania, nigdy do niczego
w środku:

- **Ceny** — zalogowany odbiorca widzi ceny uzgodnione z *jego*
  organizacją, a niezalogowany standardowe ceny sklepu. Twoje ceny
  negocjowane nigdy nie wyciekają przez link, który wysyłasz, a strona
  mówi, czyje ceny pokazuje.
- **Produkty** — jeśli porównanie trzyma produkt ograniczony do twojej
  organizacji, odbiorca spoza niej nie widzi tej kolumny. Strona mówi,
  że coś nie jest dla niego dostępne, zamiast cicho skrócić tabelę.
  Odbiorca, którego organizacja może widzieć produkt, widzi go normalnie.

### 5. Dodaj wybrany produkt do koszyka

Po decyzji kliknij **Add to cart** w kolumnie wybranego produktu. Koszyk
bierze produkt z tymi samymi regułami co ze strony produktu (dostępność
kanału, stock). Samo porównanie zostaje nienaruszone.

### 6. Eksport do PDF

Kliknij **Export to PDF**. Storefront pobiera PDF o nazwie
`comparison-<token>.pdf`, który odzwierciedla to, co na ekranie — te same
produkty, ten sam tryb wyświetlania, ta sama kolejność kolumn. PDF jest
generowany na świeżo za każdym razem; zmiana trybu i ponowny eksport daje
nowy plik z nowym trybem.

PDF trzech lub więcej produktów ląduje w orientacji poziomej; jeden lub
dwa produkty w pionowej.

### 7. Posprzątaj

Po zakończeniu kliknij **Delete comparison**. Zestaw jest czyszczony, a
wysłane linki przestają się rozwiązywać.

## Limity i edge case'y

- **Maksimum produktów na porównanie** — domyślnie **4**. Operator platformy
  może podnieść lub obniżyć per sales channel przez Settings
  (`compare.max_products`). Jedenasty add — albo którykolwiek przekraczający
  cap — jest odrzucany z komunikatem; istniejące porównanie zostaje bez zmian.
- **Usunięcie produktu** — usuwa kolumnę. Pozostałe kolumny przeliczają, które
  wiersze liczą się jako common vs. different.
- **Jeden produkt w zestawie** — strona renderuje się, ale sugeruje dodanie
  co najmniej jednego produktu, żeby porównanie miało sens.
- **Pusty zestaw** — strona zaprasza do dodania produktów z katalogu.
- **Produkt znika z katalogu** — gdy produkt jest wycofany, gdy jest w
  porównaniu, kolumna zostaje, ale jest oznaczona jako niedostępna; *Add to cart*
  jest wyłączone dla tej kolumny.
- **Shared link w innym sales channel** — odbiorcy widzą ceny w walucie własnego
  kanału, a produkt niesprzedawany w ich kanale nadal się pojawia, ale jest
  oznaczony jako niedostępny.
- **Shared link otwarty przez kupującego z innej organizacji** — kolumny są
  ponownie wycenione według własnych umów kupującego, a produkt, którego nie
  ma prawa widzieć, jest pominięty z notą.
- **Atrybuty wielowartościowe** — dwa produkty uznaje się za zgodne na atrybucie
  wielowartościowym (np. lista certyfikatów) tylko gdy pełne zbiory wartości
  się zgadzają.
- **Brakujące wartości** — produkt bez wartości w wierszu renderuje `—`, a wiersz
  liczy się jako różnica.

## Co widzi administrator

Otwórz **Comparisons** w sidebarze admina. Lista pokazuje każde porównanie
zbudowane przez klientów, z emailem klienta (albo *Anonymous* dla
niezalogowanych), sales channel, aktywnym trybem wyświetlania, liczbą produktów
i czasem utworzenia. Filtruj po kanale, rodzaju właściciela lub zakresie czasu;
sort domyślnie najnowsze pierwsze.

Kliknij wiersz, żeby otworzyć widok szczegółów. Zobaczysz każdy produkt i wiersz
atrybutu, który klient włożył do porównania — w tym produkty ograniczone do
innych organizacji — rzutowane przez sales channel klienta. **Ceny tutaj to
standardowe ceny kanału, nie negocjowane klienta**: ceny porównania dla tego,
kto patrzy, a administrator nie ma organizacji kupującej do wyceny. Ekran to
mówi, żeby cytat do klienta nie był mylony z tym, co klient widział. Brak
przycisków edit, delete i share w widoku admin z założenia (read-only audit,
nie narzędzie do zmiany stanu klienta).

Gdy klient usuwa porównanie na storefront, wiersz znika z listy admin przy
następnym odświeżeniu.

## Co konfiguruje administrator

| Where | What |
| --- | --- |
| **Catalog → Attributes**, checkbox `Comparable` | Wybiera, które atrybuty pojawiają się jako wiersze na stronie porównania. Niezależne od `Searchable` / `Filterable`. |
| **Settings → Compare**, setting `compare.max_products` | Cap per kanał na liczbę produktów w jednym porównaniu. |

## Po co to istnieje

W B2B procurement kupujący rzadko decyduje sam — inżynierowie, finanse i
managerowie mają głos. Zbudowanie porównania raz, udostępnienie linku i
eksport PDF do archiwum to sedno funkcji. Widok admin istnieje, żeby zespół
platformy mógł badać tickety support cytujące shared link.

---

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/comparisons/me` | storefront (anonymous or customer) | Odczyt Comparison wołającego; `204 No Content`, gdy brak |
| `POST /api/v1/comparisons/me/products` | storefront | Dodanie produktu (tworzy Comparison + cookie `compare_token` przy pierwszym wołaniu); odmawia z `409 COMPARISON_FULL` ponad cap kanału |
| `DELETE /api/v1/comparisons/me/products/:productId` | storefront | Usunięcie produktu; `404 PRODUCT_NOT_IN_COMPARISON`, gdy brak |
| `PATCH /api/v1/comparisons/me` | storefront | Aktualizacja persystowanego trybu wyświetlania (`all` / `common` / `differences`) |
| `DELETE /api/v1/comparisons/me` | storefront | Hard-delete Comparison; share token przestaje się rozwiązywać dla wszystkich |
| `GET /api/v1/comparisons/me/pdf` | storefront (owner only) | Eksport PDF właściciela; PDF odzwierciedla aktywny tryb i embeduje base image produktów; `409 COMPARISON_EMPTY` dla zero-product comparison |
| `GET /api/v1/comparisons/share/:token` | public, no auth | Widok odbiorcy; ten sam kształt co owner read minus `maxProducts`, plus `meta.viewerIsOwner`; wycenione i filtrowane dla *odbiorcy* (`data.pricedFor`, `data.hiddenProductCount`); `404 COMPARISON_NOT_FOUND` dla skasowanego/nigdy nieistniejącego tokena |
| `GET /api/v1/admin/comparisons` | admin (`comparisons:read`) | Lista każdego Comparison z filtrami (channel, owner kind, time range) i cursor pagination |
| `GET /api/v1/admin/comparisons/:id` | admin (`comparisons:read`) | Read-only detail; renderowane przez zapisany sales channel porównania, żeby widok pasował do tego, co klient zgłosił |

**Nie ma** proxy koszyka po stronie comparisons. Przycisk storefront *Add to cart*
na stronie porównania woła istniejące `POST /api/v1/cart/items`
bezpośrednio.

## Settings

Jeden knob w grupie `compare`, rejestrowany przez
`packages/modules/comparisons/src/manifest.ts`:

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `compare.max_products` | `number` | `4` | Górny bound na jedno Comparison; storefront odmawia dodania (max+1)-szego produktu per kanał. Sensowny zakres `1..16`. |

Bound jest czytany w czasie requestu wewnątrz
`ComparisonService.addProduct(...)`. Obniżenie cap w trakcie sesji **nie**
retroaktywnie przycina istniejących porównań; następny add to pierwszy
request, który widzi nową wartość.

## Catalog flag

Moduł polega na nowej kolumnie boolean `is_comparable` na
`product_attributes`. Catalog posiada kolumnę (migracja `028` pod
`catalog/migrations/`); moduł comparisons czyta ją przez
`CatalogQueryService.comparableAttributeKeys()`.

`<AttributesManager>` w admin UI Catalogu eksponuje checkbox `Comparable`
obok `Searchable` i `Filterable`; przełączenie nie ma efektu ubocznego (brak
event emission, brak reindex) — następny render strony porównania bierze zmianę
bezpośrednio z Postgres.

## Storage

Dwie tabele, obie owned przez moduł comparisons
(`027_comparisons_init.ts`):

- `comparisons` — primary key, 22-znakowy base64url `share_token`
  (`UNIQUE`), exclusive owner column (`customer_account_id` *or*
  `anonymous_token`; DB CHECK egzekwuje XOR), `sales_channel_id` (FK
  z `ON DELETE RESTRICT`), `display_mode`, `created_at`,
  `updated_at`. Partial indexes na każdej kolumnie owner; osobny index
  na `(sales_channel_id, created_at desc)` wspiera filtr kanału w admin overview.
- `comparison_products` — composite PK na
  `(comparison_id, product_id)`, `position` (smallint), `added_at`.
  Oba FK cascade. Reverse index na `product_id` dla agregatu product-count
  w liście admin.

Brak soft-delete. Skasowane porównanie musi rozwiązywać się
do jasnego stanu „już nie istnieje” dla odbiorców shared link — brakujący
wiersz + `404 COMPARISON_NOT_FOUND` już to spełnia bez bitu soft-delete.

## Anonymous → authenticated identity

Anonimowi klienci niosą cookie `compare_token` (HttpOnly,
SameSite=Lax, Path=/, Max-Age = 1 year). Przy logowaniu istniejący hook
`onLogin` w `organizationsModule` wyciąga cookie i woła
`ComparisonService.adoptAnonymousComparison(...)`:

- Klient bez Comparison → anonimowe jest przypisane
  (`customer_account_id` ustawione, `anonymous_token` wyczyszczone).
- Klient z istniejącym Comparison → anonimowe jest hard-
  deleted; kuratorowany zestaw klienta wygrywa.

## PDF export

Generowane server-side przez `pdfmake` — jedyna nowa runtime dependency
modułu. Definicja dokumentu budowana deklaratywnie z `ComparisonOwnerView`; base image produktów są
prefetchowane przez `AssetByteFetcher` (cache per-request,
fallback 1×1 transparent PNG) i embedowane jako data URI. Orientacja strony
to landscape przy product count ≥ 3, portrait w przeciwnym razie.

Strict deny-all `setUrlAccessPolicy` przypina kontrakt, że pdfmake nigdy nie
otwiera własnych socketów sieciowych — każdy obraz trafia do dokumentu przez
AssetByteFetcher.

## Module isolation

| Direction | What we depend on | How |
| --- | --- | --- |
| Reads | Produkty Catalog i flaga `is_comparable` | `CatalogQueryService.comparableAttributeKeys()` + entity reads przez EM |
| Reads | `compare.max_products` | `SettingsService.get(...)` — ten sam kształt co Search |
| Reads | Kontekst sales channel (currency, public flag) | `getResolvedChannel()` — kanał, który middleware resolver włożył w request scope |
| Reads | Email klienta dla listy admin | encja `CustomerAccount` — read-only join |
| Writes | Nic poza własnymi dwiema tabelami | — |

Moduł comparisons ma zero compile-time dependencies na moduł
`carts`. Usunięcie modułu comparisons zostawia catalog,
settings, sales_channels i carts działające — bez dangling references.

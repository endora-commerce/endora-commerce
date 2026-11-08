---
title: Biblioteka zasobów
description: Centralna biblioteka plików z wymiennymi adapterami przechowywania, stałymi adresami plików i stałymi linkami, podmianą pliku w miejscu, usuwaniem miękkim z okresowym czyszczeniem i ochroną przed usunięciem używanych plików
---

# Biblioteka zasobów

Biblioteka zasobów (Assets Library) to warstwa plików cyfrowych platformy. Zapewnia:

- Centralny katalog plików (obrazów, wideo, PDF, dokumentów) wielokrotnie używanych w mediach
  produktów, załącznikach produktów, głównych obrazach kategorii i stronach CMS.
- Drzewo folderów do porządkowania plików.
- Wymienne mechanizmy przechowywania — lokalny system plików, Amazon S3, GCP Cloud Storage —
  konfigurowane w ustawieniach; aktywny jest zawsze dokładnie jeden.
- Widoczność publiczną albo prywatną ustawianą dla każdego pliku.
- Stałe adresy plików i stałe linki wybierane przez operatora, które działają dalej po podmianie
  pliku.
- Podmianę pliku w miejscu, z zachowaniem poprzedniej wersji, którą można przywrócić.
- Ochronę odwołań: plików używanych przez katalog lub CMS nie można usunąć, dopóki wszystkie
  odwołania nie zostaną usunięte.
- Widoczność zależną od czytającego: plik używany tylko przez rekordy, których ktoś nie może
  zobaczyć — prywatne zadanie, projekt, którego nie jest członkiem, szansę sprzedażową spoza jego
  zasięgu — jest przed nim ukryty. Zobacz [Kto widzi które pliki](#who-sees-which-files).
- Okresowe czyszczenie, które trwale usuwa pliki usunięte miękko i podmienione wersje po upływie
  okresu przechowywania.

## Szybki start

1. **Aktywny adapter** — otwórz Settings → Storage i wybierz `local`, `s3` albo `gcs`. Domyślnie
   `local`.
2. **Lokalny system plików** — ustaw `assets.local.base_dir` (domyślnie `var/assets`). Serwer
   tworzy strukturę katalogów przy przesyłaniu pliku. Ustaw `assets.local.public_url_base`, gdy
   backend działa za innym publicznym hostem (np. CDN lub odwrotnym serwerem pośredniczącym); jeśli
   zostawisz to pole puste, każdy adres jest budowany na podstawie publicznego adresu API tego
   wdrożenia.
3. **Amazon S3** — ustaw `assets.s3.bucket`, `assets.s3.region`, `assets.s3.access_key_id` i
   `assets.s3.secret_access_key`. Opcjonalnie: `assets.s3.endpoint` (dla usług zgodnych z S3, jak
   MinIO), `assets.s3.prefix`, `assets.s3.public_base_url` (bazowy adres CDN).
4. **GCP Cloud Storage** — ustaw `assets.gcs.bucket` oraz `assets.gcs.service_account_json` (wklej
   cały JSON) albo skorzystaj z danych uwierzytelniających dostępnych w środowisku. Opcjonalnie:
   `assets.gcs.prefix`, `assets.gcs.public_base_url`.
5. **Test połączenia** — `POST /api/v1/admin/assets/storage/self-check`. Zwraca `{ ok: true }` po
   powodzeniu albo `{ ok: false, reason: ... }` przy błędnej konfiguracji. Stan przechowywania
   pokazuje `GET /api/v1/admin/assets/storage/state`.

Panel otwiera bibliotekę z menu bocznego albo z palety poleceń (⌘K / CTRL+K → „Biblioteka
zasobów”, dla każdego z uprawnieniem `assets.read`). Panel szczegółów pliku zawiera link do
udostępnienia, stały link, **Podmień plik**, poprzednią wersję z przyciskiem **Przywróć poprzednią
wersję** oraz usuwanie. Każda kontrolka zapisu wymaga uprawnienia `assets.write`.

## Ograniczenia przesyłania

Przesyłanie plików kontrolują dwa ustawienia — oba są sprawdzane, zanim jakikolwiek bajt trafi do
aktywnego adaptera:

- `assets.allowed_file_types` — lista rozszerzeń plików albo typów MIME (np.
  `["jpg", "png", "image/jpeg", "application/pdf"]`). Specjalna wartość `["*"]` (domyślna) wyłącza
  to ograniczenie. Wzorce w rodzaju `image/*` pasują do każdego typu MIME z tym przedrostkiem.
  Sprawdzany jest zarówno zadeklarowany typ MIME, jak i typ wykryty na podstawie zawartości pliku
  (file-type); plik jest odrzucany, gdy którykolwiek z nich nie pasuje.
- `assets.max_file_size_mb` — limit rozmiaru w MB (liczba całkowita). `0` (domyślnie) wyłącza limit.
  Limit jest odczytywany przy każdym żądaniu i dotyczy faktycznie odebranych bajtów, więc
  zaostrzony limit działa bez restartu.

Niezależnie od `assets.allowed_file_types` dokumenty, które przeglądarka wykonałaby — HTML, XHTML,
XML (w tym arkusze XSL) i JavaScript — są odrzucane odpowiedzią `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`;
decyduje o tym zarówno zadeklarowany typ MIME, jak i rozszerzenie pliku. SVG jest akceptowany (logo,
ikony) i zawsze zapisywany jako `image/svg+xml`. Każdy inny plik jest zapisywany z typem wykrytym na
podstawie zawartości, jeśli zawartość została rozpoznana, a w przeciwnym razie z typem zadeklarowanym.
Przesyłanie przyjmuje jedną część `file`; druga jest pomijana.

## Które adresy są stałe

| Adres | Stały? |
| --- | --- |
| Adres pliku (`fileUrl` oraz `GET /api/v1/admin/assets/:id/url` dla pliku publicznego): `/assets/file/<id pliku>` w lokalnym systemie plików; w S3 i GCS stały adres obiektu w zasobniku (na `public_base_url`, jeśli jest ustawiony) | Tak — po każdej podmianie, dopóki plik istnieje. `/assets/file/<id pliku>` odpowiada też w każdym mechanizmie przechowywania, przekierowując plik z chmury na jego adres w zasobniku. |
| Stały link `/assets/file/<stały link>` (`permalinkUrl`) | Tak — po każdej podmianie, dopóki stały link nie zostanie zmieniony ani usunięty. |
| Adres osadzenia `…?v=<contentVersion>` (osadzany przez katalog, CMS, feedy i e-maile) | Wskazuje jedną wersję pliku. Po podmianie przekierowuje do bieżącej wersji, więc nadal działa, ale nie jest to adres do udostępniania. |
| Podpisany adres prywatny (`token`, `exp`) | Nie — ważny przez `assets.private_url_ttl_sec` (domyślnie 300 s) i wydawany na nowo przy każdym odczycie. |

Link do udostępnienia w panelu szczegółów to adres stałego linku, jeśli plik go ma, a w przeciwnym
razie stały adres pliku — nigdy wersjonowany adres osadzenia. `contentVersion` to krótki znacznik
pliku, który zmienia się przy każdej zmianie jego zawartości; `AssetsLibraryService.resolveEmbedUrl(id)`
zwraca adres osadzenia dla kodu, który wyświetla plik.

## Jak pliki są serwowane

`GET /assets/file/:assetId` i `GET /assets/file/<stały link>` wysyłają w każdej odpowiedzi
`X-Content-Type-Options: nosniff`. Serwowany plik dostaje `Content-Security-Policy` o wartości
`default-src 'none'; style-src 'unsafe-inline'; sandbox` (pliki PDF dostają tę samą politykę bez
`sandbox`, w którym wbudowane przeglądarki PDF nie działają). Tylko media, które przeglądarka jedynie
wyświetla — obrazy rastrowe, SVG, wideo, audio, PDF i zwykły tekst — są serwowane z
`Content-Disposition: inline`; każdy inny zapisany typ jest serwowany jako `attachment`, niezależnie
od parametrów żądania; `?download=1` prosi o `attachment`. SVG otwarty bezpośrednio nie uruchamia
więc żadnego skryptu, a osadzanie go przez `<img>` działa bez zmian.

Przekierowania i odpowiedzi z błędem (`302`, `403`, `404`, `410`) mają `no-store` i stałą politykę
`sandbox` opisaną wyżej, niezależnie od zapisanego typu.

Trasa rozstrzyga w tej kolejności:

1. Nieznany identyfikator lub nazwa — `404 ASSET_NOT_FOUND`.
2. Plik **prywatny** jest najpierw sprawdzany pod kątem ważnego podpisu. Bez niego odpowiada
   `403 ASSET_ACCESS_DENIED` przez identyfikator — także gdy jest usunięty miękko — i `404` przez
   stały link, bajt w bajt tak samo jak nieużywana nazwa.
3. Plik usunięty miękko — `410 ASSET_GONE`.
4. Plik prywatny z ważnym podpisem jest przesyłany strumieniowo (lokalnie) albo przekierowywany na
   adres zasobnika ważny przez ograniczony czas (S3, GCS), zawsze z `no-store`.
5. Publiczny plik w chmurze jest przekierowywany (`302`, `no-store`) na stały adres w zasobniku — z
   `?v=<bieżąca>`, gdy żądanie zawierało `v`.
6. Publiczny plik lokalny jest przesyłany strumieniowo; zobacz [Pamięć podręczna](#caching).

`ETag` ma postać `"<id pliku>-<contentVersion>"`: zmienia się, gdy zmienia się plik, a nie gdy
zmienia się tylko etykieta lub folder. `If-None-Match` jest porównywany w trybie słabym i przyjmuje
listę albo `*`.

## Widoczność i adresy prywatne

Każdy plik ma `visibility ∈ {public, private}`. Adresy prywatne są ważne krótko
(TTL = `assets.private_url_ttl_sec`, domyślnie 300 s) i są wydawane na nowo przez panel lub
storefront przy każdym odczycie.

Przełączenie pliku na prywatny sprawia, że od następnego żądania platforma nie serwuje go bez
podpisu, ale nie usuwa kopii, które przechowują już przeglądarki, CDN lub inne zewnętrzne pamięci
podręczne.

W adapterze **lokalnego systemu plików** adresy prywatne podpisuje backend kodem HMAC. Klucz
podpisujący pochodzi ze zmiennej środowiskowej `ASSETS_LIBRARY_HMAC_KEY` (wygeneruj go poleceniem
`openssl rand -hex 32`); zmiana klucza unieważnia wszystkie jeszcze ważne adresy prywatne.

W **S3** i **GCS** adresy prywatne podpisuje (V4) SDK dostawcy; backend nie potrzebuje niczego poza
danymi uwierzytelniającymi. `GET /assets/file/:assetId` przekierowuje plik z chmury na jego
rozwiązany adres, ale dla pliku `private` dopiero po tym samym sprawdzeniu tokenu HMAC, któremu
podlega plik lokalny; bez ważnego tokenu odpowiada `403 ASSET_ACCESS_DENIED`. Ekrany panelu pobierają
adresy prywatne z `GET /api/v1/admin/assets/:id/url` i działają bez zmian.

## Kto widzi które pliki {#who-sees-which-files}

Nie wszystkie rekordy, które używają plików z biblioteki, są widoczne dla każdego: prywatne zadanie
albo szkic zadania, zadanie rekordu, którego nie możesz zobaczyć, projekt, którego nie jesteś
członkiem, szansa sprzedażowa organizacji spoza twojego zasięgu. Biblioteka idzie za tymi rekordami,
więc ich pliki nie trafiają do tych, którzy nie mogą ich zobaczyć.

**Widzisz plik, gdy** nie używa go nic, co ukrywa pliki — to plik przesłany, którego nikt jeszcze
nie używa, albo plik używany tylko przez produkty, kategorie, strony CMS, wpisy bloga lub menu —
**albo gdy możesz zobaczyć choć jeden z rekordów, które go używają.** Plik używany przez prywatne
zadanie *i* produkt widzi każdy, kto może otworzyć bibliotekę; tak samo plik używany przez dwa
zadania, z których jedno możesz zobaczyć. O tym, które rekordy możesz zobaczyć, decyduje moduł, do
którego należą, według tej samej reguły co na jego ekranach: Zadania — prywatne zadania, szkice i
rekord, do którego zadanie należy; Projekty — członkostwo; CRM — `crm:read` i zasięg organizacji.

**Pliku, którego nie możesz zobaczyć, dla ciebie nie ma.**

- Nie ma go na liście biblioteki, w jej wyszukiwaniu, w folderach ani w oknie wyboru pliku, które
  otwierają inne ekrany.
- Otwarcie go po identyfikatorze — szczegóły, odnośnik do pobrania, podgląd — i każda czynność na
  nim — zmiana nazwy, przeniesienie, podmiana, przywrócenie poprzedniej wersji, zmiana widoczności,
  ustawienie lub usunięcie stałego linku, usunięcie i przywrócenie — dają dokładnie tę samą
  odpowiedź co plik, który nie istnieje. Przenoszenie wielu plików naraz pomija go, tak jak pomija
  brakujący.
- Dołączenie go do zadania, projektu lub szansy sprzedażowej jest odrzucane jak dla brakującego
  pliku.
- Odmowa ustawienia stałego linku (`409 ASSET_PERMALINK_TAKEN`) nie wskazuje pliku, który ma już tę
  nazwę, jeśli nie możesz go zobaczyć.

**_Używany przez_ pokazuje tylko rekordy, które możesz zobaczyć.** Pozostałe nie są ani
wymieniane, ani liczone, więc dwie osoby mogą zobaczyć dla tego samego pliku różne listy.

**Usunięcie jest nadal odrzucane, dopóki czegokolwiek używa plik**, także rekordów, których nie
możesz zobaczyć: biblioteka liczy każde użycie, bez względu na to, kto pyta. Odmowa wskazuje tylko
rekordy, które możesz zobaczyć, a jej komunikat jest dla wszystkich ten sam.

**Foldery.**

- Liczba plików ze stałym linkiem, którą podaje potwierdzenie usunięcia folderu, obejmuje tylko
  pliki, które widzisz.
- Folder, w którym są tylko pliki, których nie możesz zobaczyć, jest dla ciebie pusty. Jego
  usunięcie przenosi te pliki do folderu nadrzędnego — do *Nieposortowane (root)*, gdy go nie ma —
  i usuwa folder. Nigdy nie trafiają w twoim imieniu do kosza.
- Dotyczy to każdego sposobu usuwania folderu. Przeniesienie zawartości do folderu nadrzędnego
  działa jak dotąd. Usunięcie wszystkiego (`deleteRecursively`) przenosi pliki, które widzisz, do
  kosza, a pozostałe do folderu nadrzędnego, i jest **odrzucane, gdy którykolwiek widoczny dla
  ciebie plik w folderze, na dowolnej głębokości, jest nadal używany** — odmowa podaje identyfikatory
  tych plików, a nic nie zostaje usunięte ani przeniesione.
- Wpis audytu folderu wymienia pliki przeniesione w ten sposób do folderu nadrzędnego
  (`rehomedAssetIds`).

**Administrator platformy** — rola z uprawnieniem `*` — widzi każdy plik, bez względu na to, kto go
używa. Także jemu usunięcie jest odrzucane, dopóki plik jest używany.

**Gdy moduł jest wyłączony.** Jego rekordy zostają, a z nimi użycia plików z biblioteki. Pliki
używane tylko przez rekordy wyłączonego modułu są ukryte przed każdym czytającym bibliotekę poza
administratorem platformy i nikt nie może ich usunąć — także administrator platformy. Po ponownym
włączeniu modułu wracają do wszystkich, którzy widzieli je wcześniej; gdy moduł jest wyłączony, nic
nie jest przenoszone ani zapisywane.

**Trwałe usunięcie takich plików.** Są dwie drogi:

- włącz moduł z powrotem i usuń rekordy lub załączniki, które używają plików; stają się wtedy
  zwykłymi nieużywanymi plikami;
- usuń moduł z wdrożenia — odinstaluj go i usuń jego pakiet albo zbuduj instancję bez niego. Moduł,
  który nie jest częścią wdrożenia, nie zgłasza żadnych użyć, więc jego dawne pliki są traktowane
  jak nieużywane: widoczne i możliwe do usunięcia. Moduł tylko niedostępny na platformie albo
  odinstalowany miękko nadal jest częścią wdrożenia, a jego pliki pozostają ukryte i chronione tak
  jak przy wyłączonym module.

**Co się nie zmienia.**

- Własny adres pliku (`/assets/file/…`) i jego stały link serwują plik dokładnie jak dotąd: o
  dostarczaniu publicznym i prywatnym decyduje widoczność pliku, a nie to, kto może go zobaczyć w
  bibliotece.
- Prace w tle — okresowe czyszczenie, sprawdzanie magazynu — widzą każdy plik.
- Liczby plików usuniętych i oczekujących na sprzątanie na stronie magazynu pozostają sumami dla
  całej biblioteki.

## Podmiana pliku {#replacing-a-file}

`POST /api/v1/admin/assets/:id/replace` (multipart: opcjonalne pole `expectedContentVersion`, a po nim
jedna część `file`; druga część z plikiem jest pomijana) podmienia plik i zachowuje całą resztę —
identyfikator, folder, etykietę, tekst alternatywny, widoczność, wszystkie odwołania do pliku, jego
klucz w magazynie, a więc każdy wydany już adres. Odpowiedzią są zaktualizowane szczegóły pliku z
nowym `contentVersion`. W panelu służy do tego **Podmień plik** w panelu szczegółów, który przed
podmianą pokazuje nazwy obu plików i czas, przez jaki bieżący plik będzie można przywrócić.

- **Tylko ten sam rodzaj.** Nowy plik musi być zapisanego rodzaju — obraz, wideo, PDF albo inny —
  ocenianego po rozpoznanej zawartości, a nie po zadeklarowanym typie: obraz lub PDF liczy się tylko
  wtedy, gdy jego bajty zostały rozpoznane jako obraz lub PDF, a SVG liczy się jako obraz. Niezgodność
  daje `415 ASSET_REPLACE_KIND_MISMATCH` z `details.currentKind` i `details.newKind`. Wideo lub PDF w
  formacie, którego mechanizm rozpoznawania zawartości nie rozpoznaje, daje `newKind: other`, więc nie
  może podmienić pliku `video` ani `pdf`; prześlij go jako nowy plik. Certyfikat pozostaje
  certyfikatem.
- **Nazwa podąża za plikiem.** Plik przyjmuje nazwę, typ i rozmiar nowego pliku; typ MIME nadpisany
  przez administratora jest czyszczony.
- **Obowiązują te same zasady co przy przesyłaniu** — dozwolone typy, odrzucanie dokumentów
  wykonywanych przez przeglądarkę i limit rozmiaru.
- **Starsze wiersze** (zobacz [Wyjątek dla starszych plików](#legacy-escape-hatch)) są odrzucane z
  `409 ASSET_LEGACY_CANNOT_REPLACE`; prześlij je ponownie. Plik usunięty miękko odpowiada `410`.
- **Równoczesne podmiany.** Z dwóch podmian tej samej wersji wygrywa jedna; druga dostaje
  `409 ASSET_REPLACE_CONFLICT`. Wysłanie `expectedContentVersion` sprawia, że podmiana kończy się tak
  samo, gdy plik zmienił się od chwili odczytu. Pole musi poprzedzać część z plikiem; wysłane po niej
  daje odpowiedź `400 VALIDATION_FAILED` i nic nie zostaje podmienione.
- **Limit 5 GiB w S3.** Podmiana pliku w S3 na plik większy niż 5 GiB jest odrzucana kodem `413` z
  limitem 5120 MB — największym obiektem, jaki S3 kopiuje w jednym kroku.
- Używany jest mechanizm przechowywania pliku, niezależnie od tego, który jest teraz aktywny.

Każda podmiana to audytowana komenda `asset.replace`.

## Stałe linki {#permalinks}

Stały link to wybrana przez operatora ścieżka, pod którą plik jest serwowany jako
`/assets/file/<stały link>`, np. `/assets/file/brand/logo.svg` albo
`/assets/file/datasheets/pump-2000.pdf`. Ustawia się go przez
`PUT /api/v1/admin/assets/:id/permalink` (`{ permalink, confirmReuse? }`) i usuwa przez
`DELETE /api/v1/admin/assets/:id/permalink` albo w panelu szczegółów, który sprawdza go podczas
wpisywania i prosi o potwierdzenie przed zmianą lub usunięciem ustawionego stałego linku.

- **Zasady.** Najwyżej 200 znaków spośród `A–Z`, `a–z`, `0–9`, `.`, `_`, `-` i `/`; bez pustej części
  ani części `.` lub `..`; nie może wyglądać jak identyfikator pliku. Odrzucenie to
  `400 ASSET_PERMALINK_INVALID` z `details.code` wskazującym naruszoną zasadę.
- **Unikalny bez względu na wielkość liter** i bez względu na nią dopasowywany przy serwowaniu.
  Nazwa zajęta przez inny plik daje `409 ASSET_PERMALINK_TAKEN`.
- **Pliki prywatne.** Stały link pliku prywatnego bez ważnego podpisu odpowiada `404`, tak samo jak
  nieużywana nazwa, a adres z identyfikatorem odpowiada `403` — zarówno dla pliku aktywnego, jak i
  usuniętego miękko. Plik prywatny usunięty miękko odpowiada `410` tylko na ważny podpis.
- **Zmiana lub usunięcie** działa od razu: stara nazwa odpowiada `404` od następnego żądania.
- **Ponowne użycie nazwy.** Nazwę, która została zmieniona, usunięta albo zwolniona przez trwałe
  usunięcie, można zająć od razu. Jeśli ostatnio należała do **innego** pliku, żądanie odpowiada
  `409 ASSET_PERMALINK_PREVIOUSLY_USED`, dopóki nie zostanie powtórzone z `confirmReuse: true` —
  wydrukowane już linki z tą nazwą otworzą nowy plik — a wpis audytu zapisuje, który plik miał ją
  wcześniej. Plik, który odzyskuje własny dawny stały link, nie potrzebuje potwierdzenia.
- **Usunięcie i trwałe usunięcie.** Plik usunięty miękko zachowuje stały link, który odpowiada `410`;
  panel ostrzega przed usunięciem pliku ze stałym linkiem. Trwałe usunięcie zwalnia link. Ustawienie
  lub usunięcie stałego linku pliku usuniętego miękko daje odpowiedź `410`; najpierw przywróć plik.
- **Usuwanie folderu.** Usunięcie folderu w bibliotece przenosi jego pliki do folderu nadrzędnego,
  więc ich stałe linki nadal działają; potwierdzenie podaje, ile plików w folderze, na dowolnej
  głębokości, ma stały link (`GET /api/v1/admin/assets/folders/:folderId/permalink-count`). Opcja
  API `deleteRecursively` żądania `DELETE /api/v1/admin/assets/folders/:folderId` przenosi natomiast
  pliki folderu do kosza bez potwierdzenia, więc ich stałe linki odpowiadają `410`, dopóki pliki nie
  zostaną przywrócone. Jest odrzucana, dopóki którykolwiek z tych plików jest używany, a pliki,
  których czytający nie może zobaczyć, trafiają zamiast tego do folderu nadrzędnego (zobacz
  [Kto widzi które pliki](#who-sees-which-files)).

Ustawienie i usunięcie stałego linku to audytowane komendy `asset.permalink_set` i
`asset.permalink_remove`. Wyszukiwanie na liście dopasowuje także stałe linki.

## Poprzednia wersja i przywracanie {#previous-version-and-restore}

Podmiana zachowuje zastąpiony plik jako **poprzednią wersję**; przechowywana jest jedna, a kolejna
podmiana odrzuca wcześniejszą. Szczegóły pliku podają ją jako `previousVersion` — nazwa, typ,
rozmiar, wersja zawartości, kiedy i przez kogo plik został podmieniony oraz `restorableUntil` (chwila
podmiany plus okres przechowywania) — albo `null`. Szczegóły podają też `retentionDays`, czyli
obowiązujący okres przechowywania w pełnych dniach, który wymienia potwierdzenie podmiany.

`POST /api/v1/admin/assets/:id/previous-version/restore` (**Przywróć poprzednią wersję** w panelu
szczegółów) zamienia je miejscami: poprzedni plik staje się bieżącym, a bieżący — poprzednią wersją z
nowym okresem przechowywania. Treść żądania wskazuje obie wersje — `expectedContentVersion` i
`expectedPreviousContentVersion` — więc przywrócony zostaje dokładnie plik, który widział
administrator; nieaktualność którejkolwiek daje `409 ASSET_REPLACE_CONFLICT`. Bez poprzedniej wersji
albo po `restorableUntil` odpowiedzią jest `409 ASSET_NO_PREVIOUS_VERSION` (w drugim przypadku z
`details.restorableUntil`). Przywrócony plik zachowuje własną wersję zawartości, więc jego wcześniejszy
ETag i kopie w pamięci podręcznej znów są aktualne. Przywrócenie to audytowana komenda
`asset.restore_previous_version`.

## Pamięć podręczna {#caching}

Co trasa pliku odpowiada w zależności od żądania:

| Żądanie | Odpowiedź | `Cache-Control` |
| --- | --- | --- |
| Publiczny lokalny, bez `v` (adres pliku lub stały link) | `200` / `304` | `public, no-cache` |
| Publiczny lokalny, `v` = bieżąca wersja | `200` / `304` | `public, max-age=31536000, immutable` |
| Publiczny lokalny, `v` ≠ bieżąca wersja | `302` na ten sam adres z bieżącym `v` | `no-store` |
| Publiczny S3 / GCS | `302` na stały adres w zasobniku | `no-store` |
| Prywatny, ważny podpis, lokalny | `200` / `304` | `private, no-store, max-age=0` |
| Prywatny, ważny podpis, S3 / GCS | `302` na adres ważny przez ograniczony czas | `no-store` |
| Odmowy (`403`, `404`, `410`) | — | `no-store` |

- **Aktualność.** Podmiana jest widoczna przy następnym żądaniu adresu pliku lub stałego linku: oba
  są za każdym razem weryfikowane ponownie, a adresy osadzenia wydawane przez platformę zawierają
  nowe `v`.
- Niepodpisane żądanie warunkowe do pliku prywatnego nigdy nie dostaje `304`.
- Roczna odpowiedź `immutable` na `?v=<bieżąca>` jest gwarantowana tylko w miarę możliwości, gdy
  trwa podmiana: żądanie, które trafi w krótkie okno przed zatwierdzeniem podmiany, może zostać
  zapisane w pamięci podręcznej z nowymi bajtami pod starym znacznikiem.
- **Aktualizacja.** Przed tą wersją sam adres pliku był serwowany jako `immutable` na rok. Klient,
  który go wtedy zapisał w pamięci podręcznej, może trzymać swoją kopię do końca tego roku; adresy
  osadzenia są wersjonowane od tej wersji.

### Strony CMS po podmianie {#cms-pages-after-a-replace}

Pamięć podręczna stron CMS przechowuje rozwiązaną stronę, razem z adresami osadzenia, przez maksymalnie
pięć minut i nie jest czyszczona przy zmianie pliku. Strona CMS zapisana w pamięci podręcznej przed
podmianą serwuje więc poprzednie `?v=` przez maksymalnie pięć minut; ten adres przy żądaniu
przekierowuje do bieżącego pliku. Przeglądarka, która ma już w pamięci podręcznej stary adres `?v=` —
był serwowany jako `immutable` — może pokazywać poprzedni obraz, dopóki pamięć podręczna stron CMS się
nie odświeży, a strona nie zostanie przeładowana. Czyszczenie pamięci podręcznej stron CMS przy
zmianie pliku jest śledzone w [zgłoszeniu #363](https://github.com/endora-commerce/endora-commerce/issues/363).

## Magazyn w chmurze {#cloud-storage}

- **Stały klucz.** Klucz obiektu pliku nigdy się nie zmienia; podmiana kopiuje nowy plik na jego
  miejsce po stronie serwera, więc adres w zasobniku też jest stały.
- **Nagłówki obiektów.** Obiekty zapisane przez tę wersję mają `Cache-Control: no-cache` i
  `Content-Disposition` wybrany przez politykę serwowania — SVG i każdy typ, którego przeglądarka nie
  tylko wyświetla, jako `attachment`. Obiekty zapisane wcześniej zachowują swoje nagłówki do pierwszej
  podmiany. Aby ustawić je zbiorczo, zaktualizuj metadane każdego obiektu narzędziami dostawcy (w S3
  kopią obiektu na samego siebie z dyrektywą metadanych ustawioną na zastąpienie; w GCS aktualizacją
  metadanych), podając ponownie jego typ zawartości — a w S3 także ACL, który kopia na samego siebie
  w przeciwnym razie resetuje.
- **Nieaktualne `v`** w adresie zasobnika serwuje bieżący plik; zasobnik nie wersjonuje po parametrze
  zapytania.
- **Pliki prywatne** są serwowane przez API tylko z ważnym podpisem platformy, który przekierowuje na
  adres zasobnika ważny przez ograniczony czas.
- **Obiekty poprzednich wersji i obiekty tymczasowe** mają losowe nazwy i prywatne ACL. **Polityka
  zasobnika nie może dawać publicznego odczytu poza obiektami, które moduł udostępnia publicznie.**
- **Rozmiar.** Plik w S3 może mieć najwyżej 5 GiB; większa podmiana jest odrzucana z komunikatem o
  rozmiarze.

## Obsługa CDN {#operating-a-cdn}

**Przed API** (`assets.local.public_url_base` albo adres API): przekazuj `/assets/file/` razem z
zagnieżdżonymi ścieżkami i parametrami zapytania oraz respektuj `Cache-Control` z serwera źródłowego.
CDN, który nadpisuje aktualność ustaloną przez serwer źródłowy, musi po podmianie wyczyścić sam adres
pliku i stały link.

**Przed zasobnikiem** (`assets.s3.public_base_url`, `assets.gcs.public_base_url`): umieść w kluczu
pamięci podręcznej `v` (i `download`) i nic więcej; przechowuj długo, gdy `v` jest obecne, a w
przeciwnym razie weryfikuj ponownie; nigdy nie usuwaj `v`. Dodaj do odpowiedzi zasobnika
`X-Content-Type-Options: nosniff` i restrykcyjną `Content-Security-Policy`, których zasobnik sam nie
wysyła. CDN, który nadpisuje aktualność, musi po podmianie wyczyścić sam adres.

## Usuwanie miękkie i trwałe

Usuwanie przebiega w dwóch etapach:

1. `DELETE /api/v1/admin/assets/:id` → usunięcie miękkie. Ustawia `deletedAt`; plik znika z list i
   list wyboru, ale można go przywrócić przez `POST /api/v1/admin/assets/:id/restore`, co wyłącza go
   też z czyszczenia. Rekurencyjne usuwanie folderu działa tak samo i jest odrzucane w całości,
   dopóki którykolwiek plik w folderze jest używany. Podawane `purgeAfterAt` to
   `deletedAt` plus bieżący okres przechowywania.
2. [Okresowe czyszczenie](#retention-and-purge) trwale usuwa plik po upływie okresu: usuwa wiersz i
   prosi adapter o usunięcie pliku źródłowego.

## Przechowywanie i trwałe usuwanie {#retention-and-purge}

`assets.soft_delete_retention_days` (domyślnie 30) to okres przechowywania zarówno plików usuniętych
miękko, jak i podmienionych wersji. Ustawienia przyjmują liczbę całkowitą dni od 1 do 3650, a każdą
inną wartość odrzucają z błędem `422 VALIDATION_FAILED`. Wartość zapisana przed wprowadzeniem tej
reguły jest odczytywana tak: `0` albo dowolna wartość od zera do jednego oznacza jeden dzień; wartość
powyżej 3650 oznacza 3650 dni; wartość pusta, nieliczbowa lub ujemna oznacza domyślne 30 dni.

- **Czyszczenie co godzinę.** Zaplanowane zadanie działa co godzinę i w jednym przebiegu obsługuje
  najwyżej 500 plików, zaczynając od najdawniej usuniętych. Każdy przebieg zapisuje jedną linię
  dziennika `assets_library.retention.sweep` z tym, co zrobił — także gdy nic nie było do zrobienia.
- **Co jest usuwane.** Pliki usunięte miękko, gdy od ich usunięcia minął okres przechowywania, oraz
  poprzednie wersje, gdy minął on od ich podmiany.
- **Odczyt w chwili czyszczenia.** Okres jest odczytywany przy każdym przebiegu, więc zmienione
  ustawienie dotyczy też plików już usuniętych, a podawana przez API data trwałego usunięcia podąża
  za nim.
- **Pliki, do których istnieją odwołania, są pomijane** i pozostają usunięte miękko.
- **Nieudane usunięcia są ponawiane.** Gdy backend nie może usunąć pliku (zasób tylko do odczytu,
  unieważnione dane uwierzytelniające, problem z siecią), wiersz zostaje z ustawionym
  `pendingCleanup`, a następny przebieg ponawia próbę; plik, którego już nie ma, liczy się jako
  usunięty. Obiekty w magazynie, których moduł przestał potrzebować — pozostałości nieudanej lub
  przerwanej podmiany — są usuwane po 24 godzinach.
- **Przywrócenie** wyłącza plik z czyszczenia.
- **Aktualizacja.** Przed tą wersją pliki usunięte miękko nie były trwale usuwane. **Pierwsze
  przebiegi po aktualizacji usuwają każdy plik usunięty miękko wcześniej niż okres przechowywania**;
  aby je zachować, wydłuż ustawienie przed aktualizacją.

**Wycofanie** migracji tej wersji zostawia w magazynie obiekty poprzednich wersji i obiekty
tymczasowe, do których nic się nie odwołuje; jeśli mają znaczenie, usuń je ręcznie z zasobnika lub
katalogu. Każdy plik jest dalej serwowany, bo zapisany klucz pliku się nie zmienia.

## Ochrona odwołań {#asset-reference-registry}

Usunięcie miękkie jest odrzucane z `409 ASSET_REFERENCED`, gdy do pliku odwołuje się którekolwiek z
poniższych:

- `gallery_items.asset_id` (galeria produktu)
- `product_attachments.asset_id` (załączniki produktu)
- `products.download_asset_id` (produkty do pobrania)
- `categories.main_image_asset_id` (główny obraz kategorii)
- `cms_pages.body` zawierające węzeł `{ type: "asset_ref", assetId }`

Każdy moduł, który używa plików z biblioteki, zgłasza w ten sam sposób własne rodzaje odwołań —
między innymi Zadania, Projekty, CRM, wpisy bloga i menu. Sprawdzenie liczy **każde** odwołanie, bez
względu na to, kto pyta i jakie ma uprawnienia, także gdy moduł, do którego należy odwołanie, jest
wyłączony. Lista odwołań w tablicy `details` odpowiedzi z błędem — to, co panel pokazuje jako
miejsca użycia — wskazuje tylko rekordy, które pytający może zobaczyć; administratorowi platformy
wymienia wszystkie. Rekurencyjne usuwanie folderu zadaje to samo pytanie naraz o każdy plik w
folderze i odmawia, gdy którykolwiek jest używany.

### Dla programistów: odwołania zależne od czytającego

Moduł zgłasza `AssetReferenceDescriptor` (z `@endora-commerce/contracts`) do rejestru odwołań
biblioteki z haka startowego, który służy tylko do zgłaszania wkładów. O widoczności decydują w nim
dwie rzeczy.

**Przypisanie.** `findReferences(assetIds)` zwraca `AssetReferenceHit[]`: każde odwołanie niesie
`assetId`, na który wskazuje, a deskryptor odpowiada na całą partię identyfikatorów **jednym**
zapytaniem. Deskryptor, który nadal zwraca zwykłe `AssetReference`, kompiluje się i dostaje
poprawną odpowiedź — rejestr pyta go ponownie o każdy plik osobno wszędzie tam, gdzie musi przypisać
partię — ale kosztuje to jedno zapytanie na plik. Biblioteka usuwa `assetId`, zanim odwołanie trafi
do odpowiedzi.

**`readerRestriction`.** Opcjonalna właściwość danych, tylko do odczytu. Gdy jej nie ma, odwołania
deskryptora nigdy nie ukrywają pliku (katalog, CMS, blog, menu). Gdy jest, odwołania zależą od
czytającego, a moduł odpowiada w imieniu **bieżącego wywołującego**:

```ts
interface AssetReferenceReaderRestriction {
  /** Of these record ids, the ones the caller may see. */
  visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Every asset id a record the caller may NOT see points at — the exact complement. */
  assetIdsWithHiddenReferences(): Promise<readonly string[]>;
  /** Every asset id any record of this kind points at; asked while the owner is off. */
  allReferencedAssetIds(): Promise<readonly string[]>;
}
```

- Stosuj regułę, której używają ekrany modułu, a zbiór ukrytych zapisuj odpornie na NULL
  (`(<visible>) is not true`), tak by wiersz, o którym warunek nie rozstrzyga, był ukryty.
- Usługi, których potrzebuje, pobieraj przez funkcje wywoływane przy każdym użyciu, nigdy przy
  starcie, i nie sprawdzaj obecności własnego modułu: o obecności decyduje biblioteka. Gdy moduł
  jest wyłączony, wywoływana jest tylko `allReferencedAssetIds`, więc musi to być zwykłe SQL na
  własnych tabelach modułu, które nie rozwiązuje żadnego portu.
- Biblioteka najpierw klasyfikuje wywołującego. Aktor systemowy i posiadacz `*` widzą każdy plik i
  żaden moduł nie jest pytany; klient, klucz API albo żądanie bez administratora nie widzą żadnego
  rekordu zależnego od czytającego i również nikt nie jest pytany.
- Koszt na żądanie, nie na plik: strona listy pyta każdy deskryptor zależny od czytającego o
  `assetIdsWithHiddenReferences` raz; biblioteka zostawia tych kandydatów, których pokazałyby jej
  własne filtry (folder, wyszukiwanie), a potem pyta `findReferences` każdego deskryptora i
  `visibleEntityIds` każdego modułu raz o nich wszystkich naraz, bo inne odwołanie może jeszcze
  uczynić kandydata widocznym.

**`assetReadPort.visibleToCaller(assetIds)`** odpowiada, które z identyfikatorów bieżący wywołujący
może zobaczyć w bibliotece — brakujący identyfikator, ukryty i niebędący uuid są tak samo nieobecne.
Moduł, który pozwala dołączyć istniejący plik z biblioteki, pyta o to **przed** każdą inną odmową
opisującą plik (jego widoczność, typ), aby ukryty i brakujący plik dostały jedną odpowiedź. Pozostałe
metody portu nie filtrują: służą modułom, które decydują według reguł własnego rekordu.
`assetsLibraryPort.getAsset` zwraca szczegóły z odwołaniami, które wywołujący może zobaczyć.

## Wymienne adaptery przechowywania

Każdy mechanizm przechowywania implementuje interfejs `StorageAdapter` w
`packages/modules/assets_library/src/backend/services/storage/`. Dodanie czwartego mechanizmu (Azure
Blob, Backblaze B2, …) polega na dodaniu nowej klasy implementującej:

```ts
selfCheck(): Promise<{ ok: boolean; reason?: string }>;
newLocator({ assetId, originalFilename }): string;
put({ locator, mimeType, visibility, stream, sizeBytes, cacheControl?, contentDisposition? }): Promise<void>;
resolveUrl({ locator, visibility, ttlSec? }): Promise<{ url; expiresAt }>;
open({ locator }): Promise<NodeJS.ReadableStream>;
delete({ locator }): Promise<void>;
copy({ from, to, visibility, mimeType, cacheControl?, contentDisposition? }): Promise<void>;
setVisibility?({ locator, visibility }): Promise<void>;
```

`copy` to kopia po stronie serwera, którą czytelnik `to` widzi w całości albo wcale; ustawia ona
jawnie ACL obiektu docelowego. Zarejestruj klasę w `AdapterRegistry.build`. Jako wzór posłużą
istniejące `LocalFsStorageAdapter`, `S3StorageAdapter` i `GcsStorageAdapter`.

## Wyjątek dla starszych plików {#legacy-escape-hatch}

Istniejące wcześniej wiersze `assets`, których `storage_url` był adresem niewydanym przez tę
platformę, są przy migracji oznaczane jako `storage_backend = 'legacy'`. Mechanizm odczytu dla
starszych plików zwraca dla plików `public` adres dosłownie — przenosząc go na publiczny adres API,
gdy zapisana wartość jest względna wobec hosta — i odmawia przełączenia ich na `private` (nie możemy
podpisywać adresów, których nie wydaliśmy), co w panelu pojawia się jako
`409 ASSET_LEGACY_LOCATOR_CANNOT_HARDEN`. Trasa pliku przekierowuje starszy plik na zapisany adres, gdy
jest to adres `http(s)`, a w przeciwnym razie odpowiada `404 ASSET_FILE_MISSING`; starszego pliku nie
można podmienić (`409 ASSET_LEGACY_CANNOT_REPLACE`). Aby przenieść taki plik do nowego mechanizmu,
prześlij go ponownie przez aktywny adapter.

Wiersz bez klucza w magazynie — plik wstawiony bezpośrednio do bazy danych, jak osadzone obrazy
`data:` z danych demonstracyjnych — jest traktowany tak samo: podmiana i przywracanie odpowiadają
`409 ASSET_LEGACY_CANNOT_REPLACE`, a szczegóły pliku podają `replaceable: false`, więc panel
szczegółów nie oferuje przycisku **Podmień plik**. Starsze pliki opisane wyżej również podają
`replaceable: false`.

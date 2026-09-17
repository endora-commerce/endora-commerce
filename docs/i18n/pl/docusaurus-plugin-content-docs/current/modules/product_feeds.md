---
title: Product Feeds
description: Feed'y produktowe w kształcie providera per kanał sprzedaży — zaplanowana generacja, tokenizowane URL pull i push SFTP/FTP/HTTP
---

# Product Feeds

Moduł `product_feeds` (feature `067`) zamienia katalog jednego kanału sprzedaży
w **plik feedu w kształcie providera** — dokument XML Google Merchant Center,
katalog Meta, płaski plik marketplace — publikuje go pod **stabilnym,
tokenizowanym URL**, który provider pobiera anonimowo, i regeneruje go według
harmonogramu per feed.

Feed'y opuszczają platformę dwiema drogami. **Pull** to pierwotna i nadal
domyślna: provider pobiera tokenizowany URL albo administrator pobiera plik.
**Push** pojawił się z feature `070` — każdy udany run może też wysłać plik na
serwer partnera przez SFTP, FTP lub HTTP. Obie drogi są niezależne, więc feed
może robić obie.

## Dla operatorów

### Z czego składa się feed

Feed to cztery wybory i nic więcej w momencie tworzenia:

| Choice | Meaning |
| --- | --- |
| **Template** | Które pola niesie plik, w jakiej kolejności i w jakim formacie (XML, CSV, TSV). |
| **Sales channel** | Który katalog feed publikuje. To też scope'uje ceny i linki. |
| **Language** | Które tłumaczenie nazw, opisów i ścieżek kategorii jest zapisywane. |
| **Name** | Jak go rozpoznasz. Publiczny URL pochodzi z feedu, nie z nazwy. |

Wszystko inne — kryteria, harmonogram, prezentacja ceny, cennik, kraj podatku —
ma działający default i jest edytowane później na karcie **Settings** feedu.

### Tworzenie pierwszego feedu

1. Przejdź do **Sales channels → Product feeds** i naciśnij **New feed**.
2. Wybierz szablon **Google Merchant Center**, kanał, na którym sprzedajesz ten
   katalog, i język. Ekran pokazuje pochodne ustawienia (waluta, prezentacja
   ceny) w miarę wyboru.
3. Zapisz, potem naciśnij **Generate now** na stronie feedu.
4. Gdy run się zakończy, karta **Feed link** pokazuje URL. Skopiuj go do
   Merchant Center jako scheduled fetch.

Do pierwszego udanego runu **celowo nie ma URL na ekranie**: link odpowiadający
`404` jest gorszy niż brak linku.

### Pięć dostarczonych szablonów

Nie są równoważne, a różnica widać przed wyborem.

| Template | Format | Granularity | State |
| --- | --- | --- | --- |
| Google Merchant Center | XML (RSS 2.0 + `g:`) | Per variant | **Ready to use** |
| Meta catalogue | XML | Per variant | **Ready to use** |
| Amazon flat file | TSV | Per product | **Starting point** |
| eBay | CSV | Per product | **Starting point** |
| Allegro | CSV | Per product | **Starting point** |

„Ready to use” oznacza, że lista pól jest kompletna dla wymaganego zestawu
providera. „Starting point” oznacza, że szablon niesie tylko tożsamość, cenę,
dostępność, link i obraz — pola, których każdy marketplace potrzebuje — i
oczekuje się, że dodasz atrybuty własne marketplace w edytorze szablonu. Trzy
marketplace'y są szkieletami, bo ta wersja nie ma integracji API z nimi, więc
ich dokładny wymagany zestaw zależy od konta.

Szablonów systemowych nie można edytować. **Duplicate** jeden i edytuj kopię;
oryginał zostaje taki, jak wysłała platforma, a usunięty szablon systemowy
wraca przy następnym starcie.

### Budowanie lub edycja szablonu

**Sales channels → Feed templates → New template** lub **Duplicate**. Edytor to
wizualna lista pól wyjściowych: każdy wiersz to *nazwa wyjściowa ← źródło*, z
opcjonalnym fallbackiem i flagą „required by the provider”.

- **Bindingi są wybierane, nigdy wpisywane.** Picker źródła listuje to, co jest
  w tej instalacji — pola produktu, atrybuty i pola niestandardowe, obrazy,
  ceny, ścieżki kategorii, kategorię providera. Źródło, którego bieżący format
  wyjściowy nie wyrazi, jest pokazane jako disabled **z powodem**, nie ukryte.
- **Zmiana kolejności działa samą klawiaturą.** Złap wiersz `Space`, przesuń
  `↑`/`↓` lub `Alt+↑/↓`, upuść `Space`, anuluj `Escape`. Każdy ruch jest
  ogłaszany. Na urządzeniach dotykowych każdy wiersz ma jawne przyciski ruchu, a
  długie listy oferują **⋮ → Move to position…**.
- **Podgląd ewaluuje draft.** Wybierz przykładowy produkt i zobacz per pole
  wartość, jaką niósłby plik, skąd pochodzi (źródło lub fallback) i czy item
  zostałby wyemitowany czy pominięty. Nic nie zapisuje — ani run, ani wpis audytu.
- **Problemy są pokazywane ciągle**, w pasku nad listą. **Save** nigdy nie jest
  disabled z powodu problemu walidacji; mówi zamiast tego, co jest nie tak.
- Usunięcie pola wymaganego przez providera pyta o potwierdzenie raz, nazywając
  konsekwencję. Ani cicho akceptowane, ani blokowane.

Szablony migrują między instalacjami jako JSON: **Export…** na szablonie,
**Import** na liście szablonów. Dokument nie niesie id, timestampów, tokenów ani
powiązań feedów, więc dwukrotny export niezmienionego szablonu daje pliki
bajt-identyczne. Pole, którego źródło nie istnieje w docelowej instalacji,
importuje się jako **unbound** i jest raportowane; feed na szablonie z unbound
polami fail'uje run, wymieniając każde z nich, zamiast publikować plik z dziurami.

### Zawężenie feedu do części katalogu

Region **Criteria** na karcie Settings to ten sam rule builder co w promocjach i
cennikach. Pusta reguła oznacza „każdy eligible product tego kanału”. Kryterium
kategorii obejmuje całe poddrzewo.

Panel pokazuje **live match count** podczas edycji. Liczba liczona jest z tych
samych cen i tego samego channel scoping, którego użyje następny run — to liczba
itemów, które run rozważy, nie szacunek.

Dwie rzeczy, których reguła nigdy nie zrobi:

- **poszerzy feedu.** Aktywny, nie zarchiwizowany, członek kanału tego feedu i
  widoczny dla anonimowego visitora to floor, którego żadne kryterium nie podniesie.
  „Widoczny dla anonimowego visitora” to cała odpowiedź, nie tylko przełącznik
  `public`: produkt publiczny **ale** zarezerwowany dla nazwanych organizacji
  zostaje poza feedem, bo plik pobiera Google, a link, którego nikt spoza tych
  organizacji nie może otworzyć, reklamuje 404 — i istnienie asortymentu obiecanego
  komuś innemu na wyłączność;
- **cicho dopasuje wszystko.** Kryterium nazywające atrybut, który został usunięty,
  fail'uje run błędem konfiguracji, zamiast cicho dopasować cały katalog.

Gdy reguła nic nie dopasuje, run kończy się jako `empty`, a **wcześniej opublikowany
plik dalej serwuje**. Panel ostrzega przed zapisem, nie po.

### Mapowanie kategorii (Google i Meta)

Obaj providerzy rozumieją własną taksonomię produktów. Platforma dostarcza te
taksonomie (5 595 kategorii Google, 2 967 Meta, każda po angielsku i po polsku),
więc generacja feedu nigdy nie zależy od dotarcia do Google ani Meta.

Otwórz ekran mapowania z command palette (⌘K / CTRL+K → *Feed category mapping*).
Mapuj kategorię sklepu na węzeł providera, a każde potomne dziedziczy, chyba że
ma własne mapowanie; gdy stosuje się kilka przypisanych kategorii, wygrywa
najgłębiej zmapowana, deterministycznie. Pasek coverage pokazuje, ile kategorii
jest zmapowanych, odziedziczonych lub niezmapowanych.

- **Niezmapowana** kategoria to nie błąd: pole jest pomijane, a item nadal
  emitowany, z ostrzeżeniem na run, żebyś mógł go znaleźć.
- Gdy nowsza rewizja taksonomii wchodzi w użycie, a węzeł, który mapowałeś, już
  nie istnieje, mapowanie zostaje i jest oznaczone **stale** — nigdy nie
  przepisywane na guess i nigdy nie usuwane. Ekran listuje stale mappings do
  review. Rewizja wchodzi w użycie dopiero po promocji w
  [Taxonomy updates](#taxonomy-updates); instalacja samej rewizji nic nie zmienia.
- Powyżej 1 000 kategorii sklepu ekran przechodzi z drzewa na stronicowaną płaską
  listę grupowaną po rodzicu, z tymi samymi wierszami i tym samym paskiem coverage.

### Aktualizacje taksonomii

Google i Meta reorganizują listy kategorii raz lub dwa razy w roku. Platforma może
sprawdzić nowszą listę i ją zainstalować — a instalacja **nic nie zmienia**, dopóki
tego nie powiesz.

**Domyślnie wyłączone, a wyłączone to w pełni wspierany stan.** Przy wyłączonym
przełączniku platforma nie robi żadnego requestu wychodzącego: ani scheduled check,
ani manual check, ani probe przy boot. Wiele instalacji celowo działa tak, a
air-gapped musi. Włączenie to jedno ustawienie na ekranie, który nazywa dokładne
adresy kontaktowane przed przełączeniem.

**Włączenie.** *Settings → Taxonomy updates* (`product_feeds_taxonomy`):

| Setting | What it does |
| --- | --- |
| Check for new taxonomy revisions | Master switch. Domyślnie wyłączony. |
| When to check | Cron interpretowany w **UTC**. Domyślnie poniedziałek 04:00. Listy zmieniają się raz lub dwa razy w roku, więc częstsze sprawdzanie nic nie daje. |
| Google / Meta category list (English, Polish) | Cztery adresy do pobrania. Wskaż wewnętrzne mirror lub proxy, jeśli platforma nie może dotrzeć do providerów bezpośrednio — to wspierana odpowiedź za deployment za proxy. Tylko `https`. |
| Category lists kept per provider | Ile rewizji zatrzymać. Lista w użyciu, najnowsza, o której nikt nie zdecydował, i każda lista, na którą wskazuje mapowanie, nigdy nie są usuwane, niezależnie od tej wartości. |

**Co robi check.** Pobiera oba pliki językowe dla providera, sprawdza, czy to
naprawdę lista kategorii, i porównuje z tym, co już masz. Gdy lista jest
rzeczywiście inna, instaluje ją **inactive**: feedy dalej używają listy, której
używały, status żadnego mapowania się nie zmienia, a jedyny widoczny efekt to
nowy wiersz na *Product feeds → Taxonomy updates* (⌘K / CTRL+K → *Taxonomy
updates*). Gdy plik się nie zmienił, nic nie powstaje.

**Czytanie checku.** Ekran listuje każdy check z wynikiem i, gdy coś poszło nie
tak, powodem mówiącym **czyja to strona problemu**:

| Reason | What it means |
| --- | --- |
| `transport` | Ten serwer nie dotarł do providera — zwykle brak internetu wychodzącego albo proxy/firewall. Wskaż adres źródła na proxy lub wewnętrzną kopię. |
| `not_found` | Provider nie publikuje już pliku pod tym adresem. Znajdź aktualny w ich dokumentacji i zaktualizuj ustawienie. To jedyny failure podnoszący powiadomienie — raz na przejście w failure, nie raz na check. |
| `http_status` | Provider odpowiedział błędem. Zwykle tymczasowo po ich stronie; następny check retry'uje. |
| `not_taxonomy` | Adres zwrócił stronę WWW — często login albo komunikat proxy. Otwórz w przeglądarce, żeby zobaczyć, co faktycznie serwuje. |
| `empty` / `truncated` / `too_large` | Pobranie puste, ucięte albo większe niż platforma zaakceptuje. Nic nie zainstalowano. |
| `no_nodes` / `implausible` | Plik pobrany, ale nie odczytano kategorii albo zdecydowanie za mało. Nic nie zainstalowano. |
| `incomplete_languages` | Jeden język pobrany, drugi nie. Lista instaluje się tylko gdy oba są kompletne. |

**We wszystkich tych przypadkach feedy są nietknięte** i dalej używają już
zainstalowanej listy. Failed check nigdy nie fail'uje run generacji, nigdy nie
fail'uje boot i nigdy nie retry'uje w burzy — następny scheduled check to retry,
a *Check now* jest dla niecierpliwych.

**Promocja.** Rewizja wchodzi w użycie dopiero po promocji, a do przycisku promote
dojdziesz tylko przez impact preview. Preview liczone jest z realnych danych i
mówi, co faktycznie musisz wiedzieć: ile mapowań wymagałoby nowej kategorii, ile
znów zaczęłoby działać i — liczba, która ma znaczenie — ile kategorii sklepu
**przestałoby wysyłać kategorię providera w ogóle**, licząc te dziedziczące przez
przodka. Promocja jest audytowana, atomowa i odwracalna: powrót do wcześniejszej
listy to ta sama akcja względem wcześniejszego wiersza.

Request niesie impact pokazany na preview, więc gdy kolega edytuje mapowania,
gdy preview jest otwarte, promocja jest odrzucona, a liczby przeliczane. Nic w
tym mechanizmie nie może zmienić emisji feedu bez przeczytania ekranu i naciśnięcia
przycisku.

### Harmonogram

Na karcie Settings wybierz preset (hourly, every 4 hours, daily, …) albo
**Custom** z 5-polnym cronem i strefą IANA. Custom expression jest echo'owany
prostym językiem („Every 4 hours, at minute 0”), a następne wystąpienie zawsze
pokazane.

- Tick przychodzący, gdy poprzedni run jeszcze trwa, jest **skipped, with a
  reason** — nigdy nie kolejkowany za nim. Skipped ticki są szare na liście runów.
- Admin ostrzega, gdy średni czas runu feedu zbliża się do interwału.
- Wyłączenie feedu zatrzymuje harmonogram i publiczny URL.
- Postgres jest source of truth dla harmonogramów; kolejka to derived index
  odbudowany przy starcie, więc flushed Redis nic nie traci.

### Link i jego rotacja

Publiczny URL zawiera losowy token. Karta **Feed link** pokazuje go w całości,
gdy feed ma live token, z przyciskiem copy, żeby móc go ponownie skopiować przy
każdej rekonfiguracji providera.

Przechowywane są dwie rzeczy: hash tokena — jedyne, z czym porównuje publiczny
endpoint — i sam token szyfrowany at rest pod `SETTINGS_SECRET_ENCRYPTION_KEY` —
ten sam klucz, którego używają sekrety settings i credentials. Zaszyfrowana kopia
czytana jest tylko gdy administrator otwiera feed, nigdy w publicznym requeście.

Każdy posiadający link może czytać plik z cenami. Traktuj go jak credential:
udostępnij providerowi, który go potrzebuje, i rotuj przy wycieku.

- Na deployment **bez `SETTINGS_SECRET_ENCRYPTION_KEY`** i dla linków wydanych
  przed tą wersją platformy karta pokazuje tylko początek tokena. Rotuj, żeby
  dostać kopiowalny.
- **Rotate** wydaje nowy URL i unieważnia stary **natychmiast**, bez grace period.
  Provider nadal na starym URL przestaje dostawać aktualizacje, dopóki nie wkleisz
  nowego.
- **Revoke** zostawia feed bez publicznego URL i usuwa przechowywaną kopię tokena
  wraz z hashem. Pobranie przez administratora dalej działa.
- URL serwuje `Cache-Control: private` i wspiera `If-None-Match`, więc revalidation
  providera jest tania.
- Endpoint jest rate limited (domyślnie 60 requestów/minutę); providerzy pobierają
  kilka razy dziennie.

Pobranie wygenerowanego pliku w adminie wymaga uprawnienia **Manage product feeds**,
nie tylko **View product feeds** — plik zawiera ceny.

### Czytanie runu

Każda generacja produkuje wiersz run z licznikami: considered, emitted, skipped,
warnings. Otwórz jeden, żeby zobaczyć problemy per item, **grouped by reason**, ze
SKU każdego itemu i CSV exportem pełnej listy.

| Reason | What it means |
| --- | --- |
| `missing_price` | Brak ceny dla waluty feedu i cennika. |
| `missing_image` | Produkt nie ma publicznie osiągalnego obrazu. |
| `private_image_asset` | Obrazy istnieją, ale nie są publiczne, więc nie opublikowano stabilnego URL. |
| `missing_required_field` | Pole wymagane przez providera rozwiązało się pusto bez fallbacku — item pominięty. |
| `missing_translation` | Język feedu nie miał wartości; użyto języka fallback. |
| `unresolvable_link` | Brak skonfigurowanego URL storefront dla kanału. |
| `unmapped_provider_category` | Brak mapowania kategorii; pole pominięte. |
| `stale_provider_category_mapping` | Zmapowany węzeł nie istnieje w zainstalowanej rewizji. |
| `zero_tax_rate_on_gross_feed` | Feed brutto nie znalazł reguły podatku dla kraju podatku. |

Failure to co innego niż problemy itemów: kończą run i nic nie publikują.

| Failure | Meaning |
| --- | --- |
| `channel_unavailable` | Kanał feedu brakuje albo jest wyłączony. Nic nie publikowane — feed nigdy nie poszerza się na cały katalog. |
| `unbound_template_fields` | Szablon ma pola bound to nothing (zwykle po imporcie). |
| `unknown_attribute` | Kryteria nazywają atrybut, który już nie istnieje. |
| `skip_threshold_exceeded` | Ponad połowa considered items została pominięta, więc dobry plik nie zastąpił złego. |
| `storage_unavailable` | Backend storage odrzucił plik. |
| `worker_lost` | Worker umarł w trakcie run; claim zwolniony, partial file usunięty. |

Powiadomienie administratora podnoszone jest, gdy run fail'uje — **raz na
przejście w failure**, nie raz na tick, więc feed zepsuty przez dzień nie zapełnia
dzwonka.

### Uprawnienia

| Code | Grants |
| --- | --- |
| `product_feeds:read` | Podgląd feedów, szablonów, historii runów, issues i mapowań kategorii. |
| `product_feeds:write` | Tworzenie i edycja feedów i szablonów, generacja, rotacja lub revoke linku, mapowanie kategorii, pobieranie wygenerowanych plików. |

Administrator read-only widzi każdy ekran z kontrolkami zapisu **widocznymi, ale
disabled**, każda z wyjaśnieniem — nigdy ukrytymi.

### Settings

W **Settings → Product feeds**:

| Setting | Default | Effect |
| --- | --- | --- |
| Generated files kept per feed | 3 | Starsze pliki usuwane po udanym run; opublikowany zawsze zachowany. |
| Maximum concurrent feed generations | 2 | Per worker process. |
| Skipped-item share that fails a run | 0.5 | Powyżej tej frakcji run fail'uje zamiast publikować. |
| Stale run timeout (minutes) | 30 | Run bez heartbeat przez ten czas traktowany jako lost. |
| Recorded issues per run | 1000 | Cap na zapisane problemy per item; overflow raportowany. |
| Public feed requests per minute | 60 | Rate limit na anonimowy URL. |
| Category-mapping tree limit | 1000 | Powyżej tego ekran mapowania używa stronicowanej płaskiej listy. |

---

### Dostarczanie feedu na serwer partnera

Google i Meta same pobierają link, więc większość feedów nic tu nie potrzebuje.
Marketplace i integracje ERP zwykle chcą odwrotnie: plik wrzucony na serwer, który
poll'ują. To konfiguruje karta **Delivery** feedu.

Feed niesie **co najwyżej jeden** target delivery, a delivery włącza się i wyłącza
niezależnie od targetu — możesz skonfigurować partnera teraz i zacząć wysyłać w
przyszłym tygodniu albo zatrzymać wysyłkę bez utraty ustawień.

| Protocol | What it does | Fields |
| --- | --- | --- |
| **SFTP** | Upload przez SSH. Ten do preferowania. | Host, port, user, password **or** private key, directory |
| **FTP** | Upload przez FTP, prosząc najpierw o FTPS. | Host, port, user, password, directory |
| **HTTP Server / API / GraphQL** | `POST` pliku na URL. | Request URL, headers |

Ostatnie trzy to **jeden mechanizm z trzema nazwami**. Dokumentacja partnera może
nazywać endpoint API albo GraphQL; platforma wysyła ten sam request, a wybór
zmienia tylko etykietę na ekranie.

#### Kiedy następuje delivery

Po run, który **opublikuje się pomyślnie**, i tylko wtedy. Failed run, empty run
albo run skipped, bo poprzedni jeszcze trwał, nic nie wysyła — plik, który partner
już ma, nadal jest aktualny, a ponowne wysłanie ogłosiłoby zmianę, która nie
nastąpiła.

Gdy upload fail'uje, run pozostaje successful, a opublikowany link działa. Delivery
retry'owane jest kilka razy z rosnącym opóźnieniem; gdy nadal fail'uje, zatrzymuje
się i administrator dostaje powiadomienie. Każda próba — udana czy nie — jest na
liście pod kartą, z powodem.

#### Sekrety

Hasła, klucze prywatne i nagłówki, których nazwa mówi, że niosą token (`Authorization`,
`X-Api-Key` i podobne), przechowywane są szyfrowane i **nigdy nie pokazywane
ponownie**. Zapisany sekret wygląda jako `[redacted]`, a pozostawienie go tak
zachowuje go — edycja ścieżki katalogu nie może cicho skasować hasła.

#### Dwa odmowy warte znajomości

- **`http://` jest odrzucane dla protokołów HTTP.** Nagłówek uwierzytelniający
  idzie z requestem, więc adres musi być `https://`.
- **Adresy prywatne i wewnętrzne są odrzucane**, w tym `169.254.169.254` i cokolwiek
  w Twojej sieci. Feed niesie cały katalog z cenami; platforma wyśle go tylko tam,
  gdzie osiągalny z publicznego internetu.

Sam FTP jest plaintext by design. Platforma prosi każdy serwer FTP o TLS i spada
na plain FTP tylko gdy odmówi, ale jeśli partner oferuje SFTP, wybierz SFTP.

#### Test connection

**Test connection** dowodzi, że target jest osiągalny i credentials działają, bez
wysyłania feedu. Na SFTP i FTP zapisuje i natychmiast usuwa jeden mały plik, bo
katalog, do którego nie można pisać, to failure, którego test sam connect
przegapiłby. Rate limited per feed.

## Dla inżynierów

### Shape

```
packages/modules/product_feeds/src/backend/
├── entities/          9 tables, all @GlobalEntity (no tenant column anywhere)
├── services/          selection, resolution, serializers, runs, tokens, taxonomies
├── commands/          feed / template / taxonomy-mapping Commands
├── workers/           generation consumer + stale-run reaper
├── seeds/             the five predefined templates
├── data/taxonomies/   bundled Google + Meta revisions (see PROVENANCE.md)
├── routes.admin.ts    /api/v1/admin/product-feeds
├── routes.templates.ts /api/v1/admin/feed-templates, /feed-previews/*
├── routes.taxonomies.ts /api/v1/admin/feed-taxonomies
└── routes.public.ts   GET /api/v1/public/product-feeds/:token
```

Kontrakty w `packages/contracts/src/product-feeds.ts`; warstwa admin w
`packages/modules/product_feeds/src/admin/`.

### Pipeline generacji

```
selection (ids only, keyset on products.id)
  → hydrate a batch of 500
    → resolve each item (pure)
      → serialize (one chunk per item)
        → artefactStore.put(stream)
→ publish by flipping ONE pointer, after put() resolves
```

Cztery właściwości, za które ten pipeline odpowiada:

- **Nic nie buforuje.** Źródło itemów to async generator, serializery emitują
  jeden chunk per item, adapter storage konsumuje `Readable`, a `em.clear()` działa
  po każdym batchu — w pętli selection i hydration, bo `emFactory()` fork'uje, a
  manager żyjący przez cały run trzyma każdy dotknięty wiersz. Zmierzone przy
  100 000 produktach: 38 MB XML w 205 s ze szczytowym live heap **+18.5 MB** ponad
  baseline, rosnąc ~107 bajtów na dodatkowy item
  (`backend/test/perf/product_feeds/generation-100k.test.ts`, `PERF_RUN=true`).
- **Problem na poziomie itemu nigdy nie abortuje run.** Skipy i ostrzeżenia
  zapisywane per item; tylko failure konfiguracji kończy run.
- **Publikacja to jeden flip pointera po ukończeniu obiektu.** Failed, empty albo
  over-threshold run nigdy nie dotyka `published_artefact_id`.
- **Overlap jest odrzucany, nie kolejkowany.** Claim to warunkowy `UPDATE` na
  `product_feeds.current_run_id`; przegrany zapisuje `skipped(already_running)`.

Pozostały wzrost pamięci powyżej to nie itemy: to lista id członkostwa kanału,
materializowana przed pagingiem (~90 bajtów na produkt w kanale). To O(kanał), nie
O(feed).

### Delivery (feature 070)

Delivery to **efekt uboczny po publikacji**, podpięty na tym samym seam co retention
i powiadomienie o failed run: `deliverArtefact` to opcjonalny port na
`FeedGenerationDeps`, wywoływany na gałęzi publishing i nigdzie indziej. To
placement wymagania — run, który nie opublikował, nie może deliver'ować — i to,
co trzyma failure delivery z dala od run, który już się skończył, zanim upload
został podjęty.

```
run publishes  →  deliverArtefact?(feedId, runId, artefactId)   [port, optional]
                    → enqueue on product_feeds.deliver          (Principle X)
                      → resolve config + secrets
                        → adapter.send(stream, target)          [transport SPI]
                          → record attempt
```

Bez Redis port deliver'uje **inline** zamiast enqueue'ować. Single-process deployment
inaczej pozwoliłby operatorowi skonfigurować target, nie widzieć błędu i nigdy nie
dostać delivery.

Dwie tabele, obie owned by module: `product_feed_deliveries` (jeden wiersz per feed,
wymuszony unique index) i `product_feed_delivery_attempts` (append-only, bounded per
feed).

**Nie ma kolumny secret.** `credential_code` wskazuje konfigurację modułu `credentials`,
który own'uje encryption at rest i masking on read; podział secret/non-secret headers
robi `isSecretDeliveryHeader` w packages contracts, celowo regułą, nie checkboxem
operatora. `credentials` jest więc zależnością *service* w manifeście, nie
FK-driven.

Transport SPI (`services/delivery/delivery-adapter.interface.ts`) bierze `Readable`,
nigdy `Buffer`, z tego samego powodu co serializery — i to overlay seam dla
bespoke protocol partnera. `HttpDeliveryAdapter` reużywa reguły adresów z
`taxonomy-source-url.ts` zamiast je kopiować: dwa SSRF guardy w jednym module to
jeden guard naprawiany i jeden nie.

Nic zapisane na attempt nie jest credential. `target` to redacted display form, a
każda wiadomość failure przechodzi przez `delivery-redaction.ts`, który jest
**value-driven** — dostaje dokładne sekrety w grze i usuwa te stringi, zamiast
zgadywać, jak wygląda hasło.

Test harness wstrzykuje adaptery odmawiające każdego send, z tego samego powodu,
co fetcher taksonomii, który nie może fetch'ować: żaden test w tym repozytorium nie
może upload'ować katalogu z cenami gdziekolwiek.

### Channel scoping (Principle XII)

Członkostwo czytane jest **tylko** przez wstrzyknięty port
`SalesChannelMembershipService.listEntityIdsForChannel`; moduł nigdy nie odpytuje
bridge table `sales_channel_*`. Floor eligibility, reguła operatora i keyset cursor
składane są jako jawny `$and` — nigdy object spread, który cicho drop'uje zduplikowany
klucz `id` i kiedyś całkowicie drop'ował channel scoping dla kryteriów kategorii.

Nie ma gałęzi fail-open: nierozwiązywalny lub nieaktywny kanał podnosi
`ChannelUnavailableError`, a run fail'uje closed.
`backend/test/integration/product_feeds/channel-isolation.test.ts` to regression net,
i ćwiczy też publiczny URL, bo ten endpoint jest nieuwierzytelniony.

### Auditing (Principle XIII)

Każdy zapis operatora to Command: `product_feeds.feed.create|update|delete|duplicate`,
`product_feeds.token.rotate|revoke`, `product_feeds.run.start`,
`product_feeds.template.create|update|duplicate|delete|import`,
`product_feeds.taxonomy_mapping.set`, `product_feeds.taxonomy_revision.promote` i
`product_feeds.taxonomy_check.start`. Każdy zapisuje dokładnie jeden wpis audytu
przypisany do działającego administratora; cały import szablonu to jeden wpis, nie
jeden per pole.

Ostatnie dwa warto czytać razem. Promocja rewizji taksonomii to **jedyny** zapis w
mechanizmie refresh zmieniający emisję feedu, więc to Command; ręczne start check
audytowane jest, bo zapisuje, kto poprosił platformę o request wychodzący, dokładnie
jak `product_feeds.run.start` zapisuje, kto poprosił o generację.

Praca maszynowa — scheduled run, retention sweep, reaper, projekcja harmonogramu do
Redis, instalacja taksonomii i **scheduled taxonomy check wraz z inactive revision,
którą może zainstalować** — **nic nie zapisuje**, a każdy taki zapis niesie marker
`command-coverage-ignore: <reason>`, żeby static checker był uczciwy. Scheduled check
to praca maszynowa właśnie dlatego, że nie może zmienić outputu: wiersz audytu na
tygodniowy check na każdej instalacji zakopałby decyzje operatora w szumie, a tabela
historii checków jest bogatszym zapisem niż wpis audytu. Przypięte przez
`backend/test/integration/product_feeds/command-coverage.test.ts`.

### Taksonomie providerów

Rewizja dociera do bazy dokładnie dwiema drogami, obie produkują ten sam rodzaj
wiersza.

**Bundled z platformą.** Rewizje są na dysku pod
`data/taxonomies/<providerCode>/<revision>/<language>.txt` i instalowane przez boot
reconciler w jednej transakcji per rewizja. Ta ścieżka nie otwiera socketu i nigdy
nie otwierała. Instalacja bieżącego dropu (8 562 węzłów w czterech plikach) trwa
~**2 sekundy**; potem pliki nie są otwierane, bo baza jest pytana pierwsza. Bundled
revision oznaczana current tylko gdy provider nie ma jeszcze current revision — na
świeżej bazie to każda pierwsza instalacja, na długo żyjącej upgrade platformy nie
może cicho zastąpić rewizji wybranej przez operatora.

**Pobrana od providera.** Opcjonalny check, **domyślnie wyłączony**, pobiera
opublikowane pliki providera i instaluje zmienioną rewizję **inactive** (zobacz
[Taxonomy updates](#taxonomy-updates)). Nie może sama stać się rewizją w force.

**Generacja nigdy nie zależy od dotarcia do providera** (FR-077). Run czyta rewizję
w force z Postgres i nikogo nie kontaktuje, więc provider down, wolny albo serwujący
nonsens daje failed *check*, nigdy failed ani zmieniony *run* — a instalacja z
wyłączonym przełącznikiem w ogóle nie robi requestu wychodzącego.

Instalacja bez bundled data boot'uje normalnie: ekran mapowania raportuje brak
taksonomii, a `g:google_product_category` rozwiązuje się jako unmapped, co pomija
pole i nadal emituje item.

Provenance, zmierzone rozmiary i **otwarte pytanie licencyjne** dla bundled vendor
files są w
`packages/modules/product_feeds/src/backend/data/taxonomies/PROVENANCE.md`. Usunięcie
katalogu rewizji providera to cały back-out; bez zmian kodu.

### Kolejki

Dwie powierzchnie BullMQ, rejestrowane tylko gdy `BACKEND_ROLE !== 'api'`:

- `product_feeds.generate` — jeden job per run; worker claim'uje, heartbeat per batch,
  generuje, publikuje, potem egzekwuje retention. Idempotent under redelivery.
- module-wide sweep co 5 minut zwalniający claimy, których heartbeat wygasł, oznaczając
  run `failed(worker_lost)` i usuwając partial object.

Harmonogramy per feed to BullMQ Job Schedulers keyed `feed:<id>`; reconciler przy
staracie upsert'uje każdy enabled scheduled feed i usuwa każdy scheduler `feed:*` bez
live counterpart.

### Storage

Artefakty idą przez adapter storage Assets Library, ale pod własnym prefiksem
locator modułu (`product-feeds/…`), zawsze **private**, i nigdy jako wiersze `Asset`:
to nie media biblioteki, nie mogą pojawić się w asset browser i nie są osiągalne
publicznym URL assetu. Publiczna trasa feedu stream'uje sam obiekt — to sprawia, że
rotacja tokena faktycznie revoke'uje dostęp.

### Testowanie

```bash
pnpm --filter backend exec vitest run test/unit/product_feeds
pnpm --filter backend exec vitest run test/contract/product_feeds
pnpm --filter backend exec vitest run test/integration/product_feeds
PERF_RUN=true pnpm --filter backend exec vitest run test/perf/product_feeds
```

Wspólny test harness celowo wire'uje ten moduł **bez Redis i BullMQ** — uruchamia się
raz per plik testu w jednym fork, a połączenia kolejki wcześniej brały setki plików
na „too many clients”. Testy wołają `productFeeds.generation.generateNow(...)` bezpośrednio.
Harness wskazuje też taxonomy reconciler na nieistniejący katalog, więc tylko
`taxonomy-bundled-data.test.ts` czyta shipped data files.

### Celowo poza zakresem tej wersji

- Delivery e-mail i marketplace-specific APIs (Amazon SP-API, eBay, Allegro). Push
  delivery obejmuje tylko SFTP, FTP i HTTP — zobacz **Delivery** powyżej.
- Incremental, supplemental albo delta feeds — każdy run regeneruje cały plik.
- Wiele krajów lub walut w jednym pliku; zduplikuj feed zamiast tego.
- Runtime taxonomy download.

---
title: Lista kontrolna pierwszego wdrożenia produkcyjnego
---

# Lista kontrolna pierwszego wdrożenia produkcyjnego

**Status: otwarta. Żaden punkt z tej listy nie został jeszcze wykonany.** Endora Commerce nie ma
jeszcze wdrożenia produkcyjnego.

## Po co jest ta strona

Dziesiątki decyzji technicznych w tym repozytorium uznano za bezpieczne z jednego powodu: *nie ma
wdrożenia produkcyjnego, więc nic nie może się zepsuć*. Dzięki temu platforma mogła porzucić warstwy
zgodności wstecznej, przebudować historię migracji i zmienić zabezpieczenia uprawnień bez ścieżki
przejścia. Była to słuszna decyzja, ale nigdy nie była darmowa — zaciągnięto ją na konto pierwszego
wdrożenia, które jeszcze się nie odbyło.

Wszystko, na co ta decyzja pozwoliła, a czego kod sam nie załatwi, trafia tutaj: uprawnienie, które
ktoś musi przyznać, ustawienie, które ktoś musi wybrać, dane początkowe, których nie wolno
wczytać, wartość, która po cichu jest błędna, dopóki operator jej nie ustawi. Ta strona jest takim
rejestrem. Napisano ją tak, by mógł ją wykonać ktoś, kto nie uczestniczył w rozmowach, z których
wzięły się te punkty.

**Ta strona nie jest procedurą wdrożenia.** Przygotowanie serwera VPS, rejestr kontenerów, TLS, DNS
i zestaw usług Compose opisuje `deploy/README.md` i należy to zrobić najpierw. Ta strona zaczyna się
tam, gdzie tamta się kończy: usługi działają, schemat bazy jest utworzony (`backend-migrate`), hooki
instalacyjne wszystkich modułów zostały wykonane (`backend-install`), ale nikt jeszcze nie podjął
żadnej decyzji o biznesie, który ma na tym działać.

**Granice zakresu.** Punkt trafia tutaj tylko wtedy, gdy spełnia trzy warunki naraz: musi zostać
wykonany, zanim prawdziwi klienci zaczną składać zamówienia, żadna zmiana w kodzie nie może
rozstrzygnąć go za operatora, a pomyłka jest kosztowna albo niewidoczna. Punkty, które nie spełniły
któregoś warunku, są wymienione na końcu wraz z powodem — lista kontrolna, która po cichu coś
pomija, jest gorsza niż brak listy.

## Jak z niej korzystać

Skopiuj tę stronę dla każdego wdrożenia i zaznaczaj punkty w kopii, a nie tutaj. Każdy punkt
wskazuje **odpowiedzialnego**: *operatora* (decyzja biznesowa w panelu administracyjnym) albo
*inżyniera* (wartość w środowisku albo polecenie na serwerze). Każdy punkt mówi, co zrobić i jak
udowodnić, że zostało zrobione — „ustawiliśmy” to nie dowód, „odczytaliśmy i się zgadza” to dowód.

---

## A. Decyzje utrwalane w buildzie

Te wartości są zamrażane, gdy CI buduje obrazy. Późniejsza zmiana oznacza ponowny build i ponowne
wdrożenie, więc rozstrzygnij je przed buildem wydania — nie po nim.

### A1. Kod kanału sprzedaży we wszystkich trzech miejscach, w których jest zapisany

**Dlaczego.** Kod kanału występuje w trzech różnie nazwanych zmiennych i nic nie sprawdza, czy są
zgodne. Backend przy starcie uzgadnia wiersz wskazany przez `DEFAULT_SALES_CHANNEL_CODE` jako
domyślny kanał systemowy; pakiet storefrontu zawiera `NEXT_PUBLIC_SALES_CHANNEL_CODE`, wpisywane w
czasie budowania obrazu ze zmiennej CI `SALES_CHANNEL_CODE`. Gdy kod w storefroncie wskazuje kanał,
który nie istnieje, żądania storefrontu trafiają do domyślnego kanału systemowego, a treści zależne
od kanału są po cichu pobierane z niewłaściwego kanału.

**Do zrobienia (inżynier).** Uzgodnij z klientem jeden kod. Ustaw go w:

- zmiennych pipeline'u budowania: `SALES_CHANNEL_CODE`, którą build przekazuje do obrazu
  storefrontu jako `NEXT_PUBLIC_SALES_CHANNEL_CODE`. To mapowanie jest zadeklarowane w jednym
  miejscu, w `packages/cli/src/lib/instance-build-inputs.ts`; własny build tego repozytorium,
  `.github/workflows/demo.yml`, odczytuje ją ze zmiennej repozytorium GitHub;
- `deploy/.env` na serwerze VPS: `DEFAULT_SALES_CHANNEL_CODE` (zobacz `deploy/.env.prod.example`);
- jeśli wdrożenie obsługuje więcej niż jedną domenę, w `SALES_CHANNEL_HOST_MAP` jako pary
  `host=channelCode`.

**Weryfikacja.** Po wdrożeniu `GET /api/v1/admin/sales-channels` zwraca kanał, którego `code` jest
równy wartości wpisanej do storefrontu, oznaczony jako domyślny kanał systemowy. Domyślny kanał
systemowy zawsze istnieje dokładnie jeden — jeśli żaden się nie zgadza, storefront rozmawia z
kanałem, którego nikt nie skonfigurował.

### A2. Domyślny język

**Dlaczego.** `NEXT_PUBLIC_DEFAULT_LOCALE` jest wpisywany ze zmiennej CI `DEFAULT_LOCALE`
(zadeklarowanej w `packages/cli/src/lib/instance-build-inputs.ts`; `.github/workflows/demo.yml`
używa `en-US`, gdy nie jest ustawiona). Musi wskazywać wiersz w tabeli `languages`. Migracja
`packages/modules/languages/src/migrations/20260425T161557_languages_currencies_init.ts` tworzy
dokładnie dwa języki — `en-US` (domyślny) i `pl-PL` — bo był to wybór na potrzeby wersji
demonstracyjnej, a nie wybór tego klienta.

**Do zrobienia (inżynier i operator).** Ustaw `DEFAULT_LOCALE` na język klienta. Jeśli domyślnym
językiem klienta nie jest `en-US`, operator musi też przestawić oznaczenie języka domyślnego w
tabeli języków i dodać każdy język, którego nie zawierają dane początkowe.

**Weryfikacja.** Pierwsze wyświetlenie strony w storefroncie jest w oczekiwanym języku bez użycia
przełącznika języka, a ekran Languages pokazuje ten język jako domyślny.

---

## B. Środowisko i sekrety

### B1. Wygeneruj wszystkie sekrety od nowa dla tego wdrożenia

**Dlaczego.** Sekrety backendu są w dwóch przykładowych plikach: `deploy/.env.prod.example`, dla
wdrożenia referencyjnego tego repozytorium, oraz `deploy/.env.example`, który
`endora new instance` umieszcza w szkielecie nowej instancji (`packages/cli/src/new-instance/deploy.ts`).
Żaden z nich nie zawiera użytecznego sekretu, a każdy zawodzi na inny sposób:

- **Sekrety podpisujące i hasła mają wartości zastępcze** (`change-me-hex-32`,
  `change-me-base64-32`, `change-me-strong-password` w pierwszym pliku, `change-me-generate-one` w
  drugim). Nic nie sprawdza ich treści, więc wdrożenie, które je zostawi, uruchamia się i podpisuje
  ciasteczka sesji kluczem, który każdy może przeczytać w tym repozytorium.
- **Cztery wiersze są celowo puste**: `NEWSLETTER_TOKEN_SECRET`, `SETTINGS_SECRET_ENCRYPTION_KEY`,
  `MFA_SECRET_ENCRYPTION_KEY` i `ASSETS_LIBRARY_HMAC_KEY`. Oba klucze szyfrujące to klucze
  AES-256 i po zdekodowaniu z base64 muszą mieć dokładnie 32 bajty, czego nie spełnia żadna wartość
  zastępcza. Pusta wartość to stan, który backend obsługuje i zgłasza; nadal nie jest to gotowa
  konfiguracja.

Niezależnie od reszty start backendu zatrzymują tylko dwie rzeczy: pusty `SESSION_COOKIE_SECRET`
(`backend/src/index.ts`, `backend/src/worker.ts`) i brak publicznego adresu API (B2). Błędny
`MFA_SECRET_ENCRYPTION_KEY` to jedyny sekret, który również przerywa start, i to tylko wtedy, gdy
zainstalowany jest moduł `mfa`.

**Do zrobienia (inżynier).** Wygeneruj każdy sekret poleceniem z tabeli, wpisz go do pliku `.env`
wdrożenia i ustaw na tym pliku `chmod 600`. Używaj `-hex` albo `-base64` dokładnie tak, jak podaje
tabela: oba klucze szyfrujące są dekodowane z base64, więc ciąg szesnastkowy tam nie zadziała (64
znaki szesnastkowe dekodują się do 48 bajtów, a nie 32).

| Zmienna | Polecenie do wygenerowania | Gdy pusta | Gdy błędna lub zastępcza |
| --- | --- | --- | --- |
| `SESSION_COOKIE_SECRET` | `openssl rand -hex 32` | Backend i worker kończą działanie przy starcie z komunikatem `SESSION_COOKIE_SECRET must be set in production`. | Akceptowany jest każdy niepusty ciąg, więc wartość zastępcza działa i podpisuje ciasteczka publicznie znanym kluczem. |
| `NEWSLETTER_TOKEN_SECRET` | `openssl rand -base64 32` | Działa. Linki potwierdzenia i wypisania z newslettera są podpisywane kluczem `SESSION_COOKIE_SECRET` (`packages/platform/src/composition/newsletter-token-secret.ts`), więc zmiana klucza sesji unieważnia każdy link, który wciąż czeka w skrzynce odbiorcy. Ustaw go, aby oba klucze można było zmieniać niezależnie. | Jako klucz podpisujący akceptowany jest każdy niepusty ciąg. |
| `SETTINGS_SECRET_ENCRYPTION_KEY` | `openssl rand -base64 32` (musi dekodować się do 32 bajtów) | Backend startuje i zapisuje w logu `[settings] SETTINGS_SECRET_ENCRYPTION_KEY is not set`. Sekretnych ustawień i sekretnych pól danych uwierzytelniających (np. tokenu API zapisywanego przez moduł) nie da się zapisać ani odczytać, dopóki klucz nie zostanie ustawiony, a backend uruchomiony ponownie. | Nie jest sprawdzany przy starcie. Backend uruchamia się **bez ostrzeżenia**, a potem każdy zapis sekretnego ustawienia kończy się błędem `SETTINGS_SECRET_ENCRYPTION_KEY is misconfigured — it must decode to 32 bytes (got N)`, zgłaszanym przez moduł `credentials`. |
| `MFA_SECRET_ENCRYPTION_KEY` | `openssl rand -base64 32` (musi dekodować się do 32 bajtów) | Moduł `mfa` udostępnia swoje ekrany, ale odrzuca każdą rejestrację drugiego składnika, więc żaden administrator nie włączy 2FA (D4). | Gdy `mfa` jest zainstalowany, backend nie startuje: `MFA_SECRET_ENCRYPTION_KEY must decode to 32 bytes (got N)`. |
| `ASSETS_LIBRARY_HMAC_KEY` | `openssl rand -hex 32` | Backend startuje. Każde żądanie, które podpisuje lub sprawdza link do prywatnego pliku, kończy się błędem `ASSETS_LIBRARY_HMAC_KEY is unset`. | Wartość zaczynająca się od `change-me` — wartość zastępcza ze starszych plików przykładowych — jest odrzucana przy pierwszym linku do prywatnego pliku, tak samo jak brak klucza: `ASSETS_LIBRARY_HMAC_KEY is still the placeholder an env example carried`. Każda inna wartość, która nie jest szesnastkowa, jest używana jako surowe bajty i akceptowana. |
| `MEILI_MASTER_KEY` | `openssl rand -base64 32` | `deploy/compose.prod.yml` uruchamia Meilisearch z `MEILI_ENV: production`, który bez klucza głównego odmawia startu. Backend odczytuje tę samą wartość jako `MEILISEARCH_API_KEY`. | Meilisearch akceptuje każdy klucz o długości co najmniej 16 bajtów, więc wartość zastępcza daje wyszukiwarce publicznie znany klucz. |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` (szesnastkowo, nie base64: wartość trafia bez kodowania do `DATABASE_URL`, gdzie `/` albo `+` psuje adres) | `deploy/compose.prod.yml` przyjmuje wtedy `b2b` (`${POSTGRES_PASSWORD:-b2b}`). | Wartość zastępcza działa i jest publicznie znana. |
| `REVALIDATE_SECRET` | `openssl rand -hex 32` | Zobacz B2. | Zobacz B2. |

**Wygeneruj klucze szyfrujące raz i je zachowaj.** Zastąpienie działającego
`SETTINGS_SECRET_ENCRYPTION_KEY` albo `MFA_SECRET_ENCRYPTION_KEY` niczego nie szyfruje ponownie:
sekretów zapisanych starym kluczem nie da się już odszyfrować. To samo dotyczy `POSTGRES_PASSWORD`:
obraz bazy danych odczytuje go tylko przy pierwszej inicjalizacji wolumenu, więc późniejsza zmiana
wymaga zmiany hasła roli również w PostgreSQL.

**Weryfikacja.** `grep change-me /opt/b2b/.env` niczego nie zwraca, a żaden z wierszy pustych w
przykładzie nie jest już pusty. Oba klucze szyfrujące dekodują się do 32 bajtów:

```bash
grep -E '^(SETTINGS|MFA)_SECRET_ENCRYPTION_KEY=' /opt/b2b/.env | cut -d= -f2- | while read -r key; do printf '%s' "$key" | base64 -d | wc -c; done
```

Polecenie wypisuje dwa razy `32`. Po ponownym uruchomieniu log backendu nie zawiera ostrzeżenia
`SETTINGS_SECRET_ENCRYPTION_KEY is not set`.

### B2. Ustaw `REVALIDATE_SECRET` i zrozum, dlaczego backend bez publicznego adresu API nie startuje

**Dlaczego.** Ani `PUBLIC_API_BASE_URL`, ani `REVALIDATE_SECRET` nie występowały w
`deploy/.env.prod.example` ani w bloku `x-backend-env` w `deploy/compose.prod.yml`, a brak każdej z
nich nie dawał żadnego błędu. Obie sprawy zostały od tego czasu naprawione, każda inaczej:

- `PUBLIC_API_BASE_URL` to adres, na podstawie którego budowany jest każdy adres powiadomień zwrotnych
  bramek płatności (ITN/notification), każdy publiczny adres feedu produktowego i każdy link
  potwierdzenia newslettera. Kiedyś domyślnie przyjmował `http://localhost:3001`, więc platforma
  podawała bramce adres powiadomień nieosiągalny z internetu i żadna płatność nie była
  potwierdzana. `compose.prod.yml` wyprowadza go teraz z `API_DOMAIN`, obok `BACKEND_PUBLIC_URL`, a
  backend **odmawia startu**, gdy `NODE_ENV=production` i żaden z nich nie jest ustawiony
  (`packages/platform/src/kernel/public-api-base-url.ts`, wywoływane na początku `composeApp()`).
  Nie trzeba niczego uzupełniać — ale jeśli backend kończy działanie przy starcie, wskazując tę
  zmienną, to brakuje `API_DOMAIN`.
- `REVALIDATE_SECRET` to wspólny sekret, który backend przekazuje endpointowi storefrontu
  `/api/revalidate` po zapisaniu treści (`packages/modules/catalog/src/backend/index.ts` oraz moduły
  analityczne i marketingowe). Gdy nie jest ustawiony, odświeżanie po cichu nic nie robi, a endpoint
  storefrontu odpowiada 401: zmiany treści nie pojawiają się, dopóki pamięć podręczna sama nie
  wygaśnie. Zmienna jest teraz w `deploy/.env.prod.example` i trafia do **obu** kontenerów —
  backendu i storefrontu — z tą samą wartością, bo inaczej problem się nie zamyka.

**Do zrobienia (inżynier).** Wygeneruj `REVALIDATE_SECRET` (`openssl rand -hex 32`) i wpisz go do
`deploy/.env`. Upewnij się, że `API_DOMAIN` to prawdziwa publiczna domena API.

**Weryfikacja.** `docker compose --env-file .env -f compose.prod.yml config | grep PUBLIC_API_BASE_URL`
pokazuje publiczny adres API, a nie `localhost`. Ekran konfiguracji bramki płatności w panelu
administracyjnym pokazuje adres powiadomień w tej domenie i to ten adres jest zarejestrowany w
portalu operatora płatności. Opublikuj zmianę kategorii i sprawdź, że od razu pojawia się w
storefroncie.

### B3. Skieruj `SMTP_URL` na prawdziwy serwer pocztowy

**Dlaczego.** `SMTP_URL` jest pusty w `deploy/.env.prod.example` i opisany jako opcjonalny: „unset
falls back to a console mailer” (`deploy/compose.prod.yml:52`). Na produkcji oznacza to, że e-maile
weryfikujące konto, zaproszenia, potwierdzenia zamówień i faktury trafiają do logu kontenera i
nigdzie indziej. Nie ma żadnego błędu, a klienci po prostu nic nie dostają.

**Do zrobienia (inżynier).** Ustaw `SMTP_URL` i `SMTP_FROM` na serwer pocztowy klienta i adres
nadawcy, w domenie z SPF i DKIM zgodnymi z tym nadawcą.

**Weryfikacja.** Zarejestruj testowego klienta w produkcyjnym storefroncie i odbierz e-mail
weryfikacyjny w prawdziwej skrzynce. Zrób to, zanim zrobi to pierwszy klient twojego klienta.

---

## C. Baza danych i pierwsze uruchomienie

### C1. Najpierw przećwicz łańcuch migracji na jednorazowej bazie

**Dlaczego.** Historię migracji przebudowano, a zamrożoną mapę nazw wycofano z tego samego powodu —
braku wdrożenia produkcyjnego. Kolejność bloku sprzed `20260801T000000` celowo nie jest korygowana
(`backend/src/db/migration-order.ts`), a cały łańcuch wykonywano dotąd tylko na bazach, które można
było wyrzucić. Pierwsza baza produkcyjna to pierwsza, która musi zachować wiersze.

**Do zrobienia (inżynier).** Dokładnie na tym commicie, który zostanie wdrożony, wykonaj cały
łańcuch na pustej, jednorazowej bazie, a potem uruchom na niej hooki instalacyjne wszystkich
modułów — te same dwa kroki, w tej samej kolejności, które `deploy/compose.prod.yml` wykonuje jako
`backend-migrate` i `backend-install`, zanim uruchomi się API:

```bash
DATABASE_URL=…/b2b_rehearsal pnpm --filter backend run setup
```

`setup` (w `backend/package.json`) to `db:fresh`, a po nim `module:install --all`. Samo `db:fresh`
nie jest próbą wdrożenia: baza, której pierwszą czynnością po migracjach jest start aplikacji,
nigdy nie wykonuje swoich hooków instalacyjnych. Nigdy nie uruchamiaj `db:fresh`, `setup` ani
`db:reset` bez jawnego `DATABASE_URL`: bez tej zmiennej przebudowują własną bazę programisty, a
`db:reset` dodatkowo wczytuje dane demonstracyjne.

**Weryfikacja.** Oba kroki kończą się bez błędu kolejności i bez nieudanego hooka instalacyjnego, a
powstały schemat odpowiada temu, co tworzą kontenery `backend-migrate` i `backend-install` na
serwerze VPS przy wydaniu — każdy z nich kończy się kodem `0`
(`docker compose --env-file .env -f compose.prod.yml ps -a` pokazuje je jako `Exited (0)`).

### C2. Nie wczytuj danych demonstracyjnych

**Dlaczego.** Polecenie danych demonstracyjnych (`endora demo seed`) zapisuje we wskazanej bazie cały
sklep — katalog, organizację, administratora i kupującego. Nie czyści już po drodze tabel
(czyszczenie przeniesiono do `endora demo reset`), więc na produkcji kosztem są wiersze, które nie
należą do klienta, a nie utrata jego danych. Polecenie ma zabezpieczenie produkcyjne —
`ALLOW_DEV_SEED_IN_PRODUCTION` — które `deploy/compose.prod.yml` kiedyś trwale wyłączał w
przygotowanej z góry usłudze `seed`, wymienianej w `deploy/README.md` jako krok wdrożenia. Usługę
od tego czasu usunięto, a dane demonstracyjne wyłączono z procedury wdrożenia: nie da się już ich
wczytać, dopóki operator nie wpisze **obu** nadpisań — `-e ALLOW_DEV_SEED_IN_PRODUCTION=true` oraz
`-e ALLOW_DEV_SEED_ON_NON_LOCAL_DATABASE=true`. Zabezpieczenie
(`packages/platform/src/demo/guard.ts`) zadaje dwa osobne pytania: pierwsze nadpisanie odpowiada na
*„to jest `NODE_ENV=production`”*, drugie na *„baza nie jest ani na pętli zwrotnej, ani nazwana jak
baza testowa”* — a w produkcyjnym zestawie usług nie jest żadną z nich, bo jej hostem jest usługa
`postgres`. Z samym pierwszym nadpisaniem polecenie zatrzyma się na drugim.

To eliminuje przypadkową pomyłkę, ale nie decyzję. Dane demonstracyjne nadal da się wczytać, a ten
krok nadal jest miejscem, w którym operator mówi „nie”.

**Do zrobienia (operator i inżynier).** Nie wczytuj danych demonstracyjnych. Wczytaj prawdziwy
katalog klienta przez moduł importu i eksportu — albo, gdy klient prowadzi katalog w PIM, przez
konektor PIM instalowany dla niego we wdrożeniu. Wdrożenie celowo startuje z pustym katalogiem.

**Weryfikacja.** Nie ma produktów ani organizacji demonstracyjnych, ani konta `platform_admin`,
którego sam nie utworzyłeś. `select count(*) from products` zwraca liczbę wynikającą z importu
klienta.

### C3. Sprawdź, jakie dane platforma utworzyła sama

**Dlaczego.** Część danych słownikowych powstaje bez pytania: uzgadnianie krajów, walut i języków
działa jako hook startowy (`packages/modules/dictionaries/src/backend/index.ts:201`), a domyślny kanał
systemowy jest uzgadniany przy starcie, a nie w migracji. Gdy hook startowy się nie powiedzie, proces
kończy działanie — więc działający backend już dowodzi, że hooki się wykonały. Nie dowodzi natomiast,
że utworzone wartości są właściwe dla tego klienta.

**Do zrobienia (operator).** Otwórz ekran Dictionary i sprawdź, czy kraje, z którymi klient handluje,
są obecne i aktywne, oraz czy domyślna waluta domyślnego kraju jest właściwa.

**Weryfikacja.** Formularz adresu w storefroncie oferuje kraj klienta, a ceny są wyświetlane w
walucie klienta.

---

## D. Tożsamość, role i uprawnienia

### D1. Utwórz pierwszego administratora, a potem ogranicz jego użycie {#d1-utwórz-bootstrap-administratora-potem-go-zawęź}

**Dlaczego.** Jedyna rola, którą platforma kiedykolwiek tworzy za ciebie, to `platform_admin`, z
uprawnieniem wieloznacznym `*`. Wszystkie pozostałe role projektuje klient.

**Do zrobienia (inżynier, potem operator).**

```bash
cd /opt/b2b
export IMAGE_TAG=<deployed-sha>
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  node dist/cli.js admin_users create \
  --email=… --password=… --first-name=… --last-name=…
```

To samo polecenie podaje krok 3 w `deploy/README.md`, z czterema flagami, których wymaga polecenie
`create` modułu `admin_users` (hasło musi mieć co najmniej 12 znaków). Obraz produkcyjny uruchamia
zbudowany kod, więc programem CLI hosta jest `node dist/cli.js` — skrypt pakietu `admin:create` to
jego wersja deweloperska (`tsx src/cli.ts`), a nie coś do uruchamiania na serwerze VPS. Uruchom je,
gdy usługi już działają, aby `backend-install` zdążył wykonać hooki instalacyjne wszystkich modułów.

Następnie w panelu administracyjnym zdefiniuj na `/admin-roles` role, których klient faktycznie
potrzebuje, i przestań używać konta z uprawnieniem wieloznacznym do codziennej pracy.

**Weryfikacja.** `/admin-roles` pokazuje role klienta, a co najmniej jedno konto bez uprawnienia
wieloznacznego potrafi wykonać swoją pracę od początku do końca.

### D2. Przyznaj `customer_groups:read` i `customer_groups:write`

**Dlaczego.** Zarządzanie grupami klientów przeniesiono z `price_lists` do `customer_accounts` i
nadano mu własne kody uprawnień. Wcześniej było chronione przez `catalog:write`, co było wyraźnie
błędne — grupa klientów to podział klientów na segmenty, a nie dane katalogu. Dwa nowe kody to
`customer_groups:read` i `customer_groups:write`
(`packages/modules/customer_accounts/src/manifest.ts:188-189`).

**Nic nie przyznaje ich automatycznie.** Zaproponowano i świadomie odrzucono zabezpieczenie
przejściowe, które akceptowałoby stary `catalog:write` obok nowych kodów: utrzymałoby błędne
uprawnienie dłużej, niż było właściwe, i nie chroniłoby nikogo, bo nie było wdrożenia do ochrony.
Przyznanie uprawnień należy do tej listy. Rola z uprawnieniem wieloznacznym `*` się nie zmienia —
przechodzi przez każde zabezpieczenie.

**Do zrobienia (operator).** Na `/admin-roles`, dla każdej roli innej niż `*`, której użytkownik
musi widzieć grupy klientów albo nimi zarządzać, zaznacz oba uprawnienia (albo jedno, jeśli rola ma
tylko odczytywać). Które role ich potrzebują:

| Rola, której użytkownik… | potrzebuje |
| --- | --- |
| zarządza listą grup klientów (`/customer-groups`) | `customer_groups:read` i `customer_groups:write` |
| edytuje klienta i przypisuje mu grupę — lista wyboru w `packages/modules/customers/src/admin/panels/ManagementPanels.tsx`, która odczytuje `GET /api/v1/admin/customer-groups` | `customer_groups:read` |

Te dwie i żadne inne. Kreator reguł promocji i kreator odbiorców PWA też pokazują listę grup, ale
każdy odczytuje ją przez **własny** endpoint modułu
(`/api/v1/admin/promotions/rule-targets/customer-groups`,
`/api/v1/admin/pwa/rule-targets/customer-groups`), chroniony własnym uprawnieniem odczytu modułu,
więc to przyznanie ich nie dotyczy. Kreator reguł cenników był do niedawna wyjątkiem; teraz odczytuje
listę z uprawnieniem `price_lists:read`, o czym mówi punkt D3.

To samo można zrobić przez API: `PUT /api/v1/admin/admin-roles/<code>` z pełną listą uprawnień
roli, łącznie z nowymi kodami.

**Weryfikacja.** Zaloguj się jako użytkownik każdej zmienionej roli i sprawdź trzy rzeczy: na pasku
bocznym pojawia się pozycja **Customer groups**; `⌘K` → „customer groups” oferuje akcję (paleta
ukrywa akcje, których `requiredPermission` operatorowi brakuje); a `GET /api/v1/admin/customer-groups`
zwraca `200` zamiast `403`. Rola, której świadomie nie przyznałeś uprawnień, nadal dostaje `403` — to
druga połowa dowodu.

### D3. Przyznaj `price_lists:read` i `price_lists:write`

**Dlaczego.** Moduł `price_lists` nie deklarował kiedyś własnych uprawnień: wszystkie 25 jego tras
administracyjnych było chronionych przez `catalog:write`. Rola z `catalog:write`, przyznanym po to,
by ktoś mógł edytować opisy produktów, mogła też tworzyć, edytować i usuwać cenniki — czyli zmieniać,
ile płacą klienci. Nikt nie wybrał takiej granicy; to skutek uboczny brakującej deklaracji. Moduł ma
teraz `price_lists:read` i `price_lists:write` (`packages/modules/price_lists/src/manifest.ts`),
przypisane według tego, co robi każda trasa, a nie hurtowo: odczyt listy, listy produktów, progów,
nadpisań trybu wyświetlania cen i list wyboru celów reguł to `:read`; wszystko, co zapisuje dane, to
`:write`.

Ta sama zmiana zamknęła ostatnie działające zabezpieczenie w starym stylu:
`GET /api/v1/admin/pricing/rule-targets/customer-groups` odpowiadał przy `catalog:write`, więc
redaktor katalogu mógł wyświetlić grupy klientów. Teraz odpowiada przy `price_lists:read`, tak jak
analogiczne endpointy w `promotions` i `pwa`.

**Nic nie przyznaje nowych kodów automatycznie** — i tak jak w D2 zaproponowano i odrzucono
zabezpieczenie przejściowe, które akceptowałoby obok nich `catalog:write`, bo utrzymywałoby błędne
uprawnienie dłużej, niż było właściwe. Rola, która ma tylko `catalog:write`, nie ma więc **żadnego**
dostępu do cen: znika pozycja na pasku bocznym, `/price-lists` zwraca 403, a zakładka **Pricing** w
edytorze produktu pokazuje błąd zamiast powiązanych cenników (odczytuje
`GET /api/v1/admin/products/:productId/price-lists`, które jest teraz trasą `price_lists:read`). Rola
z uprawnieniem wieloznacznym `*` się nie zmienia.

**Do zrobienia (operator).** Na `/admin-roles`, dla każdej roli innej niż `*`, jawnie zdecyduj o
dostępie do cen:

| Rola, której użytkownik… | potrzebuje |
| --- | --- |
| zarządza cennikami, progami, regułami albo nadpisaniami trybu wyświetlania cen (`/price-lists`, `/price-lists/:id`, `/price-lists/display-modes`) | `price_lists:read` i `price_lists:write` |
| musi tylko zobaczyć, skąd bierze się cena — przegląda cenniki albo otwiera zakładkę **Pricing** produktu | `price_lists:read` |
| pracuje na ekranie innego modułu, który oferuje wybór cennika lub waluty — te listy odczytują `GET /api/v1/admin/price-lists-engine` i `GET /api/v1/admin/pricing/rule-targets/currencies` | `price_lists:read`, oprócz własnych uprawnień tamtego modułu |
| edytuje treści katalogu i **nie może** zmieniać cen | żadnego — zostaw `catalog:write` bez zmian |

Ostatni wiersz to sens całej zmiany: od teraz `catalog:write` oznacza treści katalogu i nic więcej.
Przejrzyj każdą istniejącą rolę z tym uprawnieniem i zdecyduj, do którego z dwóch pierwszych wierszy
— jeśli do któregokolwiek — również należy.

To samo można zrobić przez API: `PUT /api/v1/admin/admin-roles/<code>` z pełną listą uprawnień
roli, łącznie z nowymi kodami.

**Weryfikacja.** Zaloguj się jako użytkownik każdej zmienionej roli i sprawdź cztery rzeczy: na pasku
bocznym pojawia się pozycja **Price lists**; `GET /api/v1/admin/price-lists-engine` zwraca `200`
zamiast `403`; rola tylko z `price_lists:read` dostaje `403` z `POST /api/v1/admin/price-lists-engine`,
więc podział na odczyt i zapis naprawdę działa; rola z `catalog:write` bez żadnego kodu dotyczącego
cen dostaje `403` z `GET /api/v1/admin/price-lists-engine` i z
`GET /api/v1/admin/pricing/rule-targets/customer-groups` — ten negatywny przypadek to połowa dowodu,
że granica się przesunęła, a nie tylko poszerzyła.

### D4. Włącz uwierzytelnianie dwuskładnikowe w panelu administracyjnym

**Dlaczego.** Moduł MFA jest domyślnie aktywny, ale każda jego funkcja startuje **wyłączona**:
`mfa.admin.totp_enabled` i `mfa.admin.totp_enforced` mają domyślnie wartość `false`
(`packages/modules/mfa/src/manifest.ts:37-51`). Wdrożenie, w którym nic się nie zmieni, chroni dostęp
administracyjny w publicznej domenie wyłącznie hasłem.

**Do zrobienia (operator i inżynier).** Ustaw `MFA_SECRET_ENCRYPTION_KEY` (B1), potem zezwól na 2FA
dla administratorów, zarejestruj drugi składnik dla każdego administratora i dopiero wtedy wymuś
2FA — wymuszenie przed rejestracją zablokuje wszystkich.

**Weryfikacja.** Drugie logowanie prosi o kod, a konto bez zarejestrowanego drugiego składnika jest
odrzucane po włączeniu wymuszenia.

---

## E. Aktywacja modułów

### E1. Przejdź przez `/platform/modules` i zdecyduj o każdym module

**Dlaczego.** Obecność modułu wynika jednocześnie z dostępności w platformie i z decyzji operatora o
aktywacji — a ta druga oś ma wartość domyślną. Spośród modułów rdzenia 23 deklaruje, że nie można ich
wyłączyć, a pozostałe mają przełącznik aktywacji dla operatora; **każdy z tych przełączników jest
domyślnie włączony.** Nic w świeżej instalacji nie mówi, co ten klient kupił. Moduł pozostawiony
włączony dodaje pozycję na pasku bocznym, akcje palety poleceń, grupę ustawień, endpointy API i
elementy storefrontu, nawet jeśli nikt o niego nie prosił.

**Do zrobienia (operator).** Przejdź raz, razem z klientem, przez `/platform/modules` i wyłącz to,
z czego klient nie korzysta. Wyłączenie niczego nie niszczy i jest odwracalne: nie usuwa danych,
konfiguracji, uprawnień ani schematu. **Nie licz na to, że okno potwierdzenia powie, co kosztuje
wyłączenie** — dziś podaje tylko nazwę modułu
(`admin/src/modules/platform/ModuleActivationControl.tsx:88`). Co przestaje działać po wyłączeniu
modułu, opisuje rejestr skutków wyłączenia budowany przez
`pnpm --filter backend run check:port-dependencies`; poproś inżyniera o odczytanie go dla każdego
modułu, z którego klient na pewno nie będzie korzystał.

**Weryfikacja.** Dla każdego wyłączonego modułu: zniknęła pozycja na pasku bocznym i akcje palety
poleceń, a API odpowiada `503 MODULE_DISABLED`. Dla każdego pozostawionego włączonego ktoś potrafi
powiedzieć, dlaczego.

### E2. Jawnie zdecyduj o modułach marketingowych i analitycznych

**Dlaczego.** `google_analytics`, `google_tag_manager`, `meta_ads` i `linkedin_ads` są domyślnie
aktywne. Każdy ma drugi przełącznik, na poziomie funkcji, wyłączony do czasu konfiguracji, więc nic
jeszcze nie jest wysyłane — ale aktywacja sprawia, że operator widzi ekrany i ustawienia trybu zgody,
a to, czy klient w ogóle chce śledzenia przez podmioty zewnętrzne, jest w UE decyzją o znaczeniu
prawnym.

**Do zrobienia (operator).** Potwierdź dla każdego modułu: potrzebny czy nie. Tam, gdzie jest
potrzebny, przed pierwszym odwiedzającym skonfiguruj identyfikator pomiaru i przełącznik
`require_consent`.

**Weryfikacja.** Gdy moduły odrzucone przez klienta są wyłączone, w źródle strony storefrontu nie ma
żadnego zewnętrznego tagu.

### E3. Osobno zdecyduj o asystencie AI

**Dlaczego.** `prompt_actions` jest domyślnie aktywny, choć sam asystent (`prompt_actions.enabled`)
jest wyłączony i zanim cokolwiek zrobi, potrzebuje danych dostępowych do modelu językowego.
Włączenie oznacza, że polecenia administratorów i dane potrzebne do ich wykonania opuszczają platformę
i trafiają do zewnętrznego dostawcy modelu. To decyzja o przetwarzaniu danych, a nie kwestia
konfiguracji.

**Do zrobienia (operator).** Zdecyduj razem z klientem. Jeśli tak — zarejestruj dane dostępowe do
modelu na `/credentials`, ustaw `prompt_actions.bulk_limit` i przyznaj `prompt_actions:use`
świadomie, a nie przez dziedziczenie.

**Weryfikacja.** Jeśli klient odmówił, w palecie poleceń nie ma trybu poleceń w języku naturalnym.
Jeśli się zgodził, klient zaakceptował dostawcę na piśmie.

---

## F. Konfiguracja biznesowa przed pierwszą transakcją

### F1. Dane sprzedawcy na fakturach i numeracja

**Dlaczego.** Moduł faktur jest domyślnie aktywny, a dane sprzedawcy są puste:
`invoices.seller.tax_id` ma domyślnie wartość `''`, a `invoices.seller.company_data` — `{}`
(`packages/modules/invoices/src/manifest.ts:40-55`). Wzorce numeracji mają domyślnie postać
`FV {seq}/{channel}/{YYYY}`, `PRO …`, `KOR …` — to rozsądny kształt, ale nadal wybór, który musi
potwierdzić księgowy klienta, bo trudno go zmienić, gdy istnieją już wystawione dokumenty.
Prawidłowy NIP jest też warunkiem wysyłki do KSeF, jeśli klient z niego korzysta.

**Do zrobienia (operator).** Przed pierwszą fakturą uzupełnij dane sprzedawcy i potwierdź trzy wzorce
numeracji w Settings → Invoices.

**Weryfikacja.** Wystaw jedną fakturę do testowego zamówienia i przeczytaj PDF: dane sprzedawcy to
prawdziwe dane prawne klienta, a numer odpowiada uzgodnionemu wzorcowi.

### F2. Numeracja zamówień, minimalna wartość zamówienia i odbiorcy potwierdzeń

**Dlaczego.** `orders.business_id.prefix` i `orders.business_id.suffix` mają domyślnie wartość `''`,
`orders.min_order_value` to `0`, a `orders.confirmation_recipients` to `[]`
(`packages/modules/orders/src/manifest.ts`). Ostatnia wartość nie daje żadnego sygnału: przy pustej
liście nikt po stronie klienta nie dostaje informacji o złożonym zamówieniu.

**Do zrobienia (operator).** Przed pierwszym zamówieniem ustaw przedrostek i przyrostek numeru
zamówienia, minimalną wartość zamówienia zgodną z zasadami handlowymi klienta i co najmniej jednego
wewnętrznego odbiorcę potwierdzeń.

**Weryfikacja.** Złóż testowe zamówienie: numer ma uzgodniony przedrostek i przyrostek, a
potwierdzenie trafia do wewnętrznej skrzynki klienta.

### F3. Podatki, metody dostawy i metody płatności

**Dlaczego.** Platforma nie tworzy żadnej stawki podatku i nie konfiguruje dla klienta żadnej metody
dostawy ani płatności: moduły dostawy i płatności tylko uzgadniają po jednym wierszu dla każdego
zainstalowanego adaptera bramki (w swoich `installHook`), co jest wartością zastępczą, a nie decyzją
handlową. Zamówienie można złożyć ze wszystkimi trzema ustawieniami błędnymi i długo nikt tego nie
zauważy.

**Do zrobienia (operator).** Skonfiguruj stawki VAT, które nalicza klient, metody dostawy z
dostępnością w poszczególnych kanałach oraz metody płatności.

**Weryfikacja.** Testowy checkout pokazuje oczekiwany wiersz podatku, oferuje dokładnie te metody
dostawy i płatności, których oczekuje klient, a suma zgadza się z tą, którą wyliczyłby własny system
klienta.

### F4. Przełącz każdą bramkę płatności z trybu testowego na produkcyjny

**Dlaczego.** Moduł bramki płatności instaluje się niezależnie od platformy i zwykle jest
dostarczany z środowiskiem ustawionym na `sandbox` oraz osobnymi danymi dostępowymi dla każdego
środowiska. Działające wdrożenie w trybie testowym nie przyjmuje pieniędzy; wdrożenie, w którym
zapomniano zarejestrować produkcyjny adres powiadomień, przyjmuje pieniądze, ale nigdy nie potwierdza
zamówienia. Klient, który nie przyjmuje płatności online — tylko przelew albo limit kredytowy z
odroczonym terminem — nie ma bramki i pomija ten punkt.

**Do zrobienia (operator i inżynier).** Dla każdej bramki, z której korzysta klient: wprowadź
produkcyjne dane dostępowe, przełącz środowisko na produkcyjne i zarejestruj w portalu operatora
płatności adres powiadomień — zbudowany na podstawie `PUBLIC_API_BASE_URL` (B2). Ścieżkę powiadomień
i każdy endpoint, który operator płatności musi włączyć na życzenie, podaje dokumentacja modułu
bramki.

**Weryfikacja.** Wykonaj jedną prawdziwą transakcję o niskiej wartości dla każdej bramki, od początku
do końca, i sprawdź, że zamówienie przechodzi do stanu opłaconego dzięki powiadomieniu od operatora
płatności — a nie przez ręczną zmianę statusu.

### F5. KSeF, jeśli klient wystawia faktury w Polsce

**Dlaczego.** Endora wysyła faktury do KSeF przez moduł wysyłki do KSeF, dostępny osobno. Jego
integracja jest domyślnie wyłączona i wskazuje środowisko `test` KSeF — to właściwa wartość domyślna,
bo błędnie skonfigurowana wysyłka produkcyjna jest prawnie wiążąca. Przejście na produkcję to więc
świadoma decyzja. Klient, którego dostawca systemu księgowego sam wysyła faktury do KSeF, zamiast
tego ustawia trasowanie KSeF w księdze faktur na `vendor`.

**Do zrobienia (operator).** Przy wysyłce natywnej skonfiguruj moduł KSeF zgodnie z jego
dokumentacją: dane dostępowe, sprawdzenie połączenia w `test`, a potem przełączenie na `prod` z
włączoną integracją. Przy wysyłce przez dostawcę ustaw trasowanie na zakładce Routing księgi faktur.

**Weryfikacja.** Zanim przełączysz środowisko, wyślij jedną fakturę w `test` i sprawdź, że została
przyjęta — albo, przy wysyłce przez dostawcę, sprawdź jedną fakturę z numerem KSeF zapisanym przez
dostawcę.

---

## G. Działania operacyjne, które muszą istnieć od pierwszego dnia

### G1. Kopie zapasowe, łącznie z wolumenem plików

**Dlaczego.** `deploy/README.md` opisuje zadanie cron z `pg_dump` jako *zalecane* i obejmuje ono
tylko Postgresa. Adapter lokalnego systemu plików w bibliotece mediów zapisuje pliki w wolumenie
`backend-assets` (`deploy/compose.prod.yml`), a nic nie tworzy jego kopii. Przywrócona baza bez
plików to katalog z uszkodzonymi obrazami i niedostępnymi PDF-ami faktur.

**Do zrobienia (inżynier).** Skonfiguruj zadanie cron z `pg_dump` zapisujące kopie poza serwerem,
dodaj wolumen plików i — o tym zwykle się zapomina — przed uruchomieniem produkcyjnym raz przywróć
oba w osobnym środowisku testowym.

**Weryfikacja.** Próbne przywrócenie daje działający storefront z obrazami.

### G2. Zbuduj indeks wyszukiwarki po pierwszym wczytaniu katalogu

**Dlaczego.** Indeks wyszukiwarki jest aktualizowany przyrostowo przy zapisach. Danych wczytanych,
zanim indeks istniał, albo ścieżką, która pomija zdarzenia, po prostu w nim nie ma — wyszukiwarka w
storefroncie niczego nie zwraca i nie zgłasza błędu.

**Do zrobienia (inżynier).** Po zakończeniu importu katalogu klienta uruchom ponowne indeksowanie. Na
serwerze VPS:

```bash
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  node dist/cli.js search reindex
```

(to zbudowana wersja tego, co skrypt pakietu `search:reindex` uruchamia w środowisku deweloperskim —
`dist/cli.js` to program hosta, który uruchamia polecenia deklarowane przez moduły w `manifest.ts`;
`--list` wypisuje wszystkie polecenia dostępne w tej instancji). Zobacz `docs/docs/modules/search.md`.

**Weryfikacja.** Wyszukaj produkt, o którym wiesz, że istnieje, i go znajdź; porównaj liczbę
zindeksowanych dokumentów z liczbą produktów.

### G3. Wskaż backendowi, któremu serwerowi pośredniczącemu wolno podawać adres IP klienta

**Dlaczego.** Adres klienta dociera do aplikacji tylko przez `X-Forwarded-For`, a backend ufa temu
nagłówkowi tylko wtedy, gdy pochodzi od serwera, któremu kazano ufać — w przeciwnym razie
`request.ip` dla każdego żądania to adres hosta nginx. Skutki są trzy: limit żądań na adres IP
(1000/min) staje się jednym wspólnym limitem dla całego internetu; adres IP zapisywany w ważnych dla
bezpieczeństwa wpisach audytu — zdarzeniach MFA, logowaniu administratora jako klient, wykonaniach
poleceń asystenta AI — to adres serwera pośredniczącego, a nie osoby, która działała; a klucz limitu
żądań do publicznego feedu produktowego dla nieuwierzytelnionych wywołań przestaje cokolwiek
rozróżniać. Kiedyś było to otwarte pytanie bez odpowiedzi w kodzie; teraz odpowiedzią jest zmienna.

**Do zrobienia (inżynier).** Sprawdź, czy host nginx ustawia `X-Forwarded-For` i `X-Forwarded-Proto`
(szablon w `deploy/nginx.example.conf` już to robi przez `$proxy_add_x_forwarded_for`), a potem
ustaw w `deploy/.env` na serwerze VPS:

```bash
TRUSTED_PROXY_HOPS=1
```

Jeden, bo między internetem a kontenerem backendu stoi dokładnie jeden serwer pośredniczący. Dodaj
po jednym dla każdego kolejnego — CDN przed hostem nginx daje 2 — a jeśli się pomylisz w górę, to na
własne ryzyko: każdy dodatkowy krok to jeden wpis w `X-Forwarded-For`, który mógł napisać sam klient.
Gdy adres serwera pośredniczącego jest stały i znany, zamiast tego można użyć
`TRUSTED_PROXY_ADDRESSES`, które przyjmuje adresy IP, zakresy CIDR albo nazwane zakresy `loopback` /
`linklocal` / `uniquelocal`; ustaw jedną zmienną albo drugą, nigdy obie. Celowo nie ma wartości
„ufaj każdemu serwerowi”, a backend odmawia startu przy wartości, której nie potrafi odczytać,
zamiast przyjąć brak zaufania — cichy powrót do wartości domyślnej to dokładnie ten stan, który ten
punkt ma zakończyć.

**Weryfikacja.** Po ponownym uruchomieniu usług zaloguj się ze znanego adresu zewnętrznego i odczytaj
wpis audytu MFA albo logowania jako klient: zapisany adres musi być twój, a nie serwera
pośredniczącego. Szybki test negatywny to `curl -H 'X-Forwarded-For: 1.2.3.4' https://<API_DOMAIN>/...`
z zewnątrz — przy jednym zaufanym serwerze sfałszowany wpis jest pomijany, a zapisany adres nadal
jest twój, bo nginx dopisuje za nim adres, z którego faktycznie przyszło połączenie.

---

## Świadomie poza tą listą

Każdy z tych punktów rozważono i zostawiono poza listą, z podanym powodem. Gdy powód przestanie
obowiązywać, punkt trafia wyżej.

- **Przygotowanie serwera VPS, DNS, TLS, rejestru i zestawu usług Compose.** Opisuje to
  `deploy/README.md`, a ta strona zakłada, że ta procedura została wykonana. Powielanie jej to prosta
  droga do rozbieżności między obiema stronami.
- **Skoordynowany reset bazy deweloperskiej.** To procedura dla stanowiska programisty. Pierwsza baza
  produkcyjna startuje pusta i wykonuje łańcuch migracji raz; obejmuje to punkt C1.
- **Raport migracji cenników** — raport wskazujący wiersze, które przed uruchomieniem produkcyjnym
  wymagają prawdziwej wartości dla każdej waluty. Dotyczy migracji dawnych cen jednostkowych
  *istniejącego* wdrożenia. Pierwsze wdrożenie nie ma dawnych cen do przeniesienia. Stanie się
  prawdziwym punktem, gdy pierwszy klient zostanie przeniesiony na platformę z innego systemu.
- **Okres przechowywania usuniętych klientów** (`customers.deletion_retention_days`, domyślnie 365) i
  **aktualność informacji o obecności online**. Wartość domyślna jest bezpieczna i przez rok nie ma
  skutków, a ustawienie można zmienić w dowolnej chwili bez konsekwencji dla danych. To temat
  przeglądu RODO, a nie warunek uruchomienia produkcyjnego.
- **Dane dostępowe do integracji modułów, z których klient nie korzysta** — konektory PIM i ERP,
  feedy produktowe, dostawcy newslettera, piksele marketingowe. Są dziesiątki ustawień z pustym
  stringiem jako wartością domyślną; każde z nich nic nie robi, dopóki funkcja modułu nie zostanie
  włączona. Punkt E1 decyduje, które z nich w ogóle istnieją; wypisanie tu każdej pary danych
  dostępowych byłoby zrzutem ustawień, a nie listą kontrolną.
- **Dostrajanie Meilisearch, Redis i Postgresa.** To praca nad wydajnością, a nie poprawnością, a
  minimum opisuje uwaga o rozmiarze pojedynczego serwera VPS w `deploy/README.md`.
- **Zmiana nazwy modułu albo zawieszona blokada cyklu życia.** To procedury na wypadek incydentów, a
  nie kroki uruchomienia; instrukcja jest w
  `docs/docs/operations/runbooks/module-lifecycle-stuck-lock.md`.
- **Integracje specyficzne dla klienta** — połączenie z ERP albo WMS, klucze API, subskrypcje
  webhooków. To prawdziwa praca, ale należy do zakresu projektu, a nie do warunków uruchomienia
  platformy: nic w platformie nie jest błędne, dopóki klient o coś nie poprosi.
- **Wszystko, czego już nie przepuszcza kontrola statyczna.** Jeśli CI może to wykryć, to nie jest
  punkt dla tej listy — właśnie temu służy inwentarz kontroli w repozytorium.

---

## Gdy kończy się okres „bez wdrożenia”

W dniu, w którym pierwsze wdrożenie zacznie przechowywać dane klienta, przestaje obowiązywać zasada
„jeszcze nic nie może się zepsuć”. Od tej chwili zmiana nazwy wykonanej klasy migracji znów wymaga
mapy zmian nazw, zabezpieczenia uprawnień nie można zmienić bez ścieżki przyznania uprawnień, a
zmiana kontraktu wymaga zwykłej dyscypliny wersjonowania. Ta strona jest miejscem, w którym spłacono
koszty tamtych decyzji.

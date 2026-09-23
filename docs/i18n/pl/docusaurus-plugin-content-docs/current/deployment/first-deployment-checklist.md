---
title: Checklist pierwszego wdrożenia produkcyjnego
---

# Checklist pierwszego wdrożenia produkcyjnego

**Status: otwarty. Żaden punkt z tej listy nie został wykonany.** Endora Commerce nie ma
jeszcze wdrożenia produkcyjnego. Decyzja zapisu to
`specs/071-modular-packaging/decisions.md` § D-35.

## Dlaczego ta strona istnieje

Dziesiątki decyzji inżynieryjnych w tym repozytorium uznano za bezpieczne z jednego powodu:
*nie ma wdrożenia produkcyjnego, więc nic nie może się zepsuć*. Ta decyzja (D-35) pozwoliła
platformie porzucić shims kompatybilności, przebudować historię migracji i zmienić bramki
uprawnień bez ścieżki migracji. To była właściwa decyzja i nigdy nie była darmowa — pożyczyła
pod zastaw pierwszego wdrożenia, które jeszcze się nie odbyło.

Wszystko, co D-35 licencjonowało, a czego kod sam nie uniesie, ląduje tutaj: grant, który
ktoś musi nadać, ustawienie, które ktoś musi wybrać, seed, który nie może się uruchomić,
wartość, która jest cicho błędna, dopóki operator jej nie ustawi. Ta strona to ten rejestr.
Jest napisana tak, by wykonał ją ktoś, kto nie brał udziału w rozmowach, które te punkty
wygenerowały.

**Ta strona to nie procedura wdrożenia.** Provisioning VPS, rejestr kontenerów, TLS, DNS i
stack compose są w `deploy/README.md` i powinno się je wykonać najpierw. Ta strona zaczyna
się tam, gdzie tamta się kończy: stack stoi, schema jest nałożona, a nikt jeszcze nie podjął
decyzji o biznesie, który na nim działa.

**Dyscyplina zakresu.** Punkt należy tutaj tylko wtedy, gdy wszystkie trzy warunki są spełnione:
musi nastąpić przed transakcjami prawdziwych klientów, żaden change w kodzie nie może tego
zdecydować za operatora, a pomyłka jest droga albo niewidoczna. Punkty, które nie przeszły
jednego z testów, są wymienione na dole wraz z powodem — checklist, który cicho coś pomija,
jest gorszy niż brak checklisty.

## Jak z niej korzystać

Skopiuj tę stronę na wdrożenie i odhaczaj punkty w kopii, nie tutaj. Każdy punkt nazywa
**właściciela**: *operator* (decyzja biznesowa w Admin UI) albo *inżynier* (wartość w
środowisku albo polecenie na hoście). Każdy punkt mówi, co zrobić i jak udowodnić, że
zostało zrobione — „ustawiliśmy” to nie dowód, „odczytaliśmy z powrotem” to dowód.

---

## A. Decyzje wbudowane w build

Są zamrożone, gdy CI buduje obrazy. Zmiana później oznacza rebuild i redeploy, więc
decyduj przed buildem release — nie po.

### A1. Kod sales channel we wszystkich trzech miejscach, gdzie jest zapisany

**Dlaczego.** Kod kanału pojawia się w trzech różnie nazwanych zmiennych i nic nie sprawdza,
czy się zgadzają. Backend uzgadnia wiersz nazwany przez `DEFAULT_SALES_CHANNEL_CODE` jako
system-default channel przy boot; bundle storefrontu niesie `NEXT_PUBLIC_SALES_CHANNEL_CODE`,
wbakowany w czasie buildu obrazu ze zmiennej CI `SALES_CHANNEL_CODE`. Gdy kod storefrontu
nazwuje kanał, który nie istnieje, żądania storefrontu fallbackują do system default, a treść
per-channel rozwiązuje się cicho względem złego kanału.

**Zrób (inżynier).** Uzgodnij jeden kod z klientem. Ustaw go w:

- GitLab → Settings → CI/CD → Variables: `SALES_CHANNEL_CODE` (zobacz `.gitlab-ci.yml:17`,
  używane w `.gitlab-ci.yml:645`);
- `deploy/.env` na VPS: `DEFAULT_SALES_CHANNEL_CODE` (zobacz `deploy/.env.prod.example`);
- jeśli wdrożenie obsługuje więcej niż jedną domenę, `SALES_CHANNEL_HOST_MAP` jako pary
  `host=channelCode`.

**Zweryfikuj.** Po deploy `GET /api/v1/admin/sales-channels` listuje kanał, którego `code`
równa się wartości wbakowanej w storefront, i jest oznaczony jako system default. Dokładnie
jeden system-default channel zawsze istnieje — gdy żaden nie pasuje, storefront rozmawia z
kanałem, którego nikt nie skonfigurował.

### A2. Domyślna locale

**Dlaczego.** `NEXT_PUBLIC_DEFAULT_LOCALE` jest wbakowany ze zmiennej CI `DEFAULT_LOCALE`
(`.gitlab-ci.yml:646`). Musi nazywać wiersz w tabeli `languages`. Migracja
`packages/modules/languages/src/migrations/20260425T161557_languages_currencies_init.ts` seeduje
dokładnie dwa języki — `en-US` (domyślny) i `pl-PL` — bo to był wybór demo, nie tego klienta.

**Zrób (inżynier + operator).** Ustaw `DEFAULT_LOCALE` na język klienta. Gdy domyślny klienta
to nie `en-US`, operator musi też przełączyć flagę default na wierszu języka i dodać każdy
język, którego seed nie dostarcza.

**Zweryfikuj.** Pierwszy render strony storefrontu jest w oczekiwanym języku bez przełącznika
locale, a ekran Languages pokazuje ten język jako domyślny.

---

## B. Środowisko i sekrety

### B1. Wygeneruj każdy sekret na nowo dla tego wdrożenia

**Dlaczego.** `deploy/.env.prod.example` dostarcza placeholdery (`change-me-hex-32`,
`change-me-base64-32`). Są składniowo poprawne, więc nic nie odmawia bootu: wdrożenie, które
je zostawia, działa z publicznie znaną sesją podpisującą i publicznie znanym kluczem szyfrowania
settings. Tylko dwie rzeczy są odrzucane przy boot: brak `SESSION_COOKIE_SECRET`
(`backend/src/index.ts`) i brak publicznego origin API (B2). Placeholder sekretu — nie — jest
składniowo sekretem.

**Zrób (inżynier).** Wygeneruj każdy z `SESSION_COOKIE_SECRET`, `ASSETS_LIBRARY_HMAC_KEY`
(`openssl rand -hex 32`), `SETTINGS_SECRET_ENCRYPTION_KEY`, `MFA_SECRET_ENCRYPTION_KEY`,
`MEILI_MASTER_KEY` (`openssl rand -base64 32`) i silne `POSTGRES_PASSWORD`. `chmod 600` pliku.

**Zweryfikuj.** `grep change-me /opt/b2b/.env` nie zwraca nic.

### B2. Ustaw `REVALIDATE_SECRET` i wiedz, dlaczego backend odmawia bootu bez public origin

**Dlaczego.** Ani `PUBLIC_API_BASE_URL`, ani `REVALIDATE_SECRET` nie pojawiały się w
`deploy/.env.prod.example` ani w bloku `x-backend-env` w `deploy/compose.prod.yml`, a oba
failowały cicho. Issue #218 zmienił oba, na różne sposoby:

- `PUBLIC_API_BASE_URL` to origin, na którym buduje się każdy callback bramki płatności
  (ITN/notification), każdy publiczny URL product feed i każdy link potwierdzenia newslettera.
  Kiedyś fallbackował do `http://localhost:3001`, więc platforma podawała bramce callback,
  którego internet nie dosięgnie, i żadna płatność nie była potwierdzana. `compose.prod.yml`
  teraz wyprowadza go z `API_DOMAIN` obok `BACKEND_PUBLIC_URL`, a backend **odmawia bootu**, gdy
  `NODE_ENV=production` i żaden nie jest ustawiony
  (`packages/platform/src/kernel/public-api-base-url.ts`, wołany na początku `composeApp()`).
  Nic do wypełnienia — ale gdy backend wychodzi przy boot nazwując tę zmienną, brakuje
  `API_DOMAIN`.
- `REVALIDATE_SECRET` to współdzielony sekret, który backend prezentuje endpointowi storefrontu
  `/api/revalidate` po zapisie treści (`packages/modules/catalog/src/backend/index.ts`, plus
  moduły analytics i marketing). Gdy nieustawiony, revalidator jest cichym no-op, a endpoint
  storefrontu odpowiada 401: zmiany treści nie pojawiają się, dopóki cache fetch nie wygaśnie
  sam. Jest teraz w `deploy/.env.prod.example` i trafia do **obu** kontenerów backend i
  storefront — ta sama wartość, inaczej szczelina się nie zamyka.

**Zrób (inżynier).** Wygeneruj `REVALIDATE_SECRET` (`openssl rand -hex 32`) do `deploy/.env`.
Potwierdź, że `API_DOMAIN` to prawdziwa publiczna domena API.

**Zweryfikuj.** `docker compose --env-file .env -f compose.prod.yml config | grep PUBLIC_API_BASE_URL`
pokazuje publiczny origin API, nie `localhost`. W Admin UI ekran konfiguracji bramki pokazuje
callback URL na tej domenie, i to jest URL zarejestrowany w portalu providera. Opublikuj zmianę
kategorii i potwierdź, że pojawia się na storefront bez czekania.

### B3. Wskaż `SMTP_URL` na prawdziwy relay

**Dlaczego.** `SMTP_URL` jest pusty w `deploy/.env.prod.example` i udokumentowany jako opcjonalny:
„unset falls back to a console mailer" (`deploy/compose.prod.yml:52`). Na produkcji to znaczy,
że maile weryfikacji konta, zaproszenia, potwierdzenia zamówień i dostawy faktur trafiają do
logu kontenera i nigdzie indziej. Nic nie erroruje, a klienci po prostu nic nie dostają.

**Zrób (inżynier).** Ustaw `SMTP_URL` i `SMTP_FROM` na relay klienta i tożsamość nadawcy, na
domenie ze SPF/DKIM zgodnym z tym nadawcą.

**Zweryfikuj.** Zarejestruj testowego klienta na produkcyjnym storefront i odbierz mail
weryfikacyjny w prawdziwej skrzynce. Zrób to, zanim pierwszy klient klienta to zrobi.

---

## C. Baza danych i pierwszy boot

### C1. Przećwicz łańcuch migracji na jednorazowej bazie najpierw

**Dlaczego.** Feature 072 przebudował historię migracji i wycofał frozen-name map na gruncie
D-35 — kolejność bloku przed `20260801T000000` jest celowo nieskorygowana
(`backend/src/db/migration-order.ts`), a łańcuch był stosowany tylko do baz, które można było
wyrzucić. Pierwsza produkcyjna baza to pierwsza, która musi zachować wiersze.

**Zrób (inżynier).** Na dokładnym commicie, który będzie wdrożony, nałóż cały łańcuch na pustą
jednorazową bazę — `DATABASE_URL=…/b2b_rehearsal pnpm --filter backend run db:fresh`. Nigdy
nie uruchamiaj `db:fresh` ani `db:reset` bez jawnego `DATABASE_URL`: bez prefiksu przebudowują
własną bazę developera.

**Zweryfikuj.** Run kończy się bez błędu kolejności, a wynikowa schema odpowiada temu, co
kontener `backend-migrate` na VPS produkuje na release.

### C2. Nie uruchamiaj demo seed

**Dlaczego.** Demo seed (`endora demo seed`) zapisuje cały sklep — katalog, organizację,
administratora i kupującego — do wskazanej bazy. Już nie truncuje w drodze (feature 113
przeniósł to do `endora demo reset`, który truncuje), więc koszt dla produkcji to wiersze, które
nie należą do klienta, a nie utrata jego wierszy. Ma production guard —
`ALLOW_DEV_SEED_IN_PRODUCTION` — który `deploy/compose.prod.yml` kiedyś permanentnie pokonywał
w pre-armed serwisie `seed`, który `deploy/README.md` wymieniał jako krok wdrożenia. Issue #218
usunął serwis i wyrzucił seed z procedury wdrożenia: nie ma już sposobu uruchomić go bez
wpisania przez operatora `-e ALLOW_DEV_SEED_IN_PRODUCTION=true`.

To zamyka wypadek, nie decyzję. Seed nadal jest osiągalny, a ten krok nadal jest miejscem, gdzie
operator mówi nie.

**Zrób (operator + inżynier).** Nie uruchamiaj seed. Załaduj prawdziwy katalog klienta przez
moduł Import/Export albo integrację Ergonode PIM. Wdrożenie startuje z pustym katalogiem
celowo.

**Zweryfikuj.** Brak demo produktów, demo organizacji, konta `platform_admin`, którego sam nie
utworzyłeś. `select count(*) from products` zwraca to, co wyprodukował import klienta.

### C3. Potwierdź, co platforma zaseedowała sama

**Dlaczego.** Część danych referencyjnych przychodzi bez pytania: reconciler kraj/waluta/język
działa jako boot hook (`packages/modules/dictionaries/src/backend/index.ts:201`), a system-default
sales channel jest uzgadniany przy boot, nie migracją. Gdy boot hook failuje, proces wychodzi —
więc działający backend już dowodzi, że się uruchomiły. Czym *nie* jest dowodem, to że
zaseedowane wartości są właściwe dla tego klienta.

**Zrób (operator).** Otwórz ekran Dictionary i potwierdź, że kraje, z którymi klient handluje,
są obecne i aktywne, oraz że domyślna waluta domyślnego kraju jest właściwa.

**Zweryfikuj.** Formularz adresu na storefront oferuje kraj klienta, a ceny renderują się w
walucie klienta.

---

## D. Tożsamość, role i uprawnienia

### D1. Utwórz bootstrap administratora, potem go zawęź

**Dlaczego.** Jedyna rola, którą platforma kiedykolwiek tworzy za ciebie, to `platform_admin`,
trzymająca wildcard `*`. Wszystko inne to design klienta.

**Zrób (inżynier, potem operator).**

```bash
cd /opt/b2b
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  pnpm exec tsx src/cli.ts admin_users create \
  --email=… --password=… --first-name=… --last-name=…
```

Potem w Admin UI zdefiniuj role, których klient faktycznie potrzebuje na `/admin-roles`, i
przestań używać konta wildcard do codziennej pracy.

**Zweryfikuj.** `/admin-roles` listuje role klienta, i co najmniej jedno konto bez wildcard
potrafi wykonać swoją pracę end to end.

### D2. Nadaj `customer_groups:read` i `customer_groups:write`

**Dlaczego.** Zarządzanie grupami klientów przeniesiono z `price_lists` do `customer_accounts`
(feature 076, D-79) i nadało własne kody uprawnień. Wcześniej było gated przez `catalog:write`,
co było wyraźnie błędne — grupa klientów to segmentacja klientów, nie dane katalogu. Dwa nowe
kody to `customer_groups:read` i `customer_groups:write`
(`packages/modules/customer_accounts/src/manifest.ts:188-189`).

**Nic nie nadaje ich automatycznie.** Bramka kompatybilności akceptująca stary `catalog:write`
obok nowych kodów była zaproponowana i świadomie odrzucona: utrzymałaby złe uprawnienie po
momencie, gdy przestało być właściwe, dla nikogo, bo nie było wdrożenia do ochrony. Grant
należy tutaj. Rola wildcard `*` jest nietknięta — przechodzi każdą bramkę.

**Zrób (operator).** Na `/admin-roles`, dla każdej roli, która nie jest `*` i której holder
musi widzieć albo zarządzać grupami klientów, zaznacz oba uprawnienia (albo jedno, gdy rola ma
tylko czytać). Które role ich potrzebują:

| Rola, której holder… | potrzebuje |
| --- | --- |
| zarządza listą grup klientów (`/customer-groups`) | `customer_groups:read` + `customer_groups:write` |
| edytuje klienta i przypisuje jego grupę — picker w `packages/modules/customers/src/admin/panels/ManagementPanels.tsx`, który czyta `GET /api/v1/admin/customer-groups` | `customer_groups:read` |

Te dwie i żadne inne. Builder reguł promocji i builder audience PWA też pokazują listę grup, ale
każdy czyta ją przez **własny** endpoint modułu
(`/api/v1/admin/promotions/rule-targets/customer-groups`,
`/api/v1/admin/pwa/rule-targets/customer-groups`) za własnym read permission modułu, więc ten
grant ich nie dotyka. Builder reguł price list był wyjątkiem do issue #219; teraz czyta listę
za `price_lists:read`, co jest tematem D3.

Ten sam grant można zrobić przez API:
`PUT /api/v1/admin/admin-roles/<code>` z pełną listą uprawnień roli z nowymi kodami.

**Zweryfikuj.** Zaloguj się jako holder każdej edytowanej roli i potwierdź trzy rzeczy: wpis
**Customer groups** pojawia się w sidebarze; `⌘K` → „customer groups" oferuje akcję (paleta
ukrywa akcje, których `requiredPermission` operatorowi brakuje); i `GET
/api/v1/admin/customer-groups` zwraca `200` zamiast `403`. Rola, której świadomie nie nadałeś,
nadal dostaje `403` — to druga połowa dowodu.

### D3. Nadaj `price_lists:read` i `price_lists:write`

**Dlaczego.** Do issue #219 moduł `price_lists` nie deklarował własnych uprawnień: wszystkie 25
jego tras admin było gated przez `catalog:write`. Rola z `catalog:write`, żeby ktoś mógł edytować
opisy produktów, mogła też tworzyć, edytować i usuwać cenniki — czyli zmieniać, ile klienci
płacą. Nikt nie wybrał tej granicy; to efekt uboczny brakującej deklaracji. Moduł posiada teraz
`price_lists:read` i `price_lists:write`
(`packages/modules/price_lists/src/manifest.ts`), podzielone według tego, co robi każda trasa,
a nie mapowane hurtowo: czytanie listy, rosteru produktów, bracketów, override display-mode i
pickerów rule-target to `:read`; wszystko, co persystuje, to `:write`.

Ta sama zmiana zamknęła ostatnią żywą bramkę sprzed 076:
`GET /api/v1/admin/pricing/rule-targets/customer-groups` odpowiadał na `catalog:write`, więc
edytor katalogu mógł wylistować grupy klientów klienta. Teraz odpowiada na `price_lists:read`,
jak bliźniacze endpointy `promotions` i `pwa`.

**Nic nie nadaje nowych kodów automatycznie** — i jak w D2 — bramka kompatybilności akceptująca
`catalog:write` obok nich była zaproponowana i odrzucona, bo utrzymuje złe uprawnienie po
momencie, gdy przestało być właściwe. Rola trzymająca tylko `catalog:write` ma więc **zero**
dostępu do pricing: wpis sidebar znika, `/price-lists` 403, a zakładka **Pricing** w edytorze
produktu renderuje stan błędu zamiast powiązanych cenników (czyta
`GET /api/v1/admin/products/:productId/price-lists`, teraz trasa `price_lists:read`). Rola
wildcard `*` jest nietknięta.

**Zrób (operator).** Na `/admin-roles`, dla każdej roli, która nie jest `*`, zdecyduj o pricing
jawnie:

| Rola, której holder… | potrzebuje |
| --- | --- |
| zarządza cennikami, bracketami, regułami albo override display-mode (`/price-lists`, `/price-lists/:id`, `/price-lists/display-modes`) | `price_lists:read` + `price_lists:write` |
| tylko musi zobaczyć wyjaśnioną cenę — czyta cenniki albo otwiera zakładkę **Pricing** na produkcie | `price_lists:read` |
| mapuje atrybuty Ergonode (`/pim/ergonode/attribute-mapping`), których pickery cennika i waluty czytają `GET /api/v1/admin/price-lists-engine` i `GET /api/v1/admin/pricing/rule-targets/currencies` | `price_lists:read`, oprócz `pim_ergonode:*` |
| edytuje treść katalogu i **nie** może zmieniać cen | żadnego — zostaw `catalog:write` jak jest |

Ostatni wiersz to sens zmiany: po tym `catalog:write` znaczy treść katalogu i nic więcej.
Przejrzyj każdą istniejącą rolę z tym uprawnieniem i zdecyduj, do którego z pierwszych dwóch
wierszy, jeśli w ogóle, też należy.

Ten sam grant można zrobić przez API:
`PUT /api/v1/admin/admin-roles/<code>` z pełną listą uprawnień roli z nowymi kodami.

**Zweryfikuj.** Zaloguj się jako holder każdej edytowanej roli i potwierdź cztery rzeczy: wpis
**Price lists** pojawia się w sidebarze; `GET /api/v1/admin/price-lists-engine` zwraca `200`
zamiast `403`; rola z samym `price_lists:read` dostaje `403` z
`POST /api/v1/admin/price-lists-engine`, więc podział read/write jest realny; rola z
`catalog:write` i bez żadnego kodu pricing dostaje `403` z
`GET /api/v1/admin/price-lists-engine` i z
`GET /api/v1/admin/pricing/rule-targets/customer-groups` — ten negatywny przypadek to połowa,
która dowodzi, że granica się przesunęła, a nie tylko poszerzyła.

### D4. Włącz uwierzytelnianie dwuskładnikowe dla Admin UI

**Dlaczego.** Moduł MFA jest aktywny domyślnie, ale każda capability w środku startuje **wyłączona**:
`mfa.admin.totp_enabled` i `mfa.admin.totp_enforced` domyślnie `false`
(`packages/modules/mfa/src/manifest.ts:37-51`). Wdrożenie, które nic nie zmienia, ma dostęp admin
tylko hasłem na publicznej domenie.

**Zrób (operator + inżynier).** Ustaw `MFA_SECRET_ENCRYPTION_KEY` (B1), potem zezwól na admin 2FA,
zarejestruj każdego administratora, i dopiero wtedy wymuś — wymuszenie przed rejestracją
blokuje wszystkich.

**Zweryfikuj.** Drugie logowanie prosi o kod, a konto bez rejestracji jest odmawiane po
włączeniu enforcement.

---

## E. Aktywacja modułów

### E1. Przejdź `/platform/modules` i zdecyduj o każdym

**Dlaczego.** Zasada XVII czyni obecność modułu koniunkcją platform availability i wyboru
aktywacji operatora — a druga oś ma default. Spośród modułów core 23 deklaruje się
non-deactivatable, reszta dostarcza kontrolkę aktywacji operatora; **każda z tych kontrolek
domyślnie włączona.** Nic o świeżej instalacji nie mówi, co ten klient kupił.
Moduł pozostawiony włączony wnosi wpis sidebar, akcje palety, grupę settings, powierzchnię API
i elementy storefrontu, nawet gdy nikt o to nie prosił.

**Zrób (operator).** Przejdź `/platform/modules` raz, z klientem, i wyłącz to, czego nie używa.
Wyłączenie jest niedestrukcyjne i odwracalne: nie usuwa danych, konfiguracji, uprawnień ani
schematu. **Nie polegaj na promptcie potwierdzenia, że powie, co kosztuje deaktywacja** — dziś
nazywa tylko moduł (`admin/src/modules/platform/ModuleActivationControl.tsx:88`). Co się psuje,
gdy moduł idzie off, jest w ledgerze konsekwencji deaktywacji, który buduje
`pnpm --filter backend run check:port-dependencies`; poproś inżyniera o odczyt dla każdego
modułu, z którym klient wyraźnie skończył.

**Zweryfikuj.** Dla każdego wyłączonego modułu: wpis sidebar zniknął, akcje palety zniknęły, a
API odpowiada `503 MODULE_DISABLED`. Dla każdego pozostawionego włączonego ktoś potrafi powiedzieć
dlaczego.

### E2. Zdecyduj jawnie o modułach marketing i analytics

**Dlaczego.** `google_analytics`, `google_tag_manager`, `meta_ads` i `linkedin_ads` są wszystkie
aktywne domyślnie. Każdy ma drugi, capability-level toggle wyłączony do konfiguracji, więc nic
jeszcze nie jest transmitowane — ale aktywacja to to, co stawia ekrany i ustawienia consent-mode
przed operatorem, a czy klient w ogóle chce third-party tracking, to decyzja o wadze prawnej w UE.

**Zrób (operator).** Potwierdź per moduł: wanted czy nie. Gdzie wanted, skonfiguruj measurement
ID i toggle `require_consent` przed pierwszym odwiedzającym.

**Zweryfikuj.** Z modułami, które klient odrzucił, wyłączonymi, w źródle strony storefront nie
ma third-party tagu.

### E3. Zdecyduj o asystencie AI osobno

**Dlaczego.** `prompt_actions` jest aktywny domyślnie, choć sam asystent
(`prompt_actions.enabled`) jest wyłączony i potrzebuje credential LLM, zanim cokolwiek zrobi.
Włączenie oznacza, że instrukcje admin i dane potrzebne do ich rozwiązania opuszczają platformę
dla third-party model provider. To decyzja o przetwarzaniu danych, nie konfiguracji.

**Zrób (operator).** Zdecyduj z klientem. Gdy tak, zarejestruj credential LLM na `/credentials`,
ustaw `prompt_actions.bulk_limit` i nadaj `prompt_actions:use` świadomie, a nie przez dziedziczenie.

**Zweryfikuj.** Gdy odrzucone, tryb prompt palety nie występuje. Gdy zaakceptowane, klient
zgodził się na providera na piśmie.

---

## F. Konfiguracja biznesowa przed pierwszą transakcją

### F1. Tożsamość sprzedawcy faktury i numeracja

**Dlaczego.** Moduł Invoices jest aktywny domyślnie, a tożsamość sprzedawcy jest pusta:
`invoices.seller.tax_id` domyślnie `''`, a `invoices.seller.company_data` `{}`
(`packages/modules/invoices/src/manifest.ts:40-55`). Wzorce numeracji domyślnie
`FV {seq}/{channel}/{YYYY}`, `PRO …`, `KOR …` — rozsądny kształt, i nadal wybór, który księgowy
klienta musi potwierdzić, bo nie da się go wygodnie zmienić, gdy dokumenty już istnieją pod nim.
Prawidłowy tax id jest też prewarunkiem serializacji KSeF, gdy klient go używa.

**Zrób (operator).** Wypełnij ustawienia sprzedawcy i potwierdź trzy wzorce numeracji w
Settings → Invoices przed pierwszą fakturą.

**Zweryfikuj.** Wystaw jedną fakturę na testowe zamówienie i przeczytaj PDF: blok sprzedawcy to
prawdziwa tożsamość prawna klienta, a numer pasuje do uzgodnionego wzorca.

### F2. Numeracja zamówień, minimalna wartość zamówienia i odbiorcy potwierdzeń

**Dlaczego.** `orders.business_id.prefix` i `orders.business_id.suffix` domyślnie `''`,
`orders.min_order_value` to `0`, a `orders.confirmation_recipients` to `[]`
(`packages/modules/orders/src/manifest.ts`). Ostatnie jest ciche: przy pustej liście nikt po
stronie klienta nie jest powiadamiany o złożeniu zamówienia.

**Zrób (operator).** Ustaw affixy numeru zamówienia przed pierwszym zamówieniem, minimalną
wartość zamówienia na regułę handlową klienta i co najmniej jednego wewnętrznego odbiorcę
potwierdzenia.

**Zweryfikuj.** Złóż testowe zamówienie: numer niesie uzgodnione affixy, a potwierdzenie trafia
do wewnętrznej skrzynki klienta.

### F3. Podatki, dostawa i metody płatności

**Dlaczego.** Żadna stawka podatku nie jest seedowana, a żadna metoda dostawy ani płatności nie
jest skonfigurowana dla tego klienta: moduły delivery i payment tylko uzgadniają wiersz per
zainstalowany adapter bramki (ich `installHook`s), co jest placeholderem, nie decyzją
handlową. Zamówienie może zostać złożone ze wszystkimi trzema źle, długo zanim ktoś zauważy.

**Zrób (operator).** Skonfiguruj stawki VAT, które klient nalicza, metody dostawy z dostępnością
per channel i metody płatności.

**Zweryfikuj.** Testowy checkout pokazuje oczekiwaną linię podatku, oferuje dokładnie opcje
dostawy i płatności, których klient oczekuje, i sumuje się do liczby, którą własny system klienta
by wyprodukował.

### F4. Przełącz każdą bramkę płatności z sandbox na production

**Dlaczego.** Każdy moduł bramki domyślnie ustawia environment na `sandbox`
(`packages/modules/tpay/src/manifest.ts:28`, `packages/modules/payu/src/manifest.ts:28`, i ten
sam kształt w `autopay` i `stripe`), i trzyma osobne credentials per environment. Wdrożenie live
w sandbox nie bierze pieniędzy; wdrożenie, które zapomni zarejestrować production callback URL,
bierze pieniądze i nigdy nie potwierdza zamówienia.

**Zrób (operator + inżynier).** Dla każdej bramki, której klient używa: wprowadź production
credentials, przełącz environment na `production` i zarejestruj callback URL — zbudowany na
`PUBLIC_API_BASE_URL` (B2) — w portalu providera. Dla Autopay URL ITN to
`{PUBLIC_API_BASE_URL}/api/v1/autopay/itn`; endpoint ISTN musi być włączony przez providera na
żądanie.

**Zweryfikuj.** Jedna prawdziwa transakcja o niskiej wartości per bramka end to end i potwierdź,
że zamówienie dochodzi do stanu paid z callback providera — nie z ręcznej zmiany statusu.

### F5. KSeF, gdy klient fakturuje w Polsce

**Dlaczego.** Moduł `ksef` domyślnie ustawia `ksef.integration.enabled` na `false`, a environment na
`test` (`packages/modules/ksef/src/manifest.ts`) — właściwy default — błędnie skonfigurowane
production submission jest prawnie wiążące. Wejście live to więc świadomy akt.

**Zrób (operator).** Zainstaluj i skonfiguruj moduł na `/ksef`: wgraj albo wygeneruj certyfikaty,
zweryfikuj połączenie w `test`, potem przełącz environment na `prod` i włącz integrację.

**Zweryfikuj.** Jedna faktura wysłana w `test` i zaakceptowana, zanim przełączysz environment.

---

## G. Operacje, które muszą istnieć od dnia pierwszego

### G1. Backupy, w tym wolumen assets

**Dlaczego.** `deploy/README.md` opisuje cron `pg_dump` jako *zalecany* i obejmuje tylko Postgres.
Adapter local-filesystem Assets Library zapisuje pliki do wolumenu `backend-assets`
(`deploy/compose.prod.yml`), a nic tego nie backupuje. Przywrócona baza bez plików to katalog
zepsutych obrazów i niedostępnych PDF-ów faktur.

**Zrób (inżynier).** Zainstaluj off-box cron `pg_dump`, dodaj wolumen assets i — część zwykle
pomijana — przywróć oba do scratch environment raz, przed go-live.

**Zweryfikuj.** Rehearsal restore produkuje działający storefront z obrazami.

### G2. Zbuduj indeks wyszukiwania po pierwszym załadowaniu katalogu

**Dlaczego.** Indeks wyszukiwania jest utrzymywany przyrostowo przy zapisie. Dane załadowane
przed istnieniem indeksu albo ścieżką omijającą eventy po prostu tam nie ma — wyszukiwanie
storefront zwraca nic i bez błędu.

**Zrób (inżynier).** Po zakończeniu importu katalogu klienta uruchom re-index. Na VPS:

```bash
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  pnpm exec tsx src/cli.ts search reindex
```

(ta sama invokacja, którą robi skrypt pakietu `search:reindex` — `src/cli.ts` to host binary
uruchamiający polecenia, które moduły deklarują w `manifest.ts`; `--list` wypisuje każde,
które ta instancja oferuje). Zobacz `docs/docs/modules/search.md`.

**Zweryfikuj.** Wyszukaj produkt, o którym wiesz, że istnieje, i go znajdź; porównaj liczbę
zindeksowanych dokumentów z liczbą produktów.

### G3. Powiedz backendowi, który proxy może nazywać adres IP klienta

**Dlaczego.** Adres klienta dociera do aplikacji tylko przez `X-Forwarded-For`, a backend wierzy
w ten nagłówek tylko od hopu, któremu kazano ufać — inaczej `request.ip` to host nginx dla
każdego żądania. Trzy konsekwencje: limit rate per IP (1000/min) staje się jednym wspólnym
kubełkiem dla całego internetu; IP zapisane na audit rows istotnych dla bezpieczeństwa — zdarzenia
MFA, impersonacja admin, runy prompt-action — to proxy, nie aktor; klucz rate-limit product feed
publiczny zapada dla nieuwierzytelnionych callerów. Kiedyś to było otwarte pytanie bez odpowiedzi
w kodzie; od issue #220 odpowiedź to zmienna.

**Zrób (inżynier).** Potwierdź, że host nginx ustawia `X-Forwarded-For` i `X-Forwarded-Proto`
(szablon w `deploy/nginx.example.conf` już to robi z `$proxy_add_x_forwarded_for`), potem ustaw w
`deploy/.env` na VPS:

```bash
TRUSTED_PROXY_HOPS=1
```

Jeden hop, bo dokładnie jeden proxy siedzi między internetem a kontenerem backend. Dodaj jeden
per dodatkowy proxy — CDN przed host nginx robi 2 — i licz źle tylko w kierunku *wysokim* na
własne ryzyko: każdy dodatkowy hop to jeden wpis `X-Forwarded-For`, który sam klient mógł
napisać. Gdy adres proxy jest stały i znany, `TRUSTED_PROXY_ADDRESSES` bierze IP, zakresy CIDR
albo nazwane zakresy `loopback` / `linklocal` / `uniquelocal` zamiast tego; ustaw jedną zmienną
albo drugą, nigdy obie. Celowo nie ma wartości „ufaj każdemu hopowi", a backend odmawia bootu
na wartości, której nie parsuje, zamiast fallbackować do braku zaufania — cichy fallback to
dokładnie stan, który ten punkt ma zakończyć.

**Zweryfikuj.** Po restarcie stacku zaloguj się z znanego zewnętrznego adresu i odczytaj wiersz
audytu MFA albo impersonacji: zapisany adres musi być twój, nie proxy. Szybki negatywny test to
`curl -H 'X-Forwarded-For: 1.2.3.4' https://<API_DOMAIN>/...` z zewnątrz — przy jednym
zaufanym hopie sfałszowany wpis jest ignorowany, a logowany adres nadal twój, bo nginx dokleja
własny widok peer po sobie.

---

## Świadomie poza tą listą

Każdy z tych punktów był rozważony i zostawiony poza listą, z powodem. Gdy powód przestaje
obowiązywać, punkt idzie wyżej.

- **Provisioning VPS, DNS, TLS, rejestr i stack compose.** Pokryte przez `deploy/README.md`,
  które ta strona zakłada wykonane. Duplikacja to sposób, w jaki obie się rozjeżdżają.
- **Skoordynowany reset bazy developera**
  (`specs/072-module-kernel-di/MIGRATION-RESET.md`). To procedura stacji roboczej developera.
  Pierwsza produkcyjna baza startuje pusta i stosuje łańcuch raz; C1 to pokrywa.
- **Raport migracji price list** (feature 011, FR-003 — „oznacz wiersze, które potrzebują
  prawdziwej wartości per waluta przed go-live"). Opisuje migrację *istniejącego* wdrożenia ze
  starymi cenami jednostkowymi. Pierwsze wdrożenie nie ma legacy cen do migracji. Staje się
  realnym punktem, gdy pierwszy klient jest migrowany na platformę z czegoś innego.
- **Retencja usuwania klientów** (`customers.deletion_retention_days`, default 365) i
  **świeżość presence**. Default jest bezpieczny i nie gryzie przez rok, a ustawienie można
  edytować w dowolnym momencie bez konsekwencji danych. Należy do przeglądu GDPR, nie bramki
  go-live.
- **Credentials integracji per moduł dla modułów, których klient nie używa** — Ergonode, product
  feeds, providerzy newsletter, pixele marketing. Jest dziesiątki settings z defaultem pustego
  stringa; każde jest inertne, dopóki capability modułu nie zostanie włączone. E1 decyduje,
  które z nich w ogóle istnieją; wypisanie każdego credential tutaj byłoby zrzutem settings, nie
  checklistą.
- **Tuning Meilisearch, Redis i Postgres.** Praca pojemnościowa, nie poprawności, a nota sizing
  single-VPS w `deploy/README.md` pokrywa floor.
- **Rename modułu albo zablokowana blokada lifecycle.** Procedury incydentów, nie kroki go-live;
  runbook to `docs/docs/operations/runbooks/module-lifecycle-stuck-lock.md`.
- **Integracje specyficzne dla klienta** — połączenie ERP albo WMS, klucze API, subskrypcje
  webhook. Prawdziwa praca, ale to project scoping, nie bramka go-live platformy: nic w platformie
  nie jest źle, dopóki klient o coś nie poprosi.
- **Cokolwiek, na co static check już odmawia.** Gdy CI może failować, to nie punkt tutaj — o to
  chodzi w design check inventory w `AGENTS.md`.

---

## Gdy D-35 się zamyka

W dniu, gdy pierwsze wdrożenie niesie dane klienta, D-35 przestaje licencjonować cokolwiek. Od
tego momentu: rename zastosowanej klasy migracji znów potrzebuje rename map, bramka uprawnień
nie może się zmienić bez ścieżki grant, a zmiana kontraktu potrzebuje dyscypliny wersjonowania,
którą opisuje Konstytucja II. Rekord decyzji mówi to w ostatnim akapicie; ta strona to miejsce,
gdzie konsekwencje zostały opłacone.

---
title: Drabina dostosowań
description: Uporządkowana lista punktów rozszerzenia, przez które można zmienić działanie platformy — ile każdy kosztuje, co się przez niego traci i kto może z niego korzystać.
---

# Drabina dostosowań

Potrzebujesz, żeby platforma działała inaczej. Można to zrobić na sześć sposobów; są uporządkowane,
a każdy kosztuje więcej niż poprzedni. **Zacznij od najniższego stopnia.**

Autor, który nie zna tej listy, sięga po najsilniejszy dostępny punkt rozszerzenia. To nie
przypuszczenie o ludziach — dokładnie tak się tu stało i dlatego istnieje `ForeignDecorationError`.

Trzy rzeczy sprawiają, że ta lista naprawdę obowiązuje, a nie tylko dobrze wygląda:

1. **Każda rozbieżność, którą wprowadzasz, ma przypisany stopień** we własnym, generowanym raporcie
   wdrożenia (`backend/src/apps/<deployment>/divergence.generated.md`), więc to, że ktoś
   wielokrotnie ląduje na wysokim stopniu, da się zmierzyć, a nie tylko opowiedzieć. Ścieżki na tej
   stronie dotyczą tego repozytorium; w instancji utworzonej przez `npx create-endora-commerce` te
   same pliki leżą w `apps/<deployment>/` w katalogu głównym instancji, a raport generuje
   `pnpm run generate`.
2. **Każda odmowa wskazuje niższy stopień, który zadziała**, więc jeśli sięgniesz za wysoko,
   platforma w tej samej chwili powie ci, po co sięgnąć zamiast tego.
3. **Stopień, z którego nie możesz skorzystać, mówi to wprost.** Stopień 3 nie jest dostępny dla
   wdrożenia, które chce podstawić własną implementację, i ta strona to mówi, zamiast wymieniać go
   jako opcję, o której zamknięciu przekonasz się dopiero przy próbie.

## Dwa pytania, a nie jedno

„Ile to kosztuje?” i „czy wolno mi to zrobić?” to dwa różne pytania. Pomieszanie ich sprawiło, że
poprzednia wersja tej listy była błędna.

|  | moduł rdzenia | moduł nakładkowy twojego wdrożenia | zainstalowany pakiet |
| --- | --- | --- | --- |
| działanie we **własnym** obszarze | tak | tak | tak |
| działanie w obszarze **innego modułu**, na jego zaproszenie | tak | tak | tak |
| działanie w obszarze innego modułu **bez zaproszenia** | nie | **tak**, z wyjątkiem rejestracji zainstalowanego pakietu i czterech punktów zabezpieczeń | nie |

Środkowy wiersz to stopnie 1–3: punkt rozszerzenia opublikowany przez właściciela, w którym jesteś
gościem. Dolny wiersz to stopień 4 i ma go wyłącznie wdrożenie — bo wdrożenie jest jedynym
właścicielem swojej instancji: zmienia własne drzewo, buduje obraz i nie odpowiada przed nikim poza
sobą.

**Kolumnę wyznacza miejsce, w którym platforma znalazła moduł, a nigdy to, co moduł o sobie
mówi.** Każdy złożony moduł ma pochodzenie, nadawane przez loader, który go wykrył: `core` (moduł
platformy, w tym pakiet własnego modułu platformy zainstalowany w instancji), `deployment` (moduł
nakładkowy w `apps/<deployment>/modules/`) albo `package` (każdy inny zainstalowany pakiet). Nie
ustawia go żadne pole manifestu, a posiadanie tabeli go nie zmienia. Wdrożenie może przyznać
zainstalowanemu pakietowi jeden nazwany punkt wpięcia w zatwierdzonym `divergence.ts`, o ile dany
punkt to przewiduje; takie przyznanie jest uprawnieniem wyłącznie w tym punkcie, a wszędzie indziej
pakiet nadal ma pochodzenie `package`.

Każdą odpowiedź na pytanie „kto może” na tej stronie egzekwuje istniejące zabezpieczenie
(`ForeignDecorationError`, `PackageDecorationNotOfferedError`, `DuplicateRegistrationError`,
`ForeignRegistrationError`, `CommandMiddlewareOriginError`), a nie ta tabela.

---

## Stopień 0 — konfiguracja

**Mechanizm.** Ustawienie zadeklarowane przez moduł, na ekranie `/settings`. Pola niestandardowe
definiowane w czasie działania — gdy trzeba „dodać pole”. Graf statusów zamówienia. Aktywacja
przez operatora na `/platform/modules`.

**Koszt.** Żaden. Przetrwa każdą aktualizację, bo to dane.

**Co się traci.** Nic.

**Kto.** Każdy, także operator bez programisty.

**Kiedy to jest odpowiedź.** Zawsze, gdy wymaganie brzmi *„ta wartość ma być tu inna”* albo *„dodaj
pole”*. Większość próśb, które przychodzą jako „zmień kod”, kończy się właśnie tutaj, a autor,
który najpierw nie sprawdził stopnia 0, jeszcze nie zaczął pracy.

---

## Stopień 1 — subskrypcja zdarzeń, które właściciel już emituje

**Mechanizm.** `ctx.subscribe('<event>', handler)`, rejestrowane w `backend.ts` twojego modułu —
nigdy w treści pluginu.

**Koszt.** Sam punkt rozszerzenia nic nie kosztuje. Subskrypcja zależy od faktycznego stanu
twojego modułu, więc wyłączenie modułu ją zatrzymuje.

**Co się traci.** Nic. Obserwujesz; nie zmieniasz tego, co zrobił właściciel.

**Kto.** Każdy.

**Kiedy to jest odpowiedź.** Dodatkowa praca wywołana czymś, co już się wydarzyło: powiadomienie,
kopia danych, wzbogacenie systemu dalej w łańcuchu, zapis własnego wiersza.

:::warning Nie ma katalogu zdarzeń, które można subskrybować
Platforma emituje zdarzenia w 46 miejscach i żaden manifest modułu ich nie deklaruje, więc na
pytanie „co mogę subskrybować?” można dziś odpowiedzieć tylko czytając kod źródłowy platformy —
czego klient instalujący pakiety zrobić nie może. Naprawą jest blok `events` w manifeście modułu, w
takiej samej postaci, jaką mają już `permissions` i `actions`; to zmiana obejmująca wszystkie moduły
i nie została jeszcze zbudowana. **Ten stopień istnieje, ale trudno go odkryć** — i ta strona mówi
to wprost, zamiast zostawiać to do samodzielnego odkrycia.
:::

:::note Nie na tym stopniu: udział w samym zapisie
Subskrybent działa po zatwierdzeniu transakcji i nie może zmienić ani odrzucić tego, co zostało
zapisane. Aby działać **wewnątrz** zapisu właściciela — dodać własny wiersz w tej samej transakcji
albo zapis odrzucić — użyj hooka polecenia, czyli stopnia 2 (2b poniżej).
:::

---

## Stopień 2 — kod przed tym, co właściciel już obsługuje, albo po tym

Trzy mechanizmy, jeden stopień: wokół endpointu (2a), wewnątrz zapisu, który właściciel
zadeklarował jako dostępny dla hooków (2b), albo wokół każdego polecenia, którego akcja pasuje do
filtra (2c). Każdy może odmówić; żaden nie zastępuje tego, co robi właściciel.

### 2a — interceptor API

**Mechanizm.** `ctx.interceptors([{ id, target, phase, order, handler }])`. Celem jest stały
identyfikator endpointu `"<METHOD> <route pattern>"` — wzorzec dokładnie taki, jaki rejestruje
właściciel (`/api/v1/orders/:id`, nigdy konkretne id).

**Koszt.** Powiązanie z identyfikatorem endpointu, który jest publicznym API i podlega
wersjonowaniu. `order` ma udokumentowaną regułę rozstrzygania remisów; rejestracja po gotowości
serwera jest odrzucana; wykonanie zależy od tego, czy twój moduł jest włączony; rejestr potrafi
wypisać cały plan wykonania.

**Co się traci.** Nic strukturalnie. Interceptor `pre` może zablokować żądanie, rzucając
zarejestrowany błąd; interceptor `post` nie może niczego zapisywać, bo własny zapis endpointu mógł
już zostać zatwierdzony.

**Kto.** Każdy, również wobec cudzych modułów. **To najsilniejszy punkt rozszerzenia, jaki ma ktoś
z zewnątrz** — i po niego warto sięgnąć, zanim poprosi się właściciela o cokolwiek.

**Kiedy to jest odpowiedź.** Gdy trzeba zmienić to, co trafia do istniejącego endpointu albo z
niego wychodzi; dodać pole do odpowiedzi; odrzucić żądanie według własnej reguły.

:::caution Interceptor podpięty do endpointu, którego nic nie obsługuje, nigdy się nie wykona
Rejestr przyjmuje taki cel bez słowa. W czasie działania nic cię o tym nie poinformuje. Kontrola
rozbieżności twojego wdrożenia porównuje każdy cel z tabelą tras i przerywa build błędem
`unmatched-interceptor-target` — i tylko ona to wychwyci.
:::

### 2b — hook polecenia

**Mechanizm.** `ctx.commandHooks([{ id, on, phase: 'beforeCommit', handler }])`, gdzie `on` to
referencja, którą właściciel publikuje w `@endora-commerce/contracts` dla polecenia zadeklarowanego
jako dostępne dla hooków (`ORGANIZATION_HOOKABLE_ACTIONS.register`). Hook działa wewnątrz transakcji
właściciela, po jego zapisie i przed jego wpisem audytu. Szczegóły są na stronie
[Command Bus](./command-bus.md#command-hooks-beforecommit).

**Koszt.** Powiązanie z akcją dostępną dla hooków i kształtem jej danych — to publiczne API, które
właściciel wersjonuje — oraz zależność od właściciela w twoim manifeście. Hook trzyma otwartą
transakcję właściciela przez cały czas działania, więc nie wywołuje usług zdalnych.

**Co się traci.** Nic strukturalnie. Zapis właściciela, jego jedyny wpis audytu i sama szyna
poleceń pozostają właściciela: hook może dodać własne wiersze (we własnych tabelach albo przez
polecenie uruchomione `ctx.run`) i odrzucić cały zapis — nic więcej.

**Kto.** Każdy, również wobec cudzych modułów — moduły rdzenia, moduły nakładki twojego wdrożenia i
zainstalowane pakiety — ale tylko na akcjach, które właściciel zadeklarował. Hook na niezadeklarowanej
akcji, dwa nieuporządkowane moduły z hookami na jednej akcji albo moduł z hookiem, który nie zależy od
właściciela, przerywają kompozycję przy starcie. Kolejność dwóch niezależnych modułów z hookami
ustala twoje wdrożenie w `divergence.ts` (`commandHookOrder`).

**Kiedy to jest odpowiedź.** Własna reguła, która musi obowiązywać przy każdym zapisie rekordu,
niezależnie od endpointu czy portu, przez który przyszedł; własne dane, które muszą zostać
zatwierdzone razem z wierszem rdzenia albo wcale.

### 2c — middleware poleceń {#2c--command-middleware}

**Mechanizm.** `ctx.commandMiddleware([{ id, phase, … }])`, zadeklarowane w polu
`commandMiddleware` manifestu z tym samym identyfikatorem, fazą i filtrem akcji — `'*'`, pełna
akcja (`quote_request.create`) albo prefiks zakończony kropką (`organization.`). Dwie fazy i nic
więcej:

- **`admit`** działa, zanim polecenie cokolwiek zrobi, przed otwarciem transakcji, dla polecenia
  głównego i każdego pasującego polecenia podrzędnego. Dostaje wyłącznie metadane — akcję, obiekt,
  wykonawcę, organizację, identyfikator żądania i pochodzenie w łańcuchu poleceń — i może jedynie
  przepuścić polecenie albo rzucić `CommandRefusedError` z kodem zadeklarowanym w twoim manifeście.
  Odrzucone polecenie niczego nie zapisuje i nie tworzy wpisu w dzienniku audytu.
- **`observe`** działa po zatwierdzeniu albo wycofaniu przebiegu, niezależnie od wywołującego, i
  dostaje wynik: czy zatwierdzono, kod odmowy lub błędu, czas trwania i każde polecenie, którego
  przebieg próbował. Tylko odczytuje, a wyjątek rzucony w nim trafia do logu i jest pomijany.

**Koszt.** Powiązanie z nazwami akcji, które należą do właścicieli i zmieniają się razem z nimi.
Każde `admit` działa na ścieżce zapisu każdego pasującego polecenia, więc ma limit czasu (domyślnie
100 ms, najwyżej 500 ms) i odmawia po jego przekroczeniu; `observe` ma własny (1000 ms, najwyżej
5000 ms) i limit jednocześnie trwających wywołań.

**Co się traci.** Nic strukturalnie. Nie ma fazy, która zmienia dane wejściowe polecenia, widzi
jego dane lub wynik albo działa wokół niego — to, co zapisuje właściciel, pozostaje właściciela.

**Kto.** `admit`: moduł rdzenia albo moduł nakładkowy twojego wdrożenia; zainstalowany pakiet jest
odrzucany przy kompozycji (`CommandMiddlewareOriginError`) i żadne przyznanie tego nie zmienia.
`observe`: każdy, przy czym zainstalowany pakiet widzi identyfikator żądania, ale nie adres IP ani
user agenta. Dwa moduły `admit` z nakładającymi się filtrami i bez ścieżki zależności porządkuje
się w `divergence.ts` (`commandMiddlewareOrder`), w przeciwnym razie kompozycja odmawia. Obie fazy
są pomijane, gdy ich moduł jest wyłączony.

**Kiedy to jest odpowiedź.** Pomiar zapisów, dodatkowy odbiorca audytu, ograniczenie
częstotliwości, zamrożenie na czas prac serwisowych, blokada prawna — zachowanie przekrojowe dla
poleceń, czyli to, co wdrożenie dawniej uzyskiwało, opakowując `commandBus`.
[Przeniesienie wrappera szyny na middleware poleceń](./overlay-pattern.md#moving-a-bus-wrap-to-command-middleware)
pokazuje to krok po kroku.

:::note Polecenia operatora nie uruchamiają middleware ani hooków
Command Bus, który polecenie operatora buduje dla siebie poza aplikacją — dziś polecenia cyklu
życia rozszerzeń schematu — nie uruchamia middleware poleceń ani hooków poleceń, w żadnej fazie.
Jego polecenia nadal są audytowane. Nie polegaj na regule `admit`, aby zatrzymać polecenie
serwisowe uruchomione przez kogoś z dostępem do powłoki i bazy danych.
:::

---

## Stopień 3 — port strategii opublikowany przez właściciela

**Mechanizm.** Właściciel publikuje nazwany port przez `ctx.di.providePort`, a jeśli celem jest
możliwość podstawienia implementacji, publikuje też interfejs w ścieżce `./ports` swojego pakietu,
zawierającej wyłącznie typy. Ty pobierasz port przez `lazyPort<T>(ctx, '<literal>')` i deklarujesz
zależność w swoim manifeście.

**Koszt.** Krawędź zależności w manifeście — i właśnie dzięki niej ta zależność istnieje dla cyklu
życia, dla kolejności migracji i dla operatora, który wyłącza właściciela.

**Co się traci.** Nic. Właściciel zachowuje punkt rozszerzenia i dalej go poprawia za ciebie.

**Kto — przeczytaj to, zanim cokolwiek na tym zaplanujesz.**

> **Wdrożenie nie może dostarczyć strategii na tym stopniu.**

`ctx.di.providePort` zajmuje nazwę, a próba jej zajęcia jest odrzucana, gdy właścicielem jest już
inny moduł — i **nie ma tu wyjątku dla nakładki**. Nie ma też opublikowanych, a
niezaimplementowanych portów, które czekałyby na implementację. Ten stopień działa więc tylko w
jedną stronę: **konsument** może pobrać dowolny opublikowany port, a twój raport zapisuje to jako
`port-consumed`. **Wdrożenie, które chce podstawić implementację**, nie ma tu żadnego mechanizmu i
musi skorzystać ze stopnia 4.

**Co to dla ciebie oznacza.** *Poproś właściciela o port.* Powtarzające się lądowanie na stopniu 4
z tym samym problemem to informacja zwrotna dla produktu, że ten punkt rozszerzenia powinien trafić
do rdzenia jako port stopnia 3 — i właśnie oznaczenia stopni w raporcie czynią to mierzalnym.

**Między twoimi własnymi modułami ten stopień jest otwarty.** Jeden z twoich modułów nakładkowych
może opublikować port przez `ctx.di.providePort`, z typami w swoim `ports.ts`, a inny twój moduł
nakładkowy może go pobrać przez `lazyPort` — importując od właściciela wyłącznie `ports.ts`, przez
`import type`, i wymieniając właściciela w `dependencies` swojego manifestu. Wdrożenie nie może
natomiast podstawić portu, którego właścicielem jest moduł rdzenia albo pakiet.

:::note Punkty decyzyjne (policy points) jeszcze nie istnieją
*Punkt decyzyjny* — decyzja zadeklarowana przez właściciela, w której inne moduły biorą udział jako
uczestnicy — jest wyspecyfikowany na jedno z kolejnych wydań i w tym wydaniu nie istnieje. Gdy się
pojawi, znajdzie się na tym stopniu: uczestnikami mogą być moduł rdzenia i twoje moduły nakładkowe,
a zainstalowany pakiet tylko wtedy, gdy twój `divergence.ts` przyzna mu to dla tego jednego punktu.
Do tego czasu nic na tej stronie się do niego nie odwołuje.
:::

:::note Jeśli jesteś autorem modułu, który publikuje port
Kształt opublikowanego portu jest typem kontraktu, nigdy twoją własną klasą; nazwa w kontenerze
podana w jego bloku dokumentacji jest częścią kontraktu i pilnuje jej kontrola; a **opcjonalna
metoda w opublikowanym porcie jest odrzucana**, bo proxy rozwiązujące port odpowiada funkcją na
każdą właściwość i wykrywanie funkcji przez nie jest z założenia niemożliwe.

Port **zapisu** jest portem swojego agregatu — rozszerzaj `<aggregate>CommandPort` agregatu, zamiast
publikować port skrojony pod jedno żądanie (zobacz [przewodnik po jądrze](./kernel.md)) — a każda
metoda opublikowanego portu należy do [powierzchni kontraktu](./contract-surface.md): zanim zostanie
usunięta albo zmieniona, jest wycofywana na jedno wydanie.
:::

---

## Stopień 4 — zmiana tego, co wydaje kontener

Dwa mechanizmy na jednym stopniu; drugi ma szerszy zasięg.

### 4a — dekoracja {#4a--decoration}

**Mechanizm.** `ctx.di.decorate<T>('<name>', (inner) => …)` z własnego modułu nakładkowego
wdrożenia. **Opakuj i deleguj; nie zastępuj.**

**Koszt.** Powiązanie z wersją kontraktu, którego kształtu nikt za ciebie nie sprawdza.
`ctx.di.decorate<T>` przyjmuje `T` jako założenie w miejscu wywołania i z niczym go nie porównuje,
więc kształt opakowywanego obiektu deklaruje się strukturalnie, a rozjazd interfejsu jest
niespodzianką w czasie działania, a nie błędem budowania. Najtańszy sposób na odzyskanie kontroli
to opublikowanie interfejsu przez właściciela w ścieżce `./ports` i importowanie go stamtąd przez
twoją nakładkę.

**Co się traci.** *Automatycznie* nic, o ile delegujesz — poprawka rdzenia w opakowanej metodzie
nadal do ciebie dociera. **Wszystko, jeśli zastępujesz**: zastąpienie na stałe przecina delegację.

**Kto.** **Wyłącznie moduł nakładkowy wdrożenia.** Może opakować to, co rejestrują rdzeń i moduły
tego wdrożenia, oraz każdą nazwę dostarczaną przez composition root (`redis`, `orm`,
`requireAdmin`, …) — **każdą nazwę dostarczaną przez composition root można dekorować, z wyjątkiem
czterech**. Moduł rdzenia, który opakowuje rejestrację innego modułu, zostaje odrzucony, tak samo
jak każdy, kto opakowuje rejestrację należącą do zainstalowanego pakietu.

**Cztery punkty zabezpieczeń.** `commandBus`, `auditLogService`, `eventBus` i `emFactory`
(`GUARD_SEAM_REGISTRATIONS` w `@endora-commerce/contracts`) to nazwy, przez które egzekwuje się
izolację tenantów i audyt zapisów, więc żaden moduł ich nie dekoruje:

| Wydanie | Nakładka dekorująca punkt zabezpieczeń |
| --- | --- |
| do 0.112.x | składa się |
| 0.113.0 | **przestarzała** — składa się, raz na moduł i nazwę zapisuje w logu `kernel.decoration.deprecated` i jest ostrzeżeniem `deprecated-decoration` w raporcie rozbieżności |
| 0.114.0 | **odrzucana** przy kompozycji |

Czego użyć zamiast tego: middleware poleceń (stopień 2c) albo hooka polecenia (2b) dla
`commandBus`; middleware `observe` albo odczytu `audit_log_entries` dla `auditLogService`;
`ctx.subscribe` albo hooka `afterCommit` dla `eventBus`; a dla `emFactory` niczego — zawężania do
tenanta nie da się nadpisać, więc poproś moduł właściciela o port.

**Dwa twoje moduły nakładkowe opakowujące tę samą nazwę** zostaną odrzucone, chyba że wdrożenie
zadeklaruje kolejność, od najbardziej wewnętrznego:

```ts
// backend/src/apps/<deployment>/divergence.ts
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {
    // acme_overlay wraps core; beta_overlay wraps acme_overlay
    pricingService: ['acme_overlay', 'beta_overlay'],
  },
  reasons: { /* … */ },
};
```

Ta deklaracja jest **sprawdzana, nigdy stosowana**: composer nadal generuje dekoracje we własnej
kolejności, a deklaracja potwierdza, że była to kolejność zamierzona. Deklaracja, która przestaje
się zgadzać, powoduje więc odmowę przy kompozycji, zamiast po cichu cokolwiek przestawiać. Jeden
moduł dekorujący tę samą nazwę dwa razy nie jest niejednoznaczny — sam napisał oba opakowania, w
kolejności, w jakiej je napisał.

### 4b — plugin główny

**Mechanizm.** `ctx.rootPlugin(reason, plugin)` — plugin Fastify montowany na poziomie głównym
serwera, z uzasadnieniem podawanym w wywołaniu.

**Koszt i co się traci.** Więcej niż w 4a i dlatego dzieli z nim stopień, zamiast leżeć niżej:
plugin główny może dodać hooki, które widzą **każde żądanie każdego modułu**, co jest zasięgiem
ściśle szerszym niż opakowanie jednej rejestracji, i jest powiązany z API pluginów Fastify, a nie z
kształtem jednej usługi.

**Kto.** Może go wywołać każdy moduł. Użycie go przez twoje wdrożenie pojawia się w raporcie
rozbieżności; użycia przez moduł *rdzenia* dziś nic nie ocenia — to znana luka, a nie przyzwolenie.

---

## Stopień 5 — fork

**Mechanizm.** Skopiuj pakiet modułu i utrzymuj go samodzielnie.

**Koszt.** Wszystko.

**Co się traci.** Na zawsze wszystkie aktualizacje tego modułu, łącznie z poprawkami
bezpieczeństwa. Nie ma delegacji ani drogi powrotnej.

**Kto.** Każdy, i nie potrzebuje do tego naszej zgody — właśnie dlatego zostało to zapisane. Autor,
który robi fork, nie wiedząc o stopniach 0–4, zapłacił najwyższą cenę z tej listy za coś, co
załatwiłby stopień 2.

---

## Drabina danych: gdzie trafiają nowe dane {#the-data-ladder-where-new-data-lives}

Stopnie powyżej zmieniają **zachowanie**. Nowe **dane** mają własną drabinę, uporządkowaną tak
samo: zacznij od dołu.

| Stopień | Mechanizm | Kto | Przetrwa aktualizacje, bo |
| --- | --- | --- | --- |
| D0 | **Pola niestandardowe definiowane w czasie działania** — operator definiuje pole encji gospodarza w panelu administracyjnym | operator, w czasie działania | to dane: wiersz definicji i wartość we własnym zbiorze wartości gospodarza |
| D1 | **Tabela poboczna**, której właścicielem jest twój moduł, kluczowana identyfikatorem wiersza rdzenia i odczytywana przez port twojego modułu | dowolny twój moduł, zainstalowany pakiet, nakładka wdrożenia | tabela jest twoja; rdzeń jej nie dotyka |
| D2 | **Zadeklarowane kolumny rozszerzeń** — addytywne kolumny `x_<moduleId>_*` w rozszerzalnej tabeli rdzenia, deklarowane przez `defineColumnExtension` | zainstalowany pakiet modułu albo nakładka wdrożenia zależne od gospodarza | platforma generuje DDL, zapisuje je w rejestrze, weryfikuje przy każdej migracji i każdym starcie, a CI rdzenia pilnuje, by każda otwarta rozszerzalna tabela je zachowała |
| D3 | **Wariant zapewniany przez moduł-właściciela** — typ, status, konfigurowalny kształt, który właściciel już modeluje | decyduje właściciel; ty konfigurujesz | to własny schemat właściciela |

**D2 jest celowo wąski.** Rozszerzalne tabele to dokładnie tabele gospodarzy pól
niestandardowych — wyprowadzane z rejestru powiązań pól niestandardowych, nigdy z drugiej listy —
a w tym wydaniu otwarta jest tylko `organizations` (pozostałe osiem dojdzie w późniejszym
wydaniu). Moduł deklarujący jest właścicielem swoich kolumn `x_<moduleId>_*` i tylko jego kod je
zapisuje, przez akcesor platformy, wewnątrz polecenia (Command) albo hooka polecenia; gospodarz
zachowuje tabelę, jej ograniczenia i wszystkie niezadeklarowane kolumny. Odinstalowanie modułu
pozostawia kolumny (rejestr oznacza je jako osierocone), dopóki operator nie usunie ich
audytowanym poleceniem. Przykład i wszystkie reguły są na stronie
[Zadeklarowane kolumny rozszerzeń](./schema-extensions.md).

**Nigdy nie jest stopniem: nadpisywanie schematu rdzenia.** Kolumny, ograniczenia, indeksu ani
klasy encji rdzenia nigdy nie zmienia się spoza ich modułu, a migracja pakietu zapisująca tabelę
innego modułu jest odrzucana przy `migrate` — przez platformę, nie przez przegląd kodu. Moduł
nakładkowy wdrożenia ma własne encje i migracje — tabelę poboczną (D1) albo zadeklarowane kolumny
(D2) — a jego migracje przechodzą przez to samo zabezpieczenie, bez wyjątku z tego powodu, że
należą do wdrożenia (zobacz
[Wzorzec nakładki](./overlay-pattern.md#an-overlay-module-owns-its-schema)).

Powodem **nie** jest kolejność migracji — ten argument sprawdzono pomiarem, okazał się fałszywy i
został wycofany. Powód jest taki, że wspólny schemat rdzenia to jedyne, co w ogóle umożliwia
aktualizacje: D1 i D2 to dwa sposoby dodania schematu, których aktualizacja rdzenia ma obowiązek
— sprawdzany — nie zepsuć.

---

## Zarezerwowane i celowo bez numeru: nadpisywanie wkładów modułów

*Włączanie i zmiana kolejności wkładów modułu* — pozycji w strefie panelu administracyjnego, wpisu
nawigacji, akcji palety poleceń — byłoby osobnym stopniem, poniżej stopnia 2, bo nie zmienia
niczyjego zachowania, tylko to, co jest oferowane. **Taki stopień nie istnieje**: wkład w strefę ma
wagę, ale nie ma flagi `enabled`, a wdrożenie nie może zmienić żadnej z tych wartości. Strefa z
czterema wkładami jest uporządkowana wyłącznie według wag wybranych przez ich autorów.

Ten stopień jest tu zarezerwowany i nienumerowany, a nie wymieniony na liście, bo numerowanie
nieistniejącego stopnia to dokładnie ten błąd, którego dotyczy powyższa korekta stopnia 3.

---

## Co zmieniłeś i gdzie to przeczytać

Każda rozbieżność wprowadzona przez twoje wdrożenie trafia do dwóch generowanych plików w twoim
repozytorium, generowanych ponownie z twojego drzewa i porównywanych bajt po bajcie w CI:

| Plik | Odbiorca |
| --- | --- |
| `backend/src/apps/<deployment>/divergence.generated.md` | ty, recenzent, osoba aktualizująca platformę, nasze wsparcie |
| `backend/src/apps/<deployment>/divergence.generated.ts` | program i kontrola deterministyczności |

Obok nich jest jedyny plik, który piszesz ręcznie, `backend/src/apps/<deployment>/divergence.ts`.
Zawiera to, czego nie da się wyprowadzić z drzewa plików: moduły, których nie dostarczasz,
kolejność opakowywania, gdy dwa twoje moduły nakładkowe dekorują tę samą nazwę, kolejność dwóch
modułów z hookami poleceń albo dwóch modułów z middleware `admit`, których nie porządkuje żadna
zależność, oraz **po jednym zdaniu
uzasadnienia dla każdej rozbieżności**.

Oba zestawy są porównywane w obie strony. Build kończy się błędem zarówno przy rozbieżności bez
uzasadnienia, jak i przy uzasadnieniu rozbieżności, której już nie ma — bo właśnie tak wdrożenie po
cichu odzyskuje ryzyko, które kiedyś zadeklarowało.

Uzasadnienie, które będzie warto przeczytać za półtora roku, mówi, **co robi rdzeń** i **co zamiast
tego robi twoje wdrożenie**. Uzasadnienie podające tylko to drugie to pół zdania, a „nie
potrzebujemy tego” w ogóle nie jest uzasadnieniem.

Zobacz też: [Wzorzec nakładki](./overlay-pattern.md).

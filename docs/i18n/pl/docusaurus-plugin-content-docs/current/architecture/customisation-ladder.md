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
| działanie w obszarze innego modułu **bez zaproszenia** | nie | **tak, bez ograniczeń** | nie |

Środkowy wiersz to stopnie 1–3: punkt rozszerzenia opublikowany przez właściciela, w którym jesteś
gościem. Dolny wiersz to stopień 4 i ma go wyłącznie wdrożenie — bo wdrożenie jest jedynym
właścicielem swojej instancji: zmienia własne drzewo, buduje obraz i nie odpowiada przed nikim poza
sobą.

Każdą odpowiedź na pytanie „kto może” na tej stronie egzekwuje istniejące zabezpieczenie
(`ForeignDecorationError`, `PackageDecorationNotOfferedError`, `DuplicateRegistrationError`,
`ForeignRegistrationError`), a nie ta tabela.

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

:::note Nie na tym stopniu: Command Bus
`CommandBus.run(command)` przyjmuje obiekt polecenia i wykonuje je w transakcji. Nie ma rejestru
handlerów i nie ma się do czego podpiąć. To jednolita ścieżka zapisu, a nie punkt rozszerzenia.
:::

---

## Stopień 2 — kod przed tym, co właściciel już obsługuje, albo po tym

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

:::note Jeśli jesteś autorem modułu, który publikuje port
Kształt opublikowanego portu jest typem kontraktu, nigdy twoją własną klasą; nazwa w kontenerze
podana w jego bloku dokumentacji jest częścią kontraktu i pilnuje jej kontrola; a **opcjonalna
metoda w opublikowanym porcie jest odrzucana**, bo proxy rozwiązujące port odpowiada funkcją na
każdą właściwość i wykrywanie funkcji przez nie jest z założenia niemożliwe.
:::

---

## Stopień 4 — zmiana tego, co wydaje kontener

Dwa mechanizmy na jednym stopniu; drugi ma szerszy zasięg.

### 4a — dekoracja

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

**Kto.** **Wyłącznie moduł nakładkowy wdrożenia**, za to bez ograniczeń: może opakować wszystko, co
jest w kontenerze, łącznie z nazwami, których właścicielem nie jest żaden moduł (`commandBus`,
`auditLogService`, `eventBus`, `emFactory`). Moduł rdzenia, który opakowuje rejestrację innego
modułu, zostaje odrzucony. Zainstalowany pakiet zostaje odrzucony — a nie tylko odnotowany w
raporcie — bo stawką jest integralność ścieżki audytu.

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

## Nigdy nie jest stopniem: schemat

**Encji i migracji rdzenia nigdy się nie nadpisuje.** Własne tabele należą do modułu, którego
jesteś właścicielem; dodatkowe pole w encji rdzenia dodaje się przez pola niestandardowe
definiowane w czasie działania. Moduł nakładkowy wdrożenia nie zawiera ani klas encji, ani
migracji, a generator odrzuca jedno i drugie.

Powodem **nie** jest kolejność migracji — ten argument sprawdzono pomiarem, okazał się fałszywy i
został wycofany. Powód jest taki, że wspólny schemat rdzenia to jedyne, co w ogóle umożliwia
aktualizacje, a nakładka znajduje się w tym samym repozytorium i w tym samym buildzie co rdzeń,
więc rozwiązanie kosztuje tylko jeden katalog: utwórz tabelę we własnym module i odczytuj ją z
nakładki przez port tego modułu.

**Zainstalowany pakiet rozszerzenia** to przypadek odwrotny i może zawierać jedno i drugie: autor
zewnętrzny nie ma modułu rdzenia, więc ta sama reguła byłaby dla pakietów rozszerzeń zakazem, a nie
ograniczeniem, które da się obejść projektem.

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
Zawiera trzy rzeczy, których nie da się wyprowadzić z drzewa plików: moduły, których nie
dostarczasz, kolejność opakowywania, gdy dwa twoje moduły nakładkowe dekorują tę samą nazwę, oraz
**po jednym zdaniu uzasadnienia dla każdej rozbieżności**.

Oba zestawy są porównywane w obie strony. Build kończy się błędem zarówno przy rozbieżności bez
uzasadnienia, jak i przy uzasadnieniu rozbieżności, której już nie ma — bo właśnie tak wdrożenie po
cichu odzyskuje ryzyko, które kiedyś zadeklarowało.

Uzasadnienie, które będzie warto przeczytać za półtora roku, mówi, **co robi rdzeń** i **co zamiast
tego robi twoje wdrożenie**. Uzasadnienie podające tylko to drugie to pół zdania, a „nie
potrzebujemy tego” w ogóle nie jest uzasadnieniem.

Zobacz też: [Wzorzec nakładki](./overlay-pattern.md).

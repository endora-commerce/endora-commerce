---
title: Drabina dostosowania
description: Uporządkowana lista szwów do zmiany zachowania platformy — koszt każdego, co traci, i kto może z niego skorzystać.
---

# Drabina dostosowania

Potrzebujesz, żeby platforma zachowywała się inaczej. Jest sześć sposobów, są
uporządkowane, a każdy kosztuje więcej niż ten poniżej. **Zacznij od dołu.**

Autor, który nie zna tej listy, sięga po najpotężniejszy dostępny szew. To nie
hipoteza o ludziach — tak się tu działo i dlatego istnieje `ForeignDecorationError`.

Trzy rzeczy sprawiają, że ta lista ma znaczenie, a nie tylko dobrze brzmi:

1. **Każde odchylenie, które piszesz, niesie swój stopień** w własnym wygenerowanym
   raporcie deploymentu (`backend/src/apps/<deployment>/divergence.generated.md`), więc
   wielokrotne docieranie na wysoki stopień jest mierzalne, a nie anegdotyczne.
2. **Każda odmowa nazywa stopień poniżej, który działa**, więc jeśli sięgasz za wysoko,
   platforma mówi, gdzie sięgnąć zamiast tego — w chwili, gdy sięgasz.
3. **Stopień, z którego nie możesz skorzystać, mówi to wprost.** Stopień 3 nie jest
   dostępny dla deploymentu chcącego podstawić implementację, a ta strona to mówi,
   zamiast wymieniać go jako opcję, którą odkryjesz jako zamkniętą.

## Dwa pytania, nie jedno

„Ile to kosztuje?” i „czy mogę to zrobić?” to różne pytania, a ich zlanie w jedno
sprawiło, że poprzednia wersja tej listy była błędna.

|  | moduł core | moduł overlay deploymentu | zainstalowany pakiet |
| --- | --- | --- | --- |
| działanie na **własnej** powierzchni | tak | tak | tak |
| działanie na powierzchni **innego modułu**, na zaproszenie tego modułu | tak | tak | tak |
| działanie na powierzchni innego modułu **bez zaproszenia** | nie | **tak, całkowicie** | nie |

Środkowy wiersz to stopnie 1–3: szew opublikowany przez właściciela, na którym jesteś
gościem. Dolny wiersz to stopień 4, a deployment jest jedyną stroną, która go ma —
bo deployment w całości posiada swoją instancję: edytuje własne drzewo, buduje obraz
i nie odpowiada nikomu poza sobą.

Każda odpowiedź „kto może” na tej stronie jest egzekwowana przez istniejącą straż
(`ForeignDecorationError`, `PackageDecorationNotOfferedError`,
`DuplicateRegistrationError`, `ForeignRegistrationError`), a nie przez tę tabelę.

---

## Stopień 0 — konfiguracja

**Mechanizm.** Setting zadeklarowany przez moduł na `/settings`. Pola niestandardowe
w runtime, dla „dodaj pole”. Graf statusów zamówienia. Aktywacja operatora na
`/platform/modules`.

**Koszt.** Nic. Przetrwa każdy upgrade, bo to dane.

**Traci.** Nic.

**Kto.** Wszyscy, w tym operator bez developera.

**Kiedy to odpowiedź.** Gdy wymaganie brzmi *„ta wartość ma tu być inna”* albo
*„dodaj pole”*. Większość próśb przychodzących jako „zmień kod” kończy tu, a autor,
który nie sprawdził stopnia 0, jeszcze nie zaczął.

---

## Stopień 1 — subskrybuj to, co właściciel już emituje

**Mechanizm.** `ctx.subscribe('<event>', handler)`, rejestrowane z `backend.ts`
modułu — nigdy z ciała pluginu.

**Koszt.** Nic na szwie. Subskrypcja jest gated na effective state własnego modułu,
więc wyłączenie modułu ją zatrzymuje.

**Traci.** Nic. Obserwujesz; nie zmieniasz tego, co właściciel zrobił.

**Kto.** Wszyscy.

**Kiedy to odpowiedź.** Praca addytywna wyzwalana czymś, co już się stało: powiadom,
odtwórz, wzbogać downstream, zapisz własny wiersz.

:::warning Nie ma katalogu tego, na co można subskrybować
Platforma emituje zdarzenia z 46 miejsc i żaden manifest modułu nie deklaruje jednego,
więc „na co mogę subskrybować?” da się dziś odpowiedzieć tylko czytając źródła platformy —
czego klient instalujący pakiety nie może. Opublikowanie bloku `events` w manifeście modułu,
w kształcie, jaki mają już `permissions` i `actions`, to naprawa; to feature modułu w całym
estate i nie jest zbudowany. **Ten stopień jest realny i niewykrywalny**, i jest tu
powiedziane wprost, zamiast zostawiać to do odkrycia.
:::

:::note Nie na tym stopniu: Command Bus
`CommandBus.run(command)` bierze obiekt command i wykonuje go w transakcji. Nie ma rejestru
handlerów i niczego, na co można się zahaczyć. To ujednolicona ścieżka zapisu, nie punkt
rozszerzenia.
:::

---

## Stopień 2 — uruchom przed lub po tym, co właściciel już serwuje

**Mechanizm.** `ctx.interceptors([{ id, target, phase, order, handler }])`. Target to
stabilna tożsamość endpointu `"<METHOD> <route pattern>"` — wzorzec dokładnie tak,
jak właściciel go rejestruje (`/api/v1/orders/:id`, nigdy konkretne id).

**Koszt.** Sprzężenie z tożsamością endpointu, która jest publicznym API i jest
wersjonowana. `order` ma udokumentowany tie-break; rejestracja jest odmawiana po
gotowości serwera; wykonanie jest gated na enabled state modułu; rejestr może wydrukować
cały plan wykonania.

**Traci.** Nic strukturalnego. Interceptor `pre` może wetować przez rzucenie
zarejestrowanego błędu; `post` nie może pisać, bo własny zapis endpointu mógł już
być zatwierdzony.

**Kto.** Wszyscy, u wszystkich właścicieli. **To najsilniejszy szew, jaki ma obcy**,
i po niego sięga się, zanim poprosisz właściciela o cokolwiek.

**Kiedy to odpowiedź.** Dostosuj to, co wchodzi lub wychodzi z istniejącego endpointu;
dodaj pole do odpowiedzi; odmów żądania według własnej reguły.

:::caution Interceptor na endpoint, którego nikt nie serwuje, nigdy nie uruchomi się
Rejestr przyjmuje target w milczeniu. Nic nie powie w runtime. Divergence check deploymentu
uzgadnia każdy target z tabelą tras i failuje build z `unmatched-interceptor-target` —
jedyne, co to zrobi.
:::

---

## Stopień 3 — port strategii opublikowany przez właściciela

**Mechanizm.** Właściciel publikuje nazwany port przez `ctx.di.providePort` i, gdy chodzi
o podstawienie, publikuje interfejs na type-only subpath `./ports` swojego pakietu.
Rozwiązujesz go przez `lazyPort<T>(ctx, '<literal>')` i deklarujesz krawędź w manifeście.

**Koszt.** Krawędź zależności w manifeście — to czyni krawędź realną dla lifecycle,
kolejności migracji i operatora wyłączającego właściciela.

**Traci.** Nic. Właściciel trzyma szew i naprawia go za tobą.

**Kto — i przeczytaj to, zanim zaplanujesz wokół tego.**

> **Deployment nie może dostarczyć strategii na tym stopniu.**

`ctx.di.providePort` rości sobie nazwę, a roszczenie jest odmawiane, gdy inny moduł
już ją posiada, **bez wyjątku dla overlay**. Nie ma też opublikowanego, lecz
niezaimplementowanego portu czekającego na jeden. Ten stopień jest więc dostępny w
dokładnie jednym kierunku: **konsument** może rozwiązać każdy opublikowany port, i to
raport zapisze jako `port-consumed`. **Deployment chcący podstawić implementację** nie
ma tu mechanizmu i musi użyć stopnia 4.

**Co to dla ciebie znaczy.** *Poproś właściciela o port.* Wielokrotne docieranie na
stopień 4 dla tego samego problemu to feedback produktowy, że szew należy do core jako
port stopnia 3 — dokładnie to mierzą stopy na raporcie.

:::note Jeśli jesteś autorem modułu publikującym port
Kształt opublikowanego portu to typ kontraktu, nigdy własna klasa; nazwa kontenera
w bloku doc to kontrakt i check ci to trzyma; **opcjonalna metoda na opublikowanym
porcie jest odmawiana**, bo proxy rozwiązania odpowiada każdej właściwości funkcją
i wykrywanie feature przez nie jest z definicji niemożliwe.
:::

---

## Stopień 4 — zmień to, co kontener wydaje

Dwa mechanizmy, jeden stopień, a drugi jest szerszy.

### 4a — dekoracja

**Mechanizm.** `ctx.di.decorate<T>('<name>', (inner) => …)` z własnego modułu overlay
deploymentu. **Owijaj i deleguj; nie zastępuj.**

**Koszt.** Sprzężenie wersji kontraktu ze kształtem, którego nic za ciebie nie sprawdza.
`ctx.di.decorate<T>` asertuje `T` w miejscu wywołania i nie porównuje go z niczym, więc
owinięty kształt jest deklarowany strukturalnie, a dryf interfejsu to niespodzianka
w runtime, a nie failure buildu. Tani sposób na bramkę z powrotem: właściciel publikuje
interfejs na subpath `./ports`, a overlay nazywa go tam.

**Traci.** Nic *automatycznie*, jeśli delegujesz — poprawka core do owiniętej metody
nadal do ciebie dociera. **Wszystko, jeśli zastępujesz**: zastąpienie trwale przecina
delegację.

**Kto.** **Tylko moduł overlay deploymentu**, i całkowicie: może owijać wszystko, co
trzyma kontener, w tym nazwy, których nie posiada żaden moduł (`commandBus`,
`auditLogService`, `eventBus`, `emFactory`). Moduł core owijający rejestrację innego
modułu jest odmawiany. Zainstalowany pakiet jest odmawiany — nie ledgerowany, bo
stawką jest integralność ścieżki audytu.

**Dwa moduły overlay owijające jedną nazwę** są odmawiane, chyba że deployment deklaruje
kolejność, od wewnątrz na zewnątrz:

```ts
// backend/src/apps/<deployment>/divergence.ts
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {
    // acme_overlay owija core; beta_overlay owija acme_overlay
    pricingService: ['acme_overlay', 'beta_overlay'],
  },
  reasons: { /* … */ },
};
```

To jest **sprawdzane, nigdy stosowane**: composer nadal emituje we własnej kolejności,
a deklaracja asertuje, że taka była zamierzona, więc deklaracja przestająca pasować
odmawia przy kompozycji, zamiast cicho przestawiać cokolwiek. Jeden moduł dekorujący
jedną nazwę dwa razy nie jest niejednoznaczny — napisał oba wrapy w kolejności, w jakiej
je napisał.

### 4b — root plugin

**Mechanizm.** `ctx.rootPlugin(reason, plugin)` — plugin Fastify montowany u korzenia
serwera, z reason string przy wywołaniu.

**Koszt i strata.** Więcej niż 4a, dlatego dzieli stopień, zamiast siedzieć poniżej:
root plugin może dodać hooki widzące **każde żądanie każdego modułu**, co jest ściśle
szersze niż owinięcie jednej rejestracji, i jest sprzężony z API pluginów Fastify, a nie
z kształtem jednej usługi.

**Kto.** Każdy moduł może to wołać. Użycie przez deployment widać w raporcie divergence;
użycie przez moduł *core* nie jest dziś oceniane przez nic — to znana luka, a nie
uprawnienie.

---

## Stopień 5 — fork

**Mechanizm.** Skopiuj pakiet modułu i utrzymuj go.

**Koszt.** Wszystko.

**Traci.** Wszystkie aktualizacje tego modułu, na stałe, w tym poprawki bezpieczeństwa.
Nie ma delegacji ani kanału z powrotem.

**Kto.** Każdy, i nie potrzebuje od nas pozwolenia — dlatego jest tu zapisane. Autor
forkujący bez wiedzy, że istniały stopnie 0–4, zapłacił najwyższą cenę z tej listy za
coś, co zrobiłby stopień 2.

---

## Nigdy stopniem: schema

**Encje core i migracje nigdy nie są nadpisywane.** Własne tabele należą do modułu,
który posiadasz; dodatkowe pole na encji core idzie przez pola niestandardowe w runtime.
Moduł overlay per deployment nie wysyła żadnej klasy encji ani migracji, a generator
odmawia obu.

Powód **nie** jest kolejnością migracji — ten argument zmierzono jako fałszywy i wycofano.
Powodem jest to, że współdzielona schema core to jedyne, co czyni upgrade wykonalnym,
a overlay żyje w tym samym repozytorium i tym samym buildzie co core, więc remedium
nic nie kosztuje poza katalogiem: posiadaj tabelę z własnego modułu i czytaj ją z overlay
przez port tego modułu.

**Zainstalowany pakiet rozszerzenia** to odwrotny przypadek i może wysłać oba: autor
third-party nie ma modułu core, więc ta sama reguła byłaby zakazem pakietów rozszerzeń,
a nie ograniczeniem do obejścia w projekcie.

---

## Zarezerwowane i celowo nienumerowane: nadpisania contribution

*Włączanie i przestawianie contribution modułu* — contributor strefy admin, wpis nawigacji,
akcja palety — byłoby własnym stopniem, poniżej stopnia 2, bo nie zmienia zachowania
niczego, tylko tego, co jest oferowane. **Nie istnieje**: contribution strefy ma weight
i brak flagi `enabled`, a deployment nie może dotknąć żadnego z nich. Strefa z czterema
contributorami jest uporządkowana wyłącznie przez wagi, które wybrali własni autorzy.

Jest zarezerwowane i nienumerowane tutaj, zamiast wymieniane, bo numerowanie stopnia,
który nie istnieje, to dokładnie wada, którą koryguje poprawka stopnia 3 powyżej.

---

## Co zmieniłeś i gdzie to czytać

Każde odchylenie, które pisze deployment, ląduje w dwóch wygenerowanych plikach we
własnym repozytorium, regenerowanych z drzewa i porównywanych bajt po bajcie w CI:

| Plik | Czytelnik |
| --- | --- |
| `backend/src/apps/<deployment>/divergence.generated.md` | ty, reviewer, osoba robiąca upgrade, nasze wsparcie |
| `backend/src/apps/<deployment>/divergence.generated.ts` | program i bramka determinizmu |

Obok leży jeden plik pisany ręcznie,
`backend/src/apps/<deployment>/divergence.ts`, który niesie trzy rzeczy, których
spacer nie wyprodukuje: moduły, których nie wysyłasz, kolejność owijania, gdy dwa
moduły overlay dekorują jedną nazwę, i **jedno zdanie na odchylenie mówiące dlaczego**.

Te dwa są uzgadniane w obie strony. Odchylenie bez zdania failuje build, i zdanie
opisujące odchylenie, którego już nie ma, też — tak deployment w milczeniu odzyskuje
zagrożenie, które kiedyś zadeklarował.

Powód wart czytania za osiemnaście miesięcy nazywa **co robi core** i **co robi zamiast
tego deployment**. Powód nazywający tylko drugie to pół zdania, a „nie potrzebujemy tego”
w ogóle nie jest powodem.

Zobacz też: [Wzorzec overlay](./overlay-pattern.md).

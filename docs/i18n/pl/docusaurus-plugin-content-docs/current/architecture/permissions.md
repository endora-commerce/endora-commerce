---
title: Uprawnienia — kody administracyjne i kody organizacji, i które z nich właśnie widzisz
description: Jak deklaruje się, przyznaje, egzekwuje i wyłącza kody uprawnień administracyjnych oraz kody uprawnień organizacji.
---

# Uprawnienia

Platforma ma **dwa słowniki uprawnień**, które nigdy się nie spotykają:

| Słownik | Kto go ma | Postać | Deklaracja w manifeście | Gdzie się go przyznaje |
| --- | --- | --- | --- | --- |
| Uprawnienia administracyjne (operatora) | administratorzy platformy, przez role administracyjne | `<obszar>:<działanie>`, np. `catalog:write` | `permissions` | `/admin-roles` w panelu administracyjnym |
| Uprawnienia organizacji | członkowie organizacji klienta, przez role organizacji | `<moduł>.<działanie>`, np. `carts.approve` | `organizationPermissions` | ekran *Role* organizacji w storefroncie oraz zakładka *Role* organizacji w panelu administracyjnym |

Żaden string nie może należeć do obu. Pierwsza część tej strony dotyczy słownika
administracyjnego, druga — [Uprawnienia organizacji](#uprawnienia-organizacji) — słownika
kupującego.

Uprawnienie administracyjne w tej platformie to kod, a z kodem związane są **trzy odrębne
pojęcia**. Kiedyś widoczne było tylko jedno z nich i dlatego powstała ta strona: czytelnik, który
widzi `module: 'quote_requests'` przy `rfqs:handle`, rozsądnie wnioskuje, że o obecności tego kodu
decyduje wyłącznie `quote_requests`. Ten wniosek jest błędny na tyle często, że spowodował błąd,
który trafił do wydania; audyt znalazł pięć takich przypadków.

## 1. `module` — grupowanie do wyświetlania

`module` to nagłówek, pod którym edytor ról umieszcza kod. Nic więcej.

**Nie** ma gwarancji, że to identyfikator modułu: `_lifecycle` deklaruje swoje kody z
`module: 'module_lifecycle'`, co nie wskazuje żadnego modułu w żadnym wdrożeniu. Filtrowanie
czegokolwiek po `module` usuwa więc uprawnienia cyklu życia w każdej platformie, która tego
spróbuje.

## 2. `owners` — czyja obecność pozwala przyznawać kod

`owners` to **zbiór** modułów, które deklarują dany kod. `/admin-roles` oferuje kod, dopóki
faktycznie obecny jest **którykolwiek** z właścicieli — na obu osiach obecności modułu: dostępności
w platformie *i* aktywacji przez operatora.

To zbiór, bo kod może być współdzielony. `integrations:manage` chroni ekrany kluczy API i webhooków,
a deklarują go zarówno `api_keys`, jak i `webhooks`; wyłączenie `webhooks` nie może usunąć z edytora
ról uprawnienia, które chroni ekran kluczy API. Wspólna deklaracja to mechanizm i zarazem naprawa
dla modułu, który egzekwuje kod należący do innego modułu — zobacz *Cudze kody uprawnień* niżej.

`owners` i `module` to różne stringi, a traktowanie ich jak jednego to błąd, który tylko czeka, by
się ujawnić. Oba są zwracane przez `GET /api/v1/admin/permissions`, a edytor ról pokazuje zbiór
właścicieli wszędzie tam, gdzie mówi on coś, czego nie mówi grupowanie.

## 3. Słownik i zbiór kodów, które można przyznać

Dwa pytania, na które celowo odpowiada się inaczej:

| Pytanie | Metoda | Filtrowane według obecności |
| --- | --- | --- |
| Co operator może **nowo przyznać**? | `listAssignable()` | tak |
| Jakie kody platforma **zna**? | `listKnownCodes()` | nie |

Zapis roli jest walidowany względem **słownika**, nigdy względem zbioru kodów, które można
przyznać, i właśnie ta różnica sprawia, że zdanie *„wyłączenie modułu nie niszczy danych i jest
odwracalne”* pozostaje prawdziwe. Rola „Editor” ma `blog.read`; operator wyłącza `blog`, a potem
zmienia nazwę roli. Walidacja przesłanej listy względem zbioru kodów, które można przyznać,
zwróciłaby `400 Unknown permission(s): blog.read` — operator albo straciłby rolę, albo po cichu
utraciłby uprawnienie, które musi wrócić, gdy wróci `blog`. Takie uprawnienie jest tymczasowo
nieszkodliwe: trasy, które chroni, odpowiadają `503 MODULE_DISABLED` we własnym punkcie
egzekwowania.

Edytor ról na tym polega. Zaznaczenia ustawia na podstawie kodów **roli**, a pole wyboru wyświetla
tylko dla kodów oferowanych przez katalog, więc uprawnienie nieobecnego modułu przechodzi przez
zapis i odczyt bez pola, które można by odznaczyć.

`PermissionCatalogueService`
(`packages/modules/admin_roles/src/backend/services/permission-catalogue.service.ts`) to miejsce,
w którym łączą się wszystkie trzy pojęcia — i jedyne takie miejsce.

## Cudze kody uprawnień: egzekwowanie kodu, którego nie jesteś właścicielem

Moduł może egzekwować kod uprawnienia należący do innego modułu. Nic nie deklaruje tego powiązania,
a jego koszt działa w jedną stronę: to obecność właściciela decyduje, czy kod jest oferowany, więc
wyłączenie właściciela usuwa kod z `/admin-roles`, a trasy konsumenta — jeśli konsumenta nie da się
wyłączyć razem z nim — nadal go egzekwują. Ekran jest chroniony uprawnieniem, którego nikt nie może
dostać.

To jest **wyprowadzane, a nie deklarowane**. `backend/test/helpers/foreign-gates.ts` odczytuje każde
miejsce egzekwowania, które wyznacza inwentarz uprawnień, oraz każdy manifest i klasyfikuje każdą
parę; każdy werdykt wynika z manifestów przy każdym uruchomieniu, więc cofnięcie `nonDeactivatable`
w module ponownie otwiera każde zgłoszenie, które się na tym opierało, w tym samym pipeline i bez
edycji żadnego rejestru.

Trzy sposoby naprawy, w kolejności, w jakiej warto po nie sięgać:

1. **Konsument chroni trasę kodem, którego jest właścicielem.** Zastosuj test etykiety: czy
   etykieta kodu brzmi jak zdanie o własnym ekranie konsumenta? *„Handle quote requests”* nie jest
   zdaniem o endpoincie wyznaczającym cenę, więc `price_lists` chroni tę trasę przez
   `price_lists:read`.
2. **Oba moduły deklarują kod**, przez co konsument staje się drugim właścicielem, a kod istnieje,
   dopóki włączony jest którykolwiek z ekranów. Tego kształtu używają już `api_keys` i `webhooks`.
3. **Zadeklaruj właściciela w `dependencies`** — na samym końcu i zwykle niesłusznie. Konsument,
   którego nie da się wyłączyć, deklarujący właściciela, którego da się wyłączyć, sprawia, że
   mechanizm cyklu życia w ogóle odmawia wyłączenia tego właściciela: to odwrócenie reguły o
   przełączalności modułów, rozstrzygnięte przez cudzy manifest.

## Zadeklarowane zależności: `requires`

Deklaracja uprawnienia może wskazać inne kody potrzebne roli, która je ma:

```ts
permissions: [
  { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
],
```

To **wyłącznie wskazówka i nic nie kosztuje w czasie działania**. Nie czyta jej żadne
zabezpieczenie, żaden zapis roli nie jest przez nią odrzucany i nie jest to krawędź cyklu życia — nie
dodaje żadnego modułu do niczyich `dependencies`. Umieszcza za to zdanie tam, gdzie operator może je
przeczytać: edytor ról pokazuje braki dla aktualnie zaznaczonych kodów i pozwala dodać je jednym
kliknięciem, a rola zapisana bez nich i tak zostaje zapisana.

Powyższy przykład jest prawdziwy. `RfqCreatePage` wstępnie wypełnia uzgodnioną cenę z trasy
`price_lists`, celowo chronionej przez `price_lists:read`, więc rola mająca tylko `rfqs:handle`
traci to wypełnienie i wraca do ręcznego wpisywania. To zdanie było zapisane w decyzji, w komentarzu
trasy i w danych początkowych — i w niczym, co mógłby przeczytać operator.

**Nie zapisuj tu faktu, który da się wyprowadzić.** *Moduł egzekwuje kod, którego nie jest
właścicielem* to pytanie z poprzedniej sekcji, wyprowadzane z miejsc egzekwowania i manifestów, a
deklarowanie tego w manifeście oznaczałoby dwie odpowiedzi na jedno pytanie, które prędzej czy
później się rozjadą. `requires` zawiera coś, czego żadne narzędzie w tym repozytorium nie wyliczy:
powiązanie żądań wysyłanych przez ekran administracyjny z trasą innego modułu oraz ocenę, czy rola
bez drugiego kodu jest zepsuta, czy tylko ograniczona w sposób, który ktoś zaakceptował.

Maszynowo sprawdzane *jest* to, czy wymaganie wskazuje kod, który zna słownik platformy — literówka
albo kod, którego właściciel zmienił nazwę, w przeciwnym razie bez końca podpowiadałyby operatorowi
przyznanie czegoś, co nie istnieje. Sprawdza to
`backend/test/contract/admin_users/permission-inventory.test.ts`, w tym samym pliku co
dwukierunkowy przegląd inwentarza, bo inwentarz i tak odczytuje każdy kod z manifestów, a dwa
wyprowadzenia jednego zbioru to dwie odpowiedzi, które prędzej czy później się rozjadą.

Kod deklarowany przez więcej niż jeden moduł dostaje **sumę** wymagań wszystkich deklarujących:
współdzielony kod otwiera więcej niż jeden ekran, każdy z własnymi potrzebami, a podpowiadanie
więcej to kierunek, który nikogo nie zablokuje.

## Kiedy działa zabezpieczenie

Trasa deklaruje swoje zabezpieczenie jako `preHandler` — `{ preHandler: requireAdmin('catalog:write'),
schema: { body } }` — a platforma uruchamia je **przed walidacją żądania**: łańcuch `preHandler`
zadeklarowany w opcjach trasy jest przy jej rejestracji przenoszony do fazy `preValidation` tej
trasy. Kolejność dla jednego żądania jest więc taka:

1. `onRequest` — rozpoznanie sesji, ustalenie zakresu organizacji i kanału sprzedaży, odpowiedź
   `503` dla wyłączonego modułu, zliczenie żądania przez ogranicznik liczby żądań;
2. parsowanie treści żądania;
3. **zabezpieczenia trasy** — `401` bez sesji, którą trasa akceptuje, `403` bez uprawnienia;
4. walidacja żądania względem schematu trasy — `400 VALIDATION_FAILED`;
5. interceptory API, a potem handler.

Wywołujący, któremu trasa odmawia, dostaje więc `401` albo `403` i nie dowiaduje się niczego o
kształcie żądania, cokolwiek w nim wyśle. Wcześniej jako pierwszy odpowiadał walidator i
nieuwierzytelniony wywołujący mógł odczytać z odpowiedzi `400` nazwy pól i ograniczenia trasy
administracyjnej.

Co to oznacza dla zabezpieczenia, które piszesz samodzielnie: widzi ono `request.params` i
`request.query` w postaci nadanej przez router oraz `request.body` **sparsowane, ale
niezwalidowane** — dowolną wartość JSON, bez konwersji typów i wartości domyślnych. Porównuj to, co
odczytujesz, z tym, czego oczekujesz, a w każdym innym przypadku odmawiaj albo nie zabieraj głosu.
Praca wymagająca zwalidowanego żądania należy do handlera, do
[interceptora API](./api-interceptor.md) albo do haka `preHandler` dodanego przez `addHook` we
własnym zakresie wtyczki; żadne z nich nie jest przenoszone.

**Ta ostatnia możliwość działa teraz po zabezpieczeniach trasy, a wcześniej działała przed nimi.**
Hak `preHandler` dodany przez `addHook` pozostaje w fazie `preHandler`, podczas gdy własne
zabezpieczenia trasy zostały przeniesione przed nią, więc tego, co taki hak zapisuje w żądaniu,
nie ma jeszcze w chwili, gdy odczytuje to zabezpieczenie trasy. Wszystko, od czego zależy
zabezpieczenie trasy, musi zostać ustalone w `onRequest` albo `preValidation` — hak
`addHook('preValidation')` w zakresie wtyczki działa przed zabezpieczeniami tras znajdujących się
w tym zakresie.

Dwie rzeczy nadal odpowiadają przed jakimkolwiek zabezpieczeniem: żądanie odrzucone przez parser
treści (niepoprawny JSON, nieobsługiwany typ zawartości, treść ponad limit) oraz trasa, która
sprawdza sesję wewnątrz handlera, zamiast deklarować zabezpieczenie — schemat takiej trasy jest
walidowany najpierw. Deklaruj zabezpieczenie.

## Dodawanie uprawnienia

Zadeklaruj kod we własnym `manifest.ts` modułu, nadaj mu etykietę we własnych plikach
`i18n/en.json` i `i18n/pl.json` modułu pod kluczem `adminRoles.permission.<code>`, egzekwuj go
literałem `requireAdmin('…')` dokładnie z tym kodem i uruchom:

```bash
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
pnpm --filter backend run check:action-route-permissions
```

Pierwsze polecenie sprawdza obie strony — każdy egzekwowany kod można przyznać i każdy kod, który
można przyznać, jest egzekwowany — a także pokrycie etykietami i deklaracje `requires`. Drugie
odpowiada na pytanie, na które przegląd dwukierunkowy z natury nie może odpowiedzieć: czy kod
zadeklarowany przez akcję palety poleceń to ten sam kod, który jest egzekwowany na trasie tej akcji.

## Uprawnienia organizacji

Uprawnienie organizacji mówi, co **członek organizacji klienta** może zrobić w sklepie: zapełnić
koszyk, zaakceptować koszyk współpracownika, poprosić o ofertę, zobaczyć zamówienia organizacji.
Każda organizacja ma **role**, każdy członek ma dokładnie jedną z nich, a rola to zestaw takich
kodów. Administrator organizacji edytuje role w storefroncie (`/organization/roles`); operator może je
przeglądać i naprawiać w zakładce *Role* organizacji w panelu administracyjnym, mając uprawnienia
administracyjne `organizations:read-roles` i `organizations:manage-roles`.

Role, pamięć podręczna ról, port uprawnień i odmowa należą do `organizations`. **Kody** do niego
nie należą: każdy deklaruje moduł, którego działanie kupującego ten kod chroni.

### Role

| Rola | Rodzaj | Co ma |
| --- | --- | --- |
| *Administrator* | `administrator` | Każdy **obecny** kod, także kody zadeklarowane po utworzeniu roli. Nie można jej edytować, przemianować ani usunąć, i tylko ona ma możliwości zastrzeżone: zarządzanie członkami, zaproszeniami i rolami, zasadę uwierzytelniania dwuskładnikowego organizacji i domyślne ustawienia zakupu jednym kliknięciem na poziomie organizacji. Rola własna ze wszystkimi kodami nadal nie jest administratorem. |
| *Członek* | `member` | Domyślna rola nowego członka. Jej kody można edytować; nie można jej przemianować ani usunąć. Kod zadeklarowany z `memberDefault: true` rola *Członek* ma od chwili, gdy jego moduł zostanie po raz pierwszy zaoferowany organizacji — i nie dostaje go ponownie, gdy administrator zapisze rolę *Członek* bez niego, bez względu na późniejsze wyłączenia i ponowne instalacje modułu (`member_defaults_offered` w wierszu roli). |
| własna | `custom` | Dokładnie te kody, które były zaznaczone przy zapisie. **Nowa rola własna zaczyna bez żadnego kodu**: formularze tworzenia w storefroncie i w panelu administracyjnym otwierają się z odznaczonymi wszystkimi uprawnieniami i nie proponują „skopiuj z innej roli”, a `memberDefault` jest tam co najwyżej podpowiedzią — przyznaje się go tylko roli *Członek*. Rola zapisana bez zaznaczeń na nic nie pozwala. Do 50 w organizacji. |

Obie role predefiniowane tworzy razem z organizacją wyzwalacz w bazie danych, niezależnie od tego,
która ścieżka tworzy organizację.

**Jedyny członek organizacji prywatnej (B2C) ma rolę *Administrator***, na każdej ścieżce, która
umieszcza tam konto — samodzielna rejestracja, logowanie przez zewnętrznego dostawcę tożsamości,
`ensureForCustomerAccount` i odłączenie konta przez operatora. Dzięki temu kupujący B2C może
zrobić wszystko, co może kupujący, bez drugiej reguły. To, czego organizacja prywatna nie może
pokazywać — *Członkowie*, *Role*, *Koszyki do akceptacji*, wiersz z rolą na stronie konta — jest
ukryte, bo organizacja jest prywatna (`organization.isPersonal`), **nigdy na podstawie roli**. Jej
trasy członków i zaproszeń odpowiadają jak każdemu administratorowi; tylko jej trasy ról
odpowiadają `404`.

### Deklarowanie kodu

Moduł deklaruje swoje kody we własnym `manifest.ts`, obok pola `permissions` operatora, którego to
nie zmienia:

```ts
organizationPermissions: [
  {
    code: 'carts.approve',
    label: "Approve and reject colleagues' carts",
    description: 'See the carts of the organization and approve or reject the ones sent for approval.',
    memberDefault: false,
  },
],
```

- **Kod ma postać `<id manifestu>.<działanie>`** małymi literami ze znakiem podkreślenia
  (`ORGANIZATION_PERMISSION_CODE` w `packages/contracts/src/modules.ts`). `defineModuleManifest`
  odrzuca, już przy definicji manifestu, kod spoza przestrzeni nazw modułu i kod zadeklarowany
  dwa razy.
- **`label` i `description` to angielska wartość zastępcza.** Tłumaczenia są we własnych plikach
  `i18n/en.json` i `i18n/pl.json` modułu, pod kluczami `organizationPermissions.<code>.label`
  i `organizationPermissions.<code>.description` — oba klucze, w obu językach.
- **`memberDefault`** decyduje, czy rola *Członek* dostaje kod, gdy jest on oferowany po raz
  pierwszy, jak opisano wyżej. Wybierz `true` dla tego, co każdy kupujący mógł robić, zanim kod
  powstał, żeby dodanie kodu nikomu niczego nie zmieniło.

**Moduł własny lub nakładkowy deklaruje własne kody**, we własnym manifeście i własnej przestrzeni
nazw, dokładnie tak jak moduł rdzenia (zasady konstytucji XIV i XV): moduł nakładkowy w
`backend/src/apps/<deployment>/modules/<id>/` chroni działanie kupującego kodem
`<id>.<działanie>`. Nigdy nie dodaje kodu do manifestu modułu rdzenia i nigdy nie używa cudzego:
kod deklaruje jeden moduł, a jego prefiks mówi który.

Kody deklarowane w tym wydaniu:

| Kod | Deklaruje | Rola *Członek* ma go domyślnie |
| --- | --- | --- |
| `carts.create` | `carts` | tak |
| `carts.approve` | `carts` | nie |
| `carts.order_without_approval` | `carts` | tak |
| `quote_requests.create` | `quote_requests` | tak |
| `shopping_lists.create` | `shopping_lists` | tak |
| `shopping_lists.convert` | `shopping_lists` | tak |
| `quick_order.one_click` | `quick_order` | tak |
| `orders.view_organization` | `orders` | nie |
| `addresses.manage` | `addresses` | tak |
| `returns.create` | `returns` | tak |
| `returns.view_organization` | `returns` | nie |

Strona każdego modułu opisuje, co chronią jego kody.

### Egzekwowanie kodu na trasie

Zabezpieczeniem trasy jest `organizationPermissionPreHandler` z `@endora-commerce/contracts`
(`packages/contracts/src/organization-roles.ts`), deklarowane po `requireCustomer`:

```ts
// W kompozycji modułu: proxy, które rozwiązuje port przy każdym wywołaniu.
const permissions = lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort');

// W jego trasach (`routes.organization.ts` modułu `carts`):
const approver = [requireCustomer, organizationPermissionPreHandler(() => permissions, 'carts.approve')];
app.post('/api/v1/organization/carts/:id/approve', { preHandler: approver }, handler);
```

- **Port jest pobierany przez funkcję, przy każdym żądaniu** — nigdy nie jest zapamiętywany jako
  singleton przy rejestracji.
- **Ocenia się aktora-klienta**, także przy impersonacji: zabezpieczenie buduje podmiot z
  `request.actor` (`customerAccountId`, `organizationId`, `organizationRoleId`) i wywołuje
  `assert` w języku odpowiedzi.
- **`guests`** decyduje, co dzieje się z żądaniem bez klienta. `'refuse'`, wartość domyślna,
  odpowiada `401 UNAUTHORIZED`. `'pass'` przepuszcza je **bez oceny** i służy tylko trasom, które
  dziś przyjmują gościa: trasom pozycji i kuponu koszyka gościa w `carts`. Niezalogowany
  odwiedzający zachowuje koszyk gościa dokładnie tak jak przed wprowadzeniem ról.
- **Działanie złożone to dwa zabezpieczenia**, nigdy jeden połączony kod: zamiana listy zakupów w
  koszyk to `shopping_lists.convert`, a potem `carts.create`, a odmowa wskazuje pierwszy
  brakujący.
- **Działanie „jedno z dwóch” to zabezpieczenie lokalne modułu.** Import szybkiego zamówienia
  pokazuje podgląd pliku, który może stać się koszykiem albo zapytaniem ofertowym, więc wystarczy
  mu `carts.create` **albo** `quote_requests.create`. `importPermissionPreHandler` w
  `routes.ts` modułu `quick_order` buduje podmiot tak samo jak wspólne
  zabezpieczenie, pyta `can` o każdy kod po kolei, a gdy żaden nie jest przyznany, wywołuje
  `assert` z pierwszym z nich, więc odmowa zachowuje swoją jedną postać. Budowanie, które
  następuje potem, ocenia się wyłącznie według jego celu.

Odmowa wszędzie wygląda tak samo:

```json
HTTP/1.1 403
{ "error": {
    "code": "ORGANIZATION_PERMISSION_REQUIRED",
    "message": "Your role does not allow this: “Create quote requests”.",
    "details": { "permission": "quote_requests.create", "permissionLabel": "Create quote requests" } } }
```

Różni się od `401` (brak zalogowania), `503 MODULE_DISABLED` (moduł jest wyłączony; jego własny
punkt rozszerzenia odpowiada pierwszy) i `404`. **Na zasięg odpowiada się `404`, a nie `403`:**
zamówienie współpracownika bez `orders.view_organization`, rola innej organizacji, zgłoszenie,
którego członek nie może zobaczyć — każde odpowiada jak identyfikator, który nie istnieje (zasada
konstytucji XI).

### Pytanie wewnątrz serwisu

`organizationPermissionPort` (właściciel: `organizations`) odpowiada na pytania, na które nie może
odpowiedzieć zabezpieczenie trasy:

| Metoda | Zastosowanie |
| --- | --- |
| `can(subject, code)` | Tak/nie dla wezwania do działania albo poszerzonego odczytu, np. czy lista zamówień obejmuje zamówienia współpracowników |
| `assert(subject, code, { language })` | Odmowa zabezpieczenia, zgłoszona z wnętrza serwisu — tak budowanie szybkiego zamówienia ocenia cel podany w treści żądania |
| `isAdministrator(subject)` | Możliwości zastrzeżone, które zależą od **rodzaju** roli, a nie od kodu |
| `effective(subject)` | Rola członka i posortowane obecne kody — to, co widoki sesji zwracają jako `permissions` |
| `rolesHolding(organizationId, code)` | Identyfikatory ról, których efektywny zestaw zawiera kod, łącznie z *Administratorem* — np. kto dostaje e-mail „koszyk wysłany do akceptacji” |

`organizationRoleReadPort` odpowiada na pytania o role: `predefinedRoleId(organizationId, kind)`
zwraca rolę *Administrator* albo *Członek* organizacji, `findRole` i `roleRef` — rolę wskazaną
identyfikatorem (`null` dla roli innej organizacji). Czyta zatwierdzone wiersze; wywołujący, który
właśnie utworzył organizację we własnej otwartej transakcji, bierze identyfikator roli
*Administrator* z odpowiedzi tworzenia organizacji.

Do obu portów dochodzi się przez `lazyPort` z nazwą podaną literałem. Podmiot, którego roli nie
można znaleźć, jest odrzucany w razie wątpliwości (fail-closed): `can` i `isAdministrator`
odpowiadają `false`, `effective` — pustym zestawem. Kod spoza słownika to błąd programisty: `can`
odpowiada `false`, `assert` zgłasza `500`. Roll-up (logowanie centrali działające w całym jej
poddrzewie) poszerza zasięg kodu; nigdy nie dodaje kodu.

Zmiany ról obowiązują od następnego żądania członka. Każdy proces przechowuje role organizacji w
pamięci podręcznej najwyżej 30 sekund i usuwa wpis, gdy którykolwiek proces ogłosi zmianę;
przypisań ról się nie przechowuje.

### Argumenty kodu, które inwentarz potrafi odczytać

`backend/test/contract/admin_users/permission-inventory.test.ts` sprawdza słownik organizacji tym
samym dwukierunkowym przeglądem co słownik administracyjny (blok `[organization-permissions]`;
skaner to `backend/test/helpers/organization-permissions.ts`). Czyta każde
`organizationPermissionPreHandler(…, code)` i każde wywołanie metody `can`, `assert` i
`rolesHolding` w pliku, który wymienia port — w modułach rdzenia, pakietach modułów i aktywnej
nakładce — i zgłasza:

| Wynik | Znaczenie |
| --- | --- |
| `cross-vocabulary` | string zadeklarowany jednocześnie jako kod administracyjny i kod organizacji |
| `foreign-declarer` | kod, którego prefiks nie jest modułem, który go deklaruje |
| `undeclared-check` | kod wskazany przez zabezpieczenie lub wywołanie portu, którego nie deklaruje żaden manifest |
| `unchecked-declaration` | zadeklarowany kod, którego nic nie egzekwuje — nadanie, które niczego nie nadaje |
| `missing-label` / `split-label` | kod bez etykiety lub opisu po angielsku albo z nimi w jednym dostarczanym języku, a bez nich w drugim |
| `unresolved-argument` | argument kodu, którego skaner nie potrafi odczytać |

**Zapisuj więc argument kodu w postaci, którą skaner rozwiązuje**: literał stringa; `const`
lokalny modułu przypisany do literału; `const` w pliku importowanym ścieżką względną; albo
składowa `NAZWA.klucz` obiektu `const` z takimi stringami. Kod obliczany w czasie działania,
importowany przez specyfikator pakietu albo zbudowany z szablonu z interpolacją to
`unresolved-argument` i test kończy się błędem. Implementacja, która przekazuje dalej własny
parametr o określonym typie (`assert` portu wywołujący `this.can(subject, code)`), to wartość czasu
działania, a nie miejsce egzekwowania; sprawdzany jest wtedy wywołujący. Uruchom:

```bash
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
```

### W storefroncie

`storefront/lib/organization-permissions.ts` to jedyne miejsce, w którym storefront odczytuje rolę:
`can(session, code)` dla działania kupującego i `isAdministrator(session)` dla ekranów zarządzania
organizacją, na podstawie `permissions` i `organizationRole`, które zwraca `GET /api/v1/me`. Obie
funkcje służą **wyłącznie prezentacji** — granicą są zabezpieczenia backendu, a pokazane działanie,
które serwer odrzuca, to bezpieczny sposób zawodzenia. To, czego członkowi brakuje, jest ukryte
albo nieaktywne, albo strona wyjaśnia to w jednym zdaniu („Twoja rola nie pozwala zmieniać
koszyka…”). Niezalogowanego odwiedzającego się nie ocenia: dodawanie do koszyka i edycja koszyka
pozostają dostępne. `storefront/lib/commerce-permissions.ts` zapisuje reguły zakupowe w jednym
miejscu na podstawie `can`; `storefront/lib/account/organization-area.ts` decyduje o ekranach
*Członkowie*, *Role* i *Koszyki do akceptacji* — według roli i według `isPersonal`.

### Gdy moduł jest wyłączony

Kod, którego moduł deklarujący nie jest obecny — na którejkolwiek osi: dostępności w platformie
albo aktywacji przez operatora — **znika z katalogu**: edytory ról go nie pokazują, nikt go nie ma
(także *Administrator*) i nie ma go w `permissions` żadnego członka. **Nadania są zachowywane.**
Zapis nie może usunąć tego, czego edytor nie mógł pokazać, więc gdy moduł wraca, każda rola ma
dokładnie to, co miała wcześniej. Trasy samego modułu odpowiadają w tym czasie
`503 MODULE_DISABLED`. Kod, którego nie deklaruje już żaden zainstalowany moduł — bo jego moduł
odinstalowano — jest pomijany przy odczycie i usuwany z roli przy jej następnym zapisie.

### Reguła dla autorów modułów: na zgłoszeniu zwrotu działa tylko zgłaszający

`returns.view_organization` pozwala członkowi **czytać** zwroty i reklamacje współpracowników;
nigdy nie pozwala na nich działać. Komentowanie, dołączanie plików, wybór metody dostawy zwrotu i
anulowanie pozostają przy członku, który zgłoszenie złożył, bez względu na uprawnienia
kogokolwiek innego.

Każda przyszła kontrolka na zgłoszeniu zwrotu — nowe działanie następcze, rodzaj załącznika, opcja
dostawy, sposób wycofania — musi stosować tę samą regułę:

- **Backend:** wyszukuj zgłoszenie po `{ id, customerAccountId }` wywołującego, tak jak robią to
  istniejące serwisy działań następczych, i każdemu innemu odpowiadaj `404 NOT_FOUND`. Nie
  poszerzaj tego przez zasięg odczytu modułu `returns` (`return-case-scope.ts`), który służy tylko
  liście i szczegółom.
- **Storefront:** pokazuj kontrolkę tylko wtedy, gdy
  `filedByColleague(case.customerAccountId, viewerId)` zwraca fałsz
  (`storefront/lib/returns/returnForm.ts`); na zgłoszeniu współpracownika strona szczegółów
  pokazuje zamiast niej jednozdaniową informację, że zgłoszenie jest tylko do odczytu.

Nowy kod, który pozwalałby komuś działać na zgłoszeniu współpracownika, to decyzja produktowa, a
nie szczegół implementacji: najpierw rozstrzygnij go w specyfikacji.

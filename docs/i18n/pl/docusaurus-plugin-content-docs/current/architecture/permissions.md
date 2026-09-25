---
title: Uprawnienia — trzy pojęcia i to, na które patrzysz
---

# Uprawnienia

Uprawnienie admin w tej platformie to kod, a do kodu są przypięte **trzy odrębne
pojęcia**. Tylko jedno z nich kiedyś było widoczne gdziekolwiek, i dlatego ta strona
istnieje: czytelnik, który widzi `module: 'quote_requests'` na
`rfqs:handle`, słusznie wnioskuje, że `quote_requests` jest jedyną rzeczą decydującą,
czy kod tam jest. Ten wniosek jest wystarczająco często błędny, by wywołać
wysłany defekt; audyt znalazł pięć takich przypadków.

## 1. `module` — grupowanie do wyświetlania

`module` to nagłówek, pod który edytor ról składa kod. Nic więcej.

**Nie** jest gwarantowane, że to id modułu: `_lifecycle` deklaruje swoje kody pod
`module: 'module_lifecycle'`, co nie nazywa żadnego modułu w żadnym wdrożeniu. Filtrowanie
czegokolwiek po `module` usuwa więc uprawnienia lifecycle z każdej
platformy, która to próbuje.

## 2. `owners` — czyja obecność utrzymuje kod nadającym do grantu

`owners` to **zbiór** modułów deklarujących kod. `/admin-roles` oferuje
kod, dopóki **którykolwiek** właściciel jest skutecznie obecny — obie osie obecności
modułu, dostępność platformy *i* aktywacja operatora.

To zbiór, bo kod może być współdzielony. `integrations:manage` bramkuje powierzchnię admin
kluczy API i webhooks, a oba `api_keys` i `webhooks`
go deklarują; wyłączenie `webhooks` nie może zabrać własnej bramki ekranu kluczy API
z edytora ról. Współdeklaracja to mechanizm i naprawa modułu, który egzekwuje kod
należący do innego modułu — patrz *foreign gates* poniżej.

`owners` i `module` to różne stringi, a traktowanie ich jako jednego to defekt
czekający na wystąpienie. Oba są na wire na `GET /api/v1/admin/permissions`, a
edytor ról pokazuje zbiór właścicieli wszędzie tam, gdzie mówi coś, czego grupowanie
nie mówi.

## 3. Słownik i nadający zbiór w jego wnętrzu

Dwa pytania, celowo odpowiadane inaczej:

| Pytanie | Metoda | Filtrowane obecnością |
| --- | --- | --- |
| Co operator może **nowo nadać**? | `listAssignable()` | tak |
| Jakie kody platforma **zna**? | `listKnownCodes()` | nie |

Upsert roli waliduje względem **słownika**, nigdy zbioru nadającego, a
różnica utrzymuje prawdziwe *„wyłączenie modułu jest niedestrukcyjne i
odwracalne”*. Rola „Editor” trzyma `blog.read`; operator wyłącza
`blog`, a potem zmienia nazwę roli. Walidacja przesłanej listy względem zbioru nadającego
odpowiedziałaby `400 Unknown permission(s): blog.read` — więc operator
albo traci rolę, albo cicho zrzuca grant, który musi wrócić, gdy
`blog` wróci. Grant jest tymczasowo nieszkodliwy: trasy za nim odpowiadają
`503 MODULE_DISABLED` na własnym szwie.

Edytor ról polega na tym. Seeduje wybór z kodów **roli**
i renderuje checkbox tylko dla tych, które oferuje katalog, więc grant nieobecnego
modułu przeżywa round trip bez checkboxa do odznaczenia.

`PermissionCatalogueService`
(`packages/modules/admin_roles/src/backend/services/permission-catalogue.service.ts`)
to miejsce, gdzie wszystkie trzy pojęcia są scalane, i jedyne takie miejsce.

## Foreign gates: egzekwowanie kodu, którego nie posiadasz

Moduł może egzekwować kod uprawnienia należący do innego modułu. Nic nie deklaruje
tego sprzężenia, a koszt jest jednokierunkowy: obecność właściciela decyduje,
czy kod jest oferowany, więc wyłączenie właściciela zabiera kod z
`/admin-roles`, podczas gdy trasy konsumenta — jeśli konsumenta nie da się wyłączyć
razem z nim — nadal go egzekwują. Ekran stoi za uprawnieniem,
którego nikt nie może dostać.

To **wyprowadzone, nie zadeklarowane**. `backend/test/helpers/foreign-gates.ts` czyta
każde miejsce egzekwowania, które rozwiązuje inventory uprawnień, i każdy manifest, i
klasyfikuje każdą parę; każdy werdykt wychodzi z manifestów przy każdym przebiegu, więc
cofnięcie `nonDeactivatable` modułu ponownie otwiera każdy finding, który
na tym spoczywał, w tym samym pipeline, bez ledgera do edycji.

Trzy naprawy, w kolejności sięgania:

1. **Konsument bramkuje kod, który posiada.** Zastosuj test etykiety: czy etykieta kodu
   brzmi jak zdanie o własnym ekranie konsumenta? *„Handle quote requests”* nie jest zdaniem
   o endpoincie rozwiązywania ceny, więc
   `price_lists` bramkuje tę trasę przez `price_lists:read`.
2. **Oba moduły deklarują kod**, czyniąc konsumenta drugim właścicielem, więc kod
   przeżywa, dopóki któraś powierzchnia jest włączona. To kształt, którego `api_keys` i
   `webhooks` już używają.
3. **Zadeklaruj właściciela w `dependencies`** — ostatnie i zwykle błędne. Konsument,
   którego nie da się wyłączyć, deklarując właściciela, którego da się wyłączyć, sprawia, że
   orchestrator lifecycle odmawia wyłączenia tego właściciela w ogóle: reguła
   przełączalności modułów odwrócona,
   zdecydowana cudzym manifestem.

## Zadeklarowane zależności: `requires`

Deklaracja uprawnienia może nazwać inne kody potrzebne roli, która je trzyma:

```ts
permissions: [
  { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
],
```

To **doradcze i nic nie kosztuje w runtime**. Żaden guard tego nie czyta, żaden upsert nie jest
odmawiany i to nie jest krawędź lifecycle — nie wkłada żadnego modułu w czyjeś
`dependencies`. To stawia zdanie tam, gdzie operator może je przeczytać:
edytor ról pokazuje brak dla aktualnie zaznaczonych kodów, z jednoklikowym
dodaniem, a rola zapisana bez nich jest zapisana.

Przykład powyżej jest prawdziwy. `RfqCreatePage` prefilla uzgodnioną cenę z trasy
`price_lists`, celowo zabramkowanej przez `price_lists:read`, więc rola
trzymająca tylko `rfqs:handle` traci prefill i wraca do ręcznego wpisu.
To zdanie było napisane w rulingu, w komentarzu trasy i w seedzie, i w
niczym, co operator mógł przeczytać.

**Nie pisz tu faktu wyprowadzonego.** *Moduł egzekwuje kod, którego nie posiada*
to pytanie poprzedniej sekcji, wyprowadzone z gate'ów i
manifestów, a deklarowanie tego w manifeście byłoby dwiema odpowiedziami na jedno
pytanie czekającymi na rozjazd. `requires` niesie coś, czego żaden instrument w tym
repozytorium nie wyliczy: sprzężenie od własnych fetchy ekranu admin
do trasy innego modułu, plus osąd, czy rola bez drugiego kodu jest zepsuta, czy tylko
degradowana w sposób, który ktoś zaakceptował.

Co *jest* sprawdzane maszynowo, to że wymaganie nazywa kod, który słownik platformy
trzyma — literówka albo kod, którego właściciel zmienił nazwę, inaczej doradzałby operatorowi
wiecznie nadać coś, co nie istnieje. To
`backend/test/contract/admin_users/permission-inventory.test.ts`, w tym samym
pliku co dwukierunkowy sweep inventory, bo inventory już czyta każdy kod manifestu, a dwie
derivacje jednej populacji to dwie odpowiedzi czekające na rozjazd.

Kod deklarowany przez więcej niż jeden moduł bierze **unię** wymagań deklaratorów:
współdzielony kod otwiera więcej niż jedną powierzchnię, każda z własnymi potrzebami,
a doradzanie więcej to kierunek, który nie może nikogo zostawić w pułapce.

## Dodawanie uprawnienia

Zadeklaruj kod we własnym `manifest.ts` modułu, oetykietuj go we własnym
`i18n/en.json` i `i18n/pl.json` modułu pod `adminRoles.permission.<code>`, egzekwuj go
literałem `requireAdmin('…')` dokładnie pasującym, i uruchom

```bash
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
pnpm --filter backend run check:action-route-permissions
```

Pierwsze przeszukuje obie strony — każdy egzekwowany kod jest nadający, każdy
nadający kod jest egzekwowany — plus pokrycie etykiet i deklaracje `requires`.
Drugie odpowiada na pytanie, na które dwukierunkowy sweep strukturalnie nie może:
czy kod deklarowany przez akcję palety to ten egzekwowany na własnej trasie
tej akcji.

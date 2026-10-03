---
title: Uprawnienia — trzy pojęcia i które z nich właśnie widzisz
---

# Uprawnienia

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

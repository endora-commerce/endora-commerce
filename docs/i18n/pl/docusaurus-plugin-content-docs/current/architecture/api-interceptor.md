---
title: Przechwytywacz API (rozszerzenie endpointu między modułami)
---

# Przechwytywacz API

Mechanizm API Interceptor (feature `060`) pozwala modułowi dołączyć zachowanie do endpointu HTTP
**należącego do innego modułu** — zablokować żądanie przed uruchomieniem handlera
albo przekształcić udane odpowiedzi — bez edycji modułu docelowego ani
wspólnego pliku rejestru (Zasada I Konstytucji: interakcja między modułami idzie
wyłącznie przez udokumentowane interfejsy). Sięgnij po niego, gdy trzeba *rozszerzyć*
endpoint w miejscu; sięgnij po [wzorzec overlay](./overlay-pattern.md), gdy wdrożenie musi
*zastąpić* całą jednostkę (serwis, trasę, moduł); sięgnij po procesowy `EventBus`, gdy
wystarczy *zareagować po fakcie*, a samo żądanie/odpowiedź nie może się zmienić.

## Co przechwytywacz może zrobić — i co jest gwarantowane

- **Pozycja w cyklu życia** — przechwytywacz `pre` uruchamia się po własnych
  strażnikach `preHandler` trasy (`requireAdmin` / `requireCustomer` / sprawdzenia klucza API) i
  po walidacji Zod, tuż przed handlerem. Przechwytywacz `post` uruchamia się w
  `preSerialization`, tylko dla udanych odpowiedzi (`statusCode < 400`).
- **Kontekst ambientowy** — przechwytywacze wykonują się w tym samym ambientowym
  `TenantContext` (Zasada XI) i widzą rozwiązany kanał sprzedaży
  (Zasada XII) tak jak sam endpoint; serwisy wywołane z przechwytywacza
  mają identyczny zakres jak serwisy wywołane z handlera.
- **Deterministyczna kolejność** — w obrębie jednego endpointu i fazy przechwytywacze działają
  rosnąco według `order` (domyślnie `0`), remisy łamane leksykograficznie według
  `(module, id)`. Kolejność jest identyczna po restarcie i niezależna od
  kolejności okablowania kompozycji.
- **Gating cyklu życia** — przed każdym wykonaniem dyspozytor konsultuje
  zbiór włączonych modułów; przechwytywacz, którego moduł właścicielski jest wyłączony, jest pomijany
  po cichu i wznawia działanie po ponownym włączeniu modułu.
- **Walidacja startu fail-closed** — każdy cel jest sprawdzany względem żywej
  tabeli tras w `onReady`, przed jakimkolwiek ruchem. Nieznany cel (literówka, trasa
  niezamontowana w tym wdrożeniu), przechwytywacz `post` na endpointzie strumieniowym
  albo duplikat `(module, id)` **blokuje start** z błędem wymieniającym
  moduł, id przechwytywacza i cel. Rejestracja po `app.ready()`
  rzuca wyjątek — indeks dyspozytora jest zapieczętowany.
- **Atrybucja** — każde wykonanie i każda awaria są logowane przez logger potomny
  wstępnie powiązany z `{interceptorModule, interceptorId, phase, interceptorTarget}`,
  więc operator zawsze odróżni zachowanie endpointu od zachowania przechwytywacza.

Endpointy bez zarejestrowanych przechwytywaczy płacą jedno wyszukanie w `Map` — nic więcej.

## Anatomia rejestracji

Moduł rejestruje przechwytywacze przez `ctx.interceptors(...)`, które stempluje
`module` z własnego id modułu — nigdy przez import wewnętrzności innego modułu
ani ręcznie wpisaną nazwę modułu. To ten sam szew dla modułu rdzeniowego i dla
modułu overlay per wdrożenie: od D-103 moduł overlay jest komponowany przez kontener kernela
dokładnie jak moduł rdzeniowy, więc uchwyt
`OverlayModuleContext.apiInterceptors`, który opisywała ta strona, już nie istnieje. Rejestracja następuje podczas
kompozycji, we własnym kodzie modułu wnoszącego:

```ts
apiInterceptors.register({
  module: 'loyalty',                 // owning module id — lifecycle-gates execution
  id: 'enrich-order-detail',         // unique within the module, kebab-case
  target: 'GET /api/v1/orders/:id',  // endpoint identity; string or string[]
  phase: 'post',                     // 'pre' | 'post'
  order: 100,                        // ascending; default 0
  handler,                           // phase-specific signature
});
```

**Tożsamość endpointu** to string `"<METHOD> /path/pattern"` z parametrami
w formie `:param` — np. `POST /api/v1/orders`,
`GET /api/v1/admin/orders/:id`. To ten sam klucz, po którym auto-rejestracja OpenAPI
deduplikuje, więc istnieje dla każdego endpointu bez retrofitu i jest tak
stabilny jak samo API: zmiana URL to wersjonowana zmiana łamiąca
(Zasada II).

## Dwie fazy

**Pre** — obserwuje *zwalidowane* dane żądania (`body`, `query`, `params`,
po Zod) plus widok żądania tylko do odczytu (`actor`, `salesChannel`, nagłówki,
logger atrybucji). Może dostosować body żądania, mutując `ctx.body` albo
zwracając `{ body }`, i może **wetować** żądanie, rzucając
`HttpError(status, code, message, details?)` ze zarejestrowanym `ErrorCode` z
`@endora-commerce/contracts` — handler wtedy nigdy się nie uruchamia.

**Post** — otrzymuje niezserializowany `payload` odpowiedzi (oraz
`statusCode`, zawsze `< 400`). Zwróć zastępczy payload albo `undefined`, aby
zostawić go bez zmian. Przechwytywacze post **nigdy nie działają na odpowiedziach błędu**, a
przekształcony payload musi pozostać zgodny z opublikowanym kontraktem odpowiedzi endpointu.

## Weto vs. nieoczekiwana awaria

- **Weto** (tylko pre) to normalny wynik biznesowy: rzucony `HttpError`
  renderuje się przez standardową kopertę błędu dokładnie jak błąd biznesowy endpointu,
  z wybranym statusem i kodem, i jest logowany na `info` —
  nie jako awaria. Komunikaty weta przechodzą przez most i18n koperty błędu
  jak każdy błąd modułu: czytelny dla człowieka `message` może być zlokalizowany do
  preferowanego języka wywołującego, podczas gdy `code` i `details` są zachowane
  dosłownie.
- **Nieoczekiwana awaria** (dowolny rzut inny niż `HttpError`, obie fazy) to
  fail-closed: logowana na `error` z pełną atrybucją i ponownie rzucana,
  dając standardową kopertę `500 INTERNAL`. Mechanizm nigdy nie pomija
  zawieszonego przechwytywacza i nie kontynuuje.

## Strażniki i cele poza zakresem

- **Auth jest nietykalne** — przechwytywacze działają dopiero *po* strażnikach auth/authz
  trasy. Mogą zawęzić dostęp (weto), nigdy go poszerzyć.
- **Odpowiedzi błędu nigdy nie są mutowane** — przechwytywacze post nie działają dla
  `statusCode >= 400`, w tym kopert produkowanych przez handler błędów.
- **Przechwytywacze post MUSZĄ być wolne od efektów ubocznych persystencji** — własny zapis endpointu
  może być już zatwierdzony, gdy działa przechwytywacz post, więc awaria fazy post nie może go wycofać. Wszystko transakcyjne należy do przechwytywacza pre,
  Command albo subskrybenta EventBus.
- **Przechwytywacze pre nie mogą same flushować stanu trwałego** — weto
  gwarantuje „nic nie zapisano” tylko wtedy, gdy sam przechwytywacz nic nie zapisał.
- **Brak zastępowania lub tłumienia handlera** — przechwytywacz nie może podmienić ani
  obejść implementacji endpointu. Zastępowanie całej jednostki to zadanie
  [wzorca overlay](./overlay-pattern.md).
- **Łańcuchowe korekty to last-writer-wins** — późniejsze przechwytywacze widzą korekty body/payload
  wcześniejszych, w kolejności wykonania.
- **Latencja to odpowiedzialność autora** — czas przechwytywacza to czas żądania;
  timeout żądania platformy obejmuje cały łańcuch.
- **Tylko granica HTTP** — wewnętrzne wywołania serwis-serwis, joby w tle
  i zdarzenia EventBus *nie* są przechwytywane. Tylko żądania przekraczające powierzchnię HTTP
  uruchamiają przechwytywacze.
- **Endpointy strumieniowe/binarne odrzucają fazę post** — trasy oznaczone
  `config: { streamingResponse: true }` (PDF/assety, eksport CSV)
  omijają serializację; przechwytywacz post celujący w taki endpoint nie przejdzie walidacji startu.

## Przykład w praktyce

Moduł `compliance` blokuje składanie zamówienia na endpoincie innego modułu
(pre + weto), a moduł `loyalty` wzbogaca szczegóły zamówienia (post):

```ts
// compliance/plugin.ts — pre-gate with veto
apiInterceptors.register({
  module: 'compliance',
  id: 'sanctions-gate',
  target: 'POST /api/v1/orders',
  phase: 'pre',
  handler: async ({ request, body }) => {
    const verdict = await screening.check(request.raw.actor);
    if (!verdict.ok) {
      throw new HttpError(422, ERROR_CODES.COMPLIANCE_SCREENING_FAILED, 'Order blocked by screening');
    }
    (body as PlaceOrderRequest).metadata = {
      ...(body as PlaceOrderRequest).metadata,
      screeningId: verdict.id,
    };
  },
});

// loyalty/plugin.ts — post-enrichment
apiInterceptors.register({
  module: 'loyalty',
  id: 'enrich-order-detail',
  target: 'GET /api/v1/orders/:id',
  phase: 'post',
  order: 100,
  handler: async ({ payload }) => ({
    ...(payload as object),
    loyaltyPoints: await points.forOrder(payload),
  }),
});
```

Nieudany screening zwraca standardową kopertę z kodem `compliance`
i **nie powstaje wiersz zamówienia**; `404` z trasy szczegółów zamówienia nie niesie
`loyaltyPoints` (post nigdy nie działa na błędach); wyłączenie modułu `loyalty`
przywraca oryginalny kształt odpowiedzi.

## Diagnostyka

```
GET /api/v1/admin/api-interceptors      (permission: platform.modules.read)
```

zwraca każdą rejestrację — cel, fazę, order, moduł, id — posortowaną w
kolejności wykonania (cel, potem `pre` przed `post`, potem order/remis), z
`moduleEnabled` rozwiązanym na żywo ze zbioru włączonych w momencie żądania. Lista
*jest* planem wykonania. Tylko odczyt: rejestracje to kod modułu wysyłany z buildem, nie
dane runtime, więc nie ma powierzchni zapisu.

## To nie moduł webhooks

Nie myl tego mechanizmu z modułem `webhooks`: webhooks dostarczają
zdarzenia platformy *wychodząco* do zewnętrznych konsumentów HTTP po fakcie; przechwytywacze API
działają *przychodząco*, wewnątrz własnego cyklu żądanie/odpowiedź platformy.

Pełny kontrakt jest w specyfikacji, planie i quickstartcie pod `specs/060-api-interceptor/`.

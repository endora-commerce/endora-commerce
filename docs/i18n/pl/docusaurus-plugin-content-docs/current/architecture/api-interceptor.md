---
title: Interceptory API (rozszerzanie endpointów innych modułów)
---

# Interceptory API

Mechanizm interceptorów API pozwala modułowi dodać zachowanie do endpointu HTTP **należącego do
innego modułu** — zablokować żądanie, zanim wykona się handler, albo przekształcić udaną
odpowiedź — bez zmieniania modułu docelowego i bez edycji jakiegokolwiek wspólnego pliku rejestru:
moduły komunikują się wyłącznie przez udokumentowane interfejsy. Sięgnij po interceptor, gdy
trzeba *rozszerzyć* istniejący endpoint; po dekorację przez [wzorzec nakładki](./overlay-pattern.md),
gdy wdrożenie musi zmienić działanie usługi — opakowując ją, nigdy jej nie zastępując; a po
działającą w procesie szynę zdarzeń `EventBus`, gdy wystarczy *zareagować po fakcie*, a samo
żądanie i odpowiedź nie mogą się zmienić.

## Co może interceptor — i co jest gwarantowane

- **Miejsce w obsłudze żądania** — interceptor `pre` wykonuje się po własnych zabezpieczeniach
  `preHandler` trasy (`requireAdmin` / `requireCustomer` / sprawdzenie klucza API) i po walidacji
  Zod, tuż przed handlerem. Interceptor `post` wykonuje się w `preSerialization` i tylko dla udanych
  odpowiedzi (`statusCode < 400`).
- **Ten sam kontekst** — interceptory działają w tym samym kontekście `TenantContext` i widzą ten
  sam rozstrzygnięty kanał sprzedaży co endpoint; usługi wywołane z interceptora mają dokładnie
  taki sam zakres jak usługi wywołane z handlera.
- **Deterministyczna kolejność** — w obrębie jednego endpointu i jednej fazy interceptory
  wykonują się rosnąco według `order` (domyślnie `0`), a remisy rozstrzyga porządek
  leksykograficzny `(module, id)`. Kolejność jest taka sama po restarcie i nie zależy od kolejności
  kompozycji modułów.
- **Zależność od cyklu życia** — przed każdym wykonaniem mechanizm sprawdza zbiór włączonych
  modułów; interceptor modułu, który jest wyłączony, jest po cichu pomijany i zaczyna znowu
  działać po ponownym włączeniu modułu.
- **Walidacja przy starcie, odmawiająca w razie wątpliwości** — w `onReady`, zanim pojawi się
  jakikolwiek ruch, każdy cel jest porównywany z aktualną tabelą tras. Nieznany cel (literówka,
  trasa niezamontowana w tym wdrożeniu), interceptor `post` na endpoincie strumieniowym albo
  powtórzona para `(module, id)` **blokują start** błędem wskazującym moduł, identyfikator
  interceptora i cel. Rejestracja po `app.ready()` rzuca wyjątek — indeks interceptorów jest już
  zamknięty.
- **Jednoznaczne przypisanie** — każde wykonanie i każdy błąd są zapisywane w logu przez logger
  potomny z dołączonymi polami `{interceptorModule, interceptorId, phase, interceptorTarget}`, więc
  operator zawsze odróżni zachowanie endpointu od zachowania interceptora.

Endpoint bez zarejestrowanych interceptorów kosztuje jedno wyszukanie w `Map` — nic więcej.

## Budowa rejestracji

Moduł rejestruje interceptory przez `ctx.interceptors(...)`, które samo uzupełnia `module`
identyfikatorem tego modułu — nigdy przez import wnętrza innego modułu i nigdy z ręcznie wpisaną
nazwą modułu. To ten sam punkt rozszerzenia dla modułu rdzenia i dla modułu nakładkowego wdrożenia:
moduł nakładkowy jest składany przez kontener jądra dokładnie tak jak moduł rdzenia, więc obiekt
`OverlayModuleContext.apiInterceptors`, który ta strona kiedyś opisywała, już nie istnieje.
Rejestracja odbywa się podczas kompozycji, we własnym kodzie modułu, który dodaje interceptor:

```ts
ctx.interceptors([
  {
    id: 'enrich-order-detail',         // unique within the module, kebab-case
    target: 'GET /api/v1/orders/:id',  // endpoint identity; string or string[]
    phase: 'post',                     // 'pre' | 'post'
    order: 100,                        // ascending; default 0
    handler,                           // phase-specific signature
  },
]);                                    // `module` is stamped from this module's id
```

**Identyfikator endpointu** to string `"<METHOD> /path/pattern"` z parametrami w postaci `:param` —
np. `POST /api/v1/orders`, `GET /api/v1/admin/orders/:id`. Po tym samym kluczu automatyczna
rejestracja OpenAPI usuwa duplikaty, więc istnieje on dla każdego endpointu bez żadnych zmian i
jest tak stabilny jak samo API: zmiana adresu URL to wersjonowana zmiana niezgodna wstecz.

## Dwie fazy

**Pre** — widzi *zwalidowane* dane żądania (`body`, `query`, `params`, po walidacji Zod) oraz widok
żądania tylko do odczytu (`actor`, `salesChannel`, nagłówki, logger z przypisaniem). Może zmienić
treść żądania, modyfikując `ctx.body` albo zwracając `{ body }`, i może **zablokować** żądanie,
rzucając `HttpError(status, code, message, details?)` z zarejestrowanym `ErrorCode` z
`@endora-commerce/contracts` — handler wtedy w ogóle się nie wykonuje.

**Post** — otrzymuje niezserializowaną treść odpowiedzi `payload` (oraz `statusCode`, zawsze
`< 400`). Zwróć nową treść albo `undefined`, aby zostawić ją bez zmian. Interceptory post **nigdy
nie działają na odpowiedziach z błędem**, a przekształcona treść musi pozostać zgodna z
opublikowanym kontraktem odpowiedzi endpointu.

## Blokada a nieoczekiwany błąd

- **Blokada** (tylko faza pre) to zwykły wynik biznesowy: rzucony `HttpError` jest zwracany w
  standardowej strukturze błędu, dokładnie tak jak błąd biznesowy samego endpointu, z wybranym
  statusem i kodem, i trafia do logu na poziomie `info` — nie jako awaria. Komunikaty blokady
  przechodzą przez tłumaczenie błędów jak każdy błąd modułu: czytelny dla człowieka `message`
  może zostać przetłumaczony na preferowany język wywołującego, a `code` i `details` pozostają bez
  zmian.
- **Nieoczekiwany błąd** (dowolny wyjątek inny niż `HttpError`, w obu fazach) powoduje odmowę:
  trafia do logu na poziomie `error` z pełnym przypisaniem i jest rzucany dalej, co daje
  standardową odpowiedź `500 INTERNAL`. Mechanizm nigdy nie pomija interceptora, który zawiódł, i
  nie kontynuuje bez niego.

## Zabezpieczenia i to, co jest poza zasięgiem

- **Uwierzytelniania nie da się ominąć** — interceptory działają dopiero *po* zabezpieczeniach
  uwierzytelniania i autoryzacji trasy. Mogą zawęzić dostęp (blokadą), ale nigdy go poszerzyć.
- **Odpowiedzi z błędem nigdy nie są zmieniane** — interceptory post nie działają dla
  `statusCode >= 400`, w tym dla odpowiedzi tworzonych przez obsługę błędów.
- **Interceptory post NIE MOGĄ niczego trwale zapisywać** — gdy działa interceptor post, własny
  zapis endpointu może być już zatwierdzony, więc błąd w fazie post nie może go wycofać. Wszystko,
  co wymaga transakcji, należy do interceptora pre, polecenia (Command) albo subskrybenta
  `EventBus`.
- **Interceptory pre nie mogą same zatwierdzać zmian w bazie** — blokada gwarantuje, że „nic nie
  zapisano”, tylko wtedy, gdy sam interceptor niczego nie zapisał.
- **Nie da się zastąpić ani pominąć handlera** — interceptor nie może podmienić implementacji
  endpointu ani jej obejść, i nie może tego zrobić nic innego: [wzorzec
  nakładki](./overlay-pattern.md) nie oferuje punktu rozszerzenia do zastąpienia handlera trasy w
  całości i odsyła do dekorowania usługi, którą handler wywołuje.
- **Przy kolejnych zmianach wygrywa ostatnia** — późniejsze interceptory widzą zmiany treści
  żądania i odpowiedzi wprowadzone przez wcześniejsze, w kolejności wykonania.
- **Za czas wykonania odpowiada autor** — czas interceptora to czas żądania; limit czasu żądania
  w platformie obejmuje cały łańcuch.
- **Tylko granica HTTP** — wewnętrzne wywołania między usługami, zadania w tle i zdarzenia
  `EventBus` *nie* są przechwytywane. Interceptory uruchamiają tylko żądania przychodzące przez
  HTTP.
- **Endpointy strumieniowe i binarne nie mają fazy post** — trasy oznaczone
  `config: { streamingResponse: true }` (PDF i pliki, eksport CSV) pomijają serializację;
  interceptor post skierowany na taki endpoint nie przejdzie walidacji przy starcie.

## Przykład

Moduł `compliance` blokuje składanie zamówień na endpoincie innego modułu (pre i blokada), a
moduł `loyalty` wzbogaca szczegóły zamówienia (post):

```ts
// compliance — registerModule(ctx): pre-gate with veto
ctx.interceptors([
  {
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
  },
]);

// loyalty — registerModule(ctx): post-enrichment
ctx.interceptors([
  {
    id: 'enrich-order-detail',
    target: 'GET /api/v1/orders/:id',
    phase: 'post',
    order: 100,
    handler: async ({ payload }) => ({
      ...(payload as object),
      loyaltyPoints: await points.forOrder(payload),
    }),
  },
]);
```

Nieudana weryfikacja zwraca standardową strukturę błędu z kodem modułu `compliance` i **wiersz
zamówienia nie powstaje**; odpowiedź `404` z trasy szczegółów zamówienia nie zawiera
`loyaltyPoints` (faza post nigdy nie działa dla błędów); wyłączenie modułu `loyalty` przywraca
pierwotną postać odpowiedzi.

## Diagnostyka

```
GET /api/v1/admin/api-interceptors      (permission: platform.modules.read)
```

zwraca wszystkie rejestracje — cel, fazę, `order`, moduł, identyfikator — w kolejności wykonania
(według celu, potem `pre` przed `post`, potem `order` i rozstrzygnięcie remisu), z polem
`moduleEnabled` wyznaczanym na bieżąco ze zbioru włączonych modułów w chwili żądania. Ta lista
*jest* planem wykonania. Endpoint jest tylko do odczytu: rejestracje to kod modułu dostarczany w
buildzie, a nie dane zmieniane w czasie działania, więc nie ma czego zapisywać.

## To nie jest moduł webhooks

Nie myl tego mechanizmu z modułem `webhooks`: webhooki wysyłają zdarzenia platformy *na zewnątrz*,
do zewnętrznych odbiorców HTTP, już po fakcie; interceptory API działają *do wewnątrz*, w ramach
obsługi żądania i odpowiedzi przez samą platformę.

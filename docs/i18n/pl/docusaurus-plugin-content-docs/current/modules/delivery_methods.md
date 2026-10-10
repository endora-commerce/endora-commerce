---
title: delivery_methods
description: Skonfigurowane metody dostawy
---

# `delivery_methods`

**Mechanizm metod dostawy** w platformie (_Metoda dostawy_). Moduł zawiera rejestr podłączanych
adapterów, zbudowany na katalogu metod dostawy — odpowiednik modułu `payment_methods` po stronie
dostawy. Pełnoprawny rekord przesyłki `Shipment` i jego cykl życia należą do sąsiedniego modułu
[`shipments`](./shipments.md). Moduły integracji z przewoźnikami rejestrują w tym mechanizmie swoje
adaptery. Które z nich ma twoja instancja, zależy od tego, co jest zainstalowane, więc są tu
wymienione z nazwy, a nie podlinkowane: link do strony sąsiedniego modułu byłby niedziałającym
linkiem w każdej instancji, która tego modułu nie instaluje — i dokładnie to zgłosiłoby
`onBrokenLinks: 'throw'`.

Metoda dostawy nigdy nie jest wpisana na stałe: platforma wykrywa metody na podstawie
zainstalowanych i włączonych **modułów adapterów**. Włączenie rozpoznanego modułu adaptera metody
dostawy automatycznie tworzy konfigurowalny wiersz `delivery_methods`, widoczny na
`/delivery-methods`.

## API publiczne

Trasy administracyjne są chronione przez `delivery_methods:read` (odczyt) i
`delivery_methods:write` (zmiany) — własne kody modułu od 2026-08-28. Wcześniej były to
`catalog:read` / `catalog:write`, co oznaczało, że każdy, kto mógł edytować produkt, mógł też
decydować o sposobach wysyłki sklepu i całkowicie usuwać metody dostawy. Rola, która korzystała z
kodów katalogu przy tym ekranie, musi dostać nowe kody na `/admin-roles`; nic nie przyznaje ich
automatycznie — celowo.

**Wybór kanałów sprzedaży metody wymaga tych kodów i żadnych innych.** To, gdzie metoda jest
dostępna, jest częścią konfiguracji metody, więc `delivery_methods:write` wystarcza, aby przypisać, zmienić i
usunąć jej kanały sprzedaży, a `delivery_methods:read` — aby zobaczyć kanały do wyboru
(`GET /api/v1/admin/delivery-methods/sales-channels`). Ani `sales_channels:read`, ani
`sales_channels:write` nie są wymagane — to decyzja, nie przeoczenie — a kody `delivery_methods` nie dają
żadnych uprawnień na ekranach kanałów sprzedaży.

| Metoda i ścieżka | Kto | Uprawnienie | Przeznaczenie |
| --- | --- | --- | --- |
| `GET /api/v1/delivery-methods` | anonimowy | — | Metody dostępne w checkoucie storefrontu (aktywne ∩ kanał sprzedaży ∩ lista dozwolonych organizacji ∩ zarejestrowany adapter ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/delivery-methods` | administrator | `delivery_methods:read` | Pełna lista z adapterem, przypisaniem statusów, kanałami sprzedaży, kluczem szablonu oraz polem `availability` — czy checkout może zaoferować metodę i który moduł o tym decyduje |
| `GET /api/v1/admin/delivery-methods/adapters` | administrator | `delivery_methods:read` | Adaptery, do których można przypisać metodę: `{ key, ownerModule }` dla każdego zarejestrowanego adaptera, którego moduł jest włączony |
| `GET /api/v1/admin/delivery-methods/sales-channels` | administrator | `delivery_methods:read` | Kanały sprzedaży, do których można przypisać metodę — `{ id, code, name, active }` dla każdego kanału, także nieaktywnych |
| `PUT /api/v1/admin/delivery-methods/:code` | administrator | `delivery_methods:write` | Utworzenie lub aktualizacja według kodu (nazwa, koszt/`price`, `adapter`, status, `statusOnSuccess`/`statusOnFailure`, kanały sprzedaży) |
| `DELETE /api/v1/admin/delivery-methods/:id` | administrator | `delivery_methods:write` | Trwałe usunięcie (chronione: odrzucane z 409, gdy metoda jest używana przez przesyłkę `Shipment` — zamiast tego ustaw status `inactive`) |

Listy wyboru statusów w panelu pobierają opcje z `GET /api/v1/admin/order-statuses` (trasa
administracyjna modułu metod płatności; wspólny `OrderStatusRegistry`). Ta trasa wymaga
`payment_methods:read` **albo** `delivery_methods:read` — wystarczy jedno z uprawnień obu
edytorów, które z niej korzystają, więc kod otwierający ten ekran otwiera też jego listy statusów.

## Kanały sprzedaży

Każda metoda dostawy jest dostępna w tych kanałach sprzedaży, które wybierze dla niej
operator. Na ekranie `/delivery-methods` formularz ma pole **Kanały sprzedaży**, a lista pokazuje kanały
każdej metody.

**Przypisanie jest ograniczeniem, a metoda bez przypisania jest dostępna w każdym kanale.**
Metoda przypisana do jednego lub kilku kanałów jest dostępna dokładnie w nich. Metoda
nieprzypisana do żadnego kanału — *Wszystkie kanały* w formularzu — jest dostępna w każdym kanale,
także w kanałach utworzonych później. To celowo inna reguła niż dla produktów, gdzie produkt bez
kanału nie jest opublikowany nigdzie: metody dostawy istnieją bez przypisania w zwykłych
sytuacjach, więc potraktowanie „żadnego” jako „nigdzie” odebrałoby istniejącym sklepom metody
dostępne przy składaniu zamówienia. Stan metody, której nikt nie przypisał ręcznie:

- Moduł dostarczający własną metodę tworzy ją podczas instalacji modułu i nie przypisuje jej do
  **żadnego** kanału, więc jest dostępna w każdym kanale — niezależnie od tego, kiedy moduł
  zostanie zainstalowany: w nowej instancji czy w działającej od lat. Wydania sprzed tej reguły
  działały inaczej: metoda była przypisywana do kanału domyślnego, jeśli ten kanał istniał w
  chwili instalacji, a istnieje on w każdej instancji uruchomionej przynajmniej raz. Metody
  utworzone wtedy zachowują to przypisanie.
- Dane demonstracyjne nie przypisują żadnego kanału.
- Metoda utworzona przez API bez `salesChannelIds` zostaje przypisana do kanału domyślnego;
  metoda utworzona w formularzu panelu bez zaznaczenia kanału nie jest przypisana do żadnego.

Przypisanie jest egzekwowane tam, gdzie spotyka je kupujący:

- `GET /api/v1/delivery-methods` zwraca tylko metody dostępne w kanale sprzedaży rozpoznanym dla żądania
  (`X-Sales-Channel`, `?salesChannel=`, mapa hostów, a w ostatniej kolejności kanał domyślny).
  Sklep musi więc wskazać swój kanał przy tym odczycie: referencyjny sklep przekazuje
  `X-Sales-Channel`, a sklep utworzony z wcześniejszego wydania wymaga tej samej zmiany w
  `lib/api/methods.ts` — w przeciwnym razie otrzyma metody kanału domyślnego.
- Złożenie zamówienia i podgląd jego sumy odrzucają metodę, która nie jest dostępna w kanale
  sprzedaży zamówienia, odpowiedzią `400 VALIDATION_FAILED` z
  `details.code = "delivery_method_not_in_sales_channel"`. Dotyczy to zakupu w sklepie, zakupu
  jednym kliknięciem, zamówienia tworzonego przez administratora w imieniu klienta (kanał wybrany
  dla zamówienia) oraz zamówienia złożonego kluczem API (kanał klucza). Formularz tworzenia
  zamówienia w panelu zawęża listy metod do wybranego kanału.

Pole `salesChannelIds` w `PUT /api/v1/admin/delivery-methods/:code` ma trzy znaczenia:

| `salesChannelIds` | Skutek |
| --- | --- |
| pominięte | Aktualizacja nie zmienia przypisania. **Nowa** metoda zostaje przypisana tylko do kanału domyślnego. |
| `[]` | Wszystkie przypisania są usuwane: metoda jest dostępna w każdym kanale. |
| jeden lub więcej identyfikatorów | Metoda jest dostępna dokładnie w tych kanałach. |

Formularz w panelu zawsze wysyła to pole, więc metoda utworzona w nim bez zaznaczenia żadnego
kanału jest dostępna w każdym kanale. Jeśli formularz nie może wczytać listy kanałów sprzedaży,
informuje o tym i nie wysyła pola, a zapis pozostawia przypisanie bez zmian.

Poza tym nadal obowiązuje reguła co najmniej jednego kanału: usunięcie **ostatniego** kanału metody
od strony kanału sprzedaży jest odrzucane, a usunięcie kanału sprzedaży, który jest jedynym
kanałem metody, jest odrzucane albo przepina metodę do kanału domyślnego. Przypisanie nie znika
więc jako skutek uboczny innej operacji: metoda jest dostępna wszędzie tylko dlatego, że zapisano
ją bez wybranego kanału albo utworzono bez przypisania, jak opisano wyżej. Zapis wskazujący kanał
sprzedaży, który nie istnieje, jest odrzucany odpowiedzią `400 VALIDATION_FAILED`, zanim cokolwiek
zostanie zapisane. Jeśli przypisanie kanałów **nowej** metody mimo to się nie powiedzie,
utworzenie jest wycofywane: metoda zostaje usunięta — bez pytania modułu `shipments`, bo do metody
utworzonej w tym samym żądaniu nic nie może się odwoływać, więc działa to także przy wyłączonym
`shipments` — a żądanie kończy się błędem. Gdyby samo usunięcie się nie powiodło, metoda pozostaje
**nieaktywna**, a nie aktywna bez kanału, więc w najgorszym razie po prostu nie jest oferowana.

**Aktualizacja instancji z więcej niż jednym kanałem sprzedaży: przejrzyj każdą metodę.**
Dotychczas sklep pokazywał każdą aktywną metodę w każdym kanale i pomijał przypisanie. Kolumna
**Kanały sprzedaży** na ekranie `/delivery-methods` pokazuje obecny stan każdej metody:

- przypisana **tylko do kanału domyślnego**, a więc niedostępna przy składaniu zamówienia w
  pozostałych kanałach, dopóki tego nie zmienisz — każda metoda utworzona dotąd w panelu oraz
  każda metoda utworzona przez moduł **we wcześniejszym wydaniu** w instancji, która była już
  uruchomiona. Nic nie poszerza ich automatycznie: takiego wpisu nie da się odróżnić od metody
  ograniczonej celowo;
- nieprzypisana **do żadnego kanału**, a więc dostępna wszędzie — każda metoda tworzona przez
  moduł od tego wydania, metody utworzone przez moduł we wcześniejszym wydaniu podczas pierwszej
  konfiguracji instancji oraz metody z danych demonstracyjnych.

Otwórz każdą metodę i wybierz jej kanały albo odznacz wszystkie, aby była dostępna wszędzie. W
instancji z jednym kanałem sprzedaży nic się nie zmienia.

Przypisania są przechowywane w tabeli `sales_channel_delivery_methods` i są odczytywane oraz zapisywane wyłącznie przez
usługę przypisań kanałów sprzedaży platformy.

## Pola wpisu

Wiersz `delivery_methods` zawiera: `code` (unikalny), `adapter` (klucz w rejestrze), `name` dla
poszczególnych języków (wartość domyślna i nadpisania), `cost` i `currency` (dopłata `price`
doliczana do wartości zamówienia), `status` (`active`/`inactive`), `statusOnSuccess` /
`statusOnFailure` (odwołania do statusów zamówienia ustawianych po udanym lub nieudanym utworzeniu
przesyłki). **Nie ma** `statusOnPending` ani kolumny `kind` — metodę dostawy identyfikuje wyłącznie
`adapter`.

`statusOnSuccess` / `statusOnFailure` odwołują się do statusów zamówienia wyznaczanych przez port
`OrderStatusRegistry` (oparty na wyliczeniu statusów zamówienia, dopóki moduł zamówień nie dostarczy
konfigurowalnego rejestru). Domyślne wartości początkowe: `shipped` / `in_fulfilment`.

Przypisanie do kanałów sprzedaży korzysta z ogólnego `SalesChannelMembershipService`
(`'delivery-method'`); dostępność dla organizacji korzysta z `OrganizationRestrictionService`
(`'delivery_method'`, lista blokad).

## Wybór adaptera

To adapter sprawia, że wiersz jest działającą metodą dostawy: metoda, której `adapter` nie jest
zarejestrowany albo której moduł dostarczający adapter jest wyłączony, pozostaje w katalogu i
**nigdy nie jest oferowana w checkoucie**.

Na ekranie `/delivery-methods` operator wybiera adapter z listy podczas tworzenia lub edycji
metody. Lista należy do danej instancji — dwa wbudowane adaptery oraz po jednym na każdy
zainstalowany i włączony moduł przewoźnika — więc wydłuża się po zainstalowaniu modułu przewoźnika
i skraca po jego wyłączeniu. Nowej metody nie da się zapisać bez dokonania wyboru.

Wiersz, którego nie można zaoferować, jest na liście oznaczony jako **Nieoferowana przy składaniu
zamówienia**, razem z przyczyną: żaden zainstalowany moduł nie dostarcza jego adaptera albo moduł,
który go dostarcza, jest wyłączony lub niedostępny. Nic nie naprawia ani nie usuwa takiego wiersza
automatycznie. Otwórz go i wybierz zarejestrowany adapter albo ponownie włącz moduł przewoźnika.
Do tego czasu wierszowi nadal można zmienić cenę, nazwę lub ustawić go jako nieaktywny: zapis z
adapterem, który wiersz już ma, jest przyjmowany.

Trzy reguły obowiązują zarówno w API, jak i na ekranie:

- **Wybierany adapter musi być zarejestrowany.** Zmiana metody na klucz, którego nie dodał żaden
  moduł, kończy się odpowiedzią 400.
- **Metoda, która ma już przesyłki, zachowuje swój adapter.** Przesyłka `Shipment` zapisuje metodę
  dostawy, a nie adapter, który ją utworzył, więc `adapter` metody jest jedynym zapisem tego, który
  przewoźnik ma te paczki. Jego zmiana kończy się odpowiedzią 409; ustaw metodę jako `inactive` i
  utwórz nową dla drugiego adaptera. Gdy moduł `shipments` jest wyłączony, platforma nie może
  policzyć przesyłek, więc zmiana jest odrzucana do czasu jego ponownego włączenia.
- **Pole `adapter` nadal można pominąć w treści żądania.** Tworzenie bez tego pola przyjmuje jako
  adapter `code` metody — tak jak przed wprowadzeniem adapterów — co daje działającą metodę tylko
  wtedy, gdy kod jest akurat kluczem zarejestrowanego adaptera. Podawaj `adapter` jawnie;
  `availability.available` w odpowiedzi mówi, czy właśnie zapisaną metodę można zaoferować.

## Jak zbudować moduł metody dostawy

Moduł platformy jest rozpoznawany jako adapter metody dostawy **wtedy i tylko wtedy, gdy** w hooku
startowym rejestruje `ShippingAdapter` w działającym w procesie `shippingAdapterRegistry`. Zmiany w
rdzeniu nie są potrzebne.

1. **Zaimplementuj kontrakt `ShippingAdapter`** (`@endora-commerce/contracts`):

   ```ts
   import type { ShippingAdapter } from '@endora-commerce/contracts';

   export const myCarrierAdapter: ShippingAdapter = {
     adapterKey: 'my_carrier',
     // Dodatkowe warunki dla poszczególnych miejsc; zwróć stałe true, gdy ich nie ma.
     validateUseOnStorefront: async () => true,
     validateUseOnAdmin: async () => true,
     validateUseInApi: async () => true,
     // order_created: może rozpocząć tworzenie przesyłki; można bezpiecznie nic nie robić.
     onOrderCreated: async () => {},
     // shipment_created: rozpocznij tworzenie przesyłki, zwróć następną akcję.
     onShipmentCreated: async () => ({ kind: 'pending' }),
     // receive_shipment: przełóż przyjęty wynik na sukces albo porażkę.
     onReceiveShipment: async (ctx) => ({
       result: 'success',
       externalReference: ctx.externalReference ?? null,
     }),
     // Opcjonalne klucze szablonów; brak ⇒ szablon domyślny platformy.
     renderers: { storefront: 'my_carrier', email: 'my_carrier.email' },
   };
   ```

2. **Dodaj adapter w hooku startowym**, podając moduł-właściciela, a wiersz metody dostarcz jako
   migrację:

   ```ts
   import { shippingAdapterRegistry } from '.../delivery_methods/services/registry-singleton.js';

   ctx.onBoot(() => {
     shippingAdapterRegistry.register(myCarrierAdapter, 'my_carrier_module');
   });
   ```

   Identyfikator właściciela pozwala rejestrowi pominąć adapter, gdy jego modułu nie ma, więc
   przewoźnik wyłączony przez operatora przestaje być oferowany, zamiast być oferowany i zawodzić — to
   ten sam błąd, który miał odpowiednik po stronie płatności, naprawiony po obu stronach. Sam wiersz
   `delivery_methods` to statyczne dane słownikowe i należy do migracji modułu;
   `DeliveryMethodReconciler` pozostaje dostępny w `installHook` dla wiersza tworzonego w kodzie.
   Do wycofania adaptera nie jest potrzebny hook odinstalowania — nieobecny moduł nie jest brany pod
   uwagę przy przeglądaniu wpisów.

   Pominięcie nie dotyczy zamówienia **już złożonego** z twoją metodą: przesyłkę nadal można
   wygenerować, a powstaje ona w stanie `pending_manual` z nazwą twojego modułu, zamiast wyglądać
   na przyjętą przez przewoźnika. Nie piszesz do tego żadnego kodu — zobacz *Kiedy odczytywany jest
   rejestr* niżej.

   **Twój hook dodaje wpis i od razu kończy.** Nie sprawdza, co już jest w tabeli, nie sprawdza
   obecności `delivery_methods` i nie traktuje jej braku jako błędu — bo podczas składania modułów
   nic nie odczytuje rejestru. Hooki startowe wykonują się niezależnie od stanu efektywnego modułu;
   na pytanie o obecność odpowiada *przeglądanie wpisów*, a nie rejestracja. Wyjątek rzucony w hooku
   startowym to nie tylko jeden brakujący adapter: `runBootHooks` rzuca go dalej jako
   `ModuleCompositionError`, a `index.ts` zamienia to w `process.exit(1)`, więc następny start
   operatora kończy się błędem z powodu przełącznika, z którego miał prawo skorzystać. Hook, który
   wnosi wkład, *nie może* też sprawdzać `effectiveState` — host filtruje wpisy przy przeglądaniu, a
   sprawdzenie przy dodawaniu oznaczałoby, że ponowne włączenie przewoźnika wymaga restartu. Jeśli
   hook *wykonuje też pracę* (uzgadnianie, zapis w Redis lub Postgresie), najpierw go rozdziel: część
   wykonująca pracę sprawdza obecność, część wnosząca wkład — nigdy.

3. **Opcjonalne szablony** — zarejestruj własne szablony pod zadeklarowanymi kluczami:
   - Storefront: `registerShippingMethodRenderer(key, fn)` w
     `storefront/lib/shipping-renderers/registry.tsx`.
   - E-mail: `registerShippingEmailRenderer(key, fn)` w
     `shipments/services/shipping-email-renderer.ts`.
   Gdy dla danego miejsca brakuje szablonu, używany jest szablon domyślny platformy, więc metoda
   zawsze się wyświetla.

4. **Włącz moduł** na ekranie cyklu życia modułów w panelu → na `/delivery-methods` pojawia się
   konfigurowalna metoda dostawy.

Dwa wbudowane adaptery wzorcowe działające offline — `manual_courier` (_Wysyłka własna_) i
`personal_pickup` (_Odbiór osobisty_) — nie wymagają zewnętrznego przewoźnika i są pełnym przykładem
całego cyklu życia.

## Kiedy odczytywany jest rejestr

`shippingAdapterRegistry` to **singleton procesu** (`delivery_methods/services/registry-singleton.ts`):
jedna tabela adapterów na proces, niezależnie od tego, ile razy platforma jest składana. Wkłady są
dodawane **raz, podczas kompozycji**. Każdy odczyt następuje **później, w trakcie żądania**:

| Odczyt | Gdzie | Co oznacza brak adaptera |
| --- | --- | --- |
| Dostępność w storefroncie | `GET /api/v1/delivery-methods` → `ShippingMethodEligibilityService.filter` | metoda nie jest oferowana |
| Wybór adaptera w panelu | `GET /api/v1/admin/delivery-methods/adapters` → `list` | adapter nie jest dostępny do wyboru |
| Zabezpieczenie zapisu w panelu | `PUT /api/v1/admin/delivery-methods/:code` → `isRegistered` | jawnie podany klucz, którego nikt nie dodał, jest odrzucany (400), chyba że wiersz już go ma; klucz dodany przez wyłączony moduł jest akceptowany, bo ten odczyt celowo nie sprawdza obecności |
| Składanie zamówienia | `orders` ponownie sprawdza wybraną metodę, a potem wywołuje `onOrderCreated` | metoda, której właściciel jest wyłączony, odpowiada 503 `MODULE_DISABLED`; dla niezarejestrowanej hook jest pomijany |
| Generowanie przesyłki | `ShipmentService.create` → `onShipmentCreated` | hook adaptera jest pomijany, a `Shipment` powstaje w stanie **`pending_manual`** z nazwą nieobecnego modułu — nigdy w zwykłym `pending`, które wyglądałoby na przyjęte przez przewoźnika |
| E-mail z potwierdzeniem zamówienia | klucz `renderers.email` metody | używany jest szablon domyślny platformy |

Wynikają z tego dwie rzeczy i dlatego ta sekcja istnieje, a nie jest pozostawiona domysłom. Po
pierwsze, **nie ma kolejności, którą trzeba zachować** między wnoszącymi wkład: twój adapter jest
widoczny przy pierwszym odczycie, niezależnie od tego, czy został dodany przed cudzym, czy po nim,
więc hook startowy nie ma na co czekać ani czego sprawdzać. Po drugie, na nieobecność lub wyłączenie
wnoszącego odpowiada się **przy odczycie**, na podstawie zapisanego właściciela wpisu — nigdy przy
dodawaniu. To sprawia, że jest to punkt wpięcia, a nie blokowany port: dodawanie jest celowo
nieblokowane, bo blokada zamieniłaby jedno przełączenie przez operatora w błąd startu wskazujący
moduł, którego nikt nie dotykał.

Filtr obecności dzieli API według tego, kto pyta. `get`, `resolve`, `list` i `isAvailable`
pomijają wpis, którego moduł-właściciel nie jest faktycznie obecny — kupujący nigdy nie zobaczy
przewoźnika, który nie może przyjąć paczki, a `resolve` rzuca zwykły `ModuleDisabledError`. `entry`,
`ownerOf`, `isRegistered` i `listAll` celowo tego nie robią, bo `/delivery-methods` musi pokazywać
metodę *i* powód, dla którego jest niedostępna: wyłączenie modułu to nie jego odinstalowanie.

`absentOwnerFor(adapterKey)` to piąty sposób odczytu i jedyny, który odpowiada na *pytanie*, zamiast
udostępniać tabelę: wskazuje moduł, który dodał klucz, a nie jest obecny, a w każdym innym
przypadku zwraca `null`. Istnieje, bo `get()` łączy dwie sytuacje, na które operator nie może
zareagować tak samo — klucz, którego nikt nie dodał, i klucz, którego moduł przewoźnika jest
wyłączony — a tylko druga wskazuje coś, co można z powrotem włączyć. `shipments` pyta o to, aby
zdecydować, w jakim stanie utworzyć `Shipment`; odpowiednik po stronie płatności,
`GatewayRefundRegistry.absentOwnerFor`, to ten sam sposób odczytu z tego samego powodu.

## Cykl życia

Cykl życia `order_created` → `shipment_created` → `receive_shipment`, encję `Shipment`, ponawianie i
przekładanie na statusy zamówienia opisuje [`shipments`](./shipments.md).

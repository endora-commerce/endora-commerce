---
title: Płatnicy powiązani
sidebar_label: Płatnicy powiązani
sidebar_position: 1
description: Organizacja kupująca składa zamówienia opłacane i fakturowane przez inną organizację sklepu
---

# Płatnicy powiązani (`related_payers`)

Organizacja kupująca składa zamówienie, a płaci za nie inna organizacja sklepu. Wykonawca
realizujący przetarg zamawia towar, a inwestor prowadzący przetarg dostaje fakturę, odpowiada za
kredyt i widzi zamówienie. Moduł odpowiada za **powiązanie** kupującego z jego płatnikiem, za to, jak
takie powiązanie powstaje (operator, integracja, prośba kupującego albo zaproszenie od płatnika), za
jego ustawienia, uprawnienia i powiadomienia. Zamówienia, koszyki, faktury i zwroty odczytują
powiązanie przez porty modułu i robią resztę.

Moduł jest dostarczany **wyłączony**. Instalacja, która go nie włączy, działa dokładnie tak jak
dotąd, a jego włączenie niczego nie zmienia w kanale sprzedaży, dopóki nie zostanie włączony
przełącznik samego kanału.

- [Przewodnik operatora](./operator-guide.md) — sekcja *Płatnicy* na karcie organizacji, ustawienia
  kanału, kolejka próśb o płatnika i warunki handlowe płatnika.
- [Przewodnik po storefroncie](./storefront-guide.md) — co widzą w sklepie kupujący i płatnicy.

## Pojęcia

- **Kupujący (X) i płatnik (Y).** Obaj są organizacjami firmowymi sklepu i są to dwie różne
  organizacje. Organizacja osobista (B2C) nie może być żadnym z nich.
- **Powiązanie z płatnikiem.** Jedno powiązanie łączy jednego kupującego z jednym płatnikiem. Para
  ma co najwyżej jedno powiązanie, które nie jest odwołane. Powiązanie ma:
  - **stan** — `active`, `inactive` (odwracalny) albo `revoked` (ostateczny; parę można powiązać
    ponownie nowym powiązaniem);
  - **adresy rozliczeniowe** — wszystkie adresy rozliczeniowe płatnika albo jeden z nich;
  - **ważność** — opcjonalny moment *od* i *do*, oba końce włącznie; brak końców oznacza brak
    ograniczenia czasu;
  - **warunki handlowe** — `buyer` (domyślnie: ceny kupującego, płatnik tylko płaci) albo `payer`
    (koszyk jest wyceniany na warunkach płatnika, zob. *Kupowanie dla płatnika* niżej);
  - **e-maile do płatnika** — czy płatnik dostaje informację o złożonych i anulowanych na niego
    zamówieniach (domyślnie nie);
  - **pochodzenie** — operator, automatyzacja, prośba albo zaproszenie, a dla automatyzacji także
    `source` integracji.
- **Powiązanie, którego można użyć.** Powiązanie może obsłużyć nowe zamówienie tylko wtedy, gdy
  jednocześnie: moduł jest włączony i przełącznik kanału jest włączony; powiązanie jest `active` i
  mieści się w okresie ważności; płatnik jest zatwierdzony i nie jest zablokowany; płatnik ma co
  najmniej jeden aktualny adres rozliczeniowy dozwolony przez powiązanie.
- **Prośba.** Kupujący prosi firmę, podając jej dokładny NIP, by została jego płatnikiem. Płatnik
  może w ten sam sposób **zaprosić** kupującego. O jednym i drugim decyduje druga strona, operator
  albo obaj, zgodnie z trybem zatwierdzania kanału, a kończy się to stanem `active` (powstaje
  powiązanie), `rejected`, `expired` albo `withdrawn`.

## Włączanie

Potrzebne są dwa przełączniki:

1. **Platforma → Moduły** — aktywuj *Related payers*. To ustawienie aktywacji
   `related_payers.module_enabled` (domyślnie wyłączone).
2. **Ustawienia → Płatnicy powiązani**, w każdym kanale sprzedaży, który ma to oferować —
   *Płatnicy powiązani włączeni* (`related_payers.enabled`, domyślnie wyłączone).

Następnie nadaj rolom kupujących i płatników opisane niżej uprawnienia organizacji; żadne z nich nie
jest domyślnie przyznawane członkom.

## Ustawienia

Każde ustawienie poza przełącznikiem aktywacji i strefą czasową można nadpisać dla kanału sprzedaży.

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `related_payers.module_enabled` | `false` | Przełącznik aktywacji na **Platforma → Moduły**. |
| `related_payers.enabled` | `false` | Udostępnia płatników powiązanych w kanale: wybór płatnika w checkoucie i w koszyku oraz ekrany konta. |
| `related_payers.approval_mode` | `payer` | Kto decyduje o prośbie wskazującej organizację, która ma konto: `payer` (jej użytkownicy), `admin` (operator) albo `payer_then_admin` (jej użytkownicy, a potem operator). |
| `related_payers.unregistered_payer_mode` | `admin` | Co dzieje się z prośbą wskazującą NIP, którego nie ma żadna organizacja: `admin` (decyduje operator) albo `invite` (zaproszenie do rejestracji trafia na e-mail kontaktowy). Przed wyborem `invite` przeczytaj o ryzyku szczątkowym w przewodniku operatora. |
| `related_payers.payer_may_invite_buyers` | `true` | Pozwala płatnikowi zaprosić kupującego, za którego zgadza się płacić. |
| `related_payers.request_ttl_days` | `30` | Liczba dni, przez które prośba albo zaproszenie czeka na decyzję, zanim wygaśnie (1–365). |
| `related_payers.daily_request_limit` | `10` | Liczba próśb i zaproszeń łącznie, jaką jedna organizacja może wysłać w ciągu dnia (1–1000). |
| `related_payers.time_zone` | `Europe/Warsaw` | Strefa czasowa IANA, w której dzień dziennego limitu zaczyna się o północy. Odczytywana dla domyślnego sklepu i stosowana w każdym kanale; pozostaje ustawieniem tego modułu, dopóki platforma nie ma strefy czasowej całego sklepu. |

## Uprawnienia

**Uprawnienia operatora** (role administracyjne):

| Kod | Pozwala |
| --- | --- |
| `related_payers:read` | Widzieć sekcję *Płatnicy* na karcie i kolejkę *Prośby o płatnika*. |
| `related_payers:manage` | Dodawać, zmieniać, dezaktywować i odwoływać powiązania; rozstrzygać wpisy kolejki. Wymaga też `customers:manage`, bo utworzenie organizacji płatnika tworzy organizację. |

**Uprawnienia organizacji** (role samego kupującego i płatnika; żadne nie jest domyślne dla członków):

| Kod | Etykieta | Pozwala |
| --- | --- | --- |
| `related_payers.order_with_payer` | Zamawianie z płatnikiem powiązanym | Wybrać płatnika w checkoucie, a płatnika na jego warunkach w polu *Płaci* w koszyku. |
| `related_payers.view_paid_orders` | Podgląd zamówień, za które płacimy | Przeglądać, bez możliwości zmian, zamówienia złożone przez inne organizacje z tą organizacją jako płatnikiem, i pobierać ich faktury. Decyduje też o tym, kto dostaje e-maile do płatnika. |
| `related_payers.manage` | Zarządzanie płatnikami | Prosić o płatników, wycofywać prośby, odwoływać powiązania tej organizacji z płatnikami oraz przyjmować i odrzucać zaproszenia od płatników. |
| `related_payers.approve` | Zatwierdzanie próśb o płatnika | Przyjmować i odrzucać prośby o płacenie za inną organizację, zapraszać kupujących i odwoływać powiązania, w których ta organizacja płaci. |

## Co zmienia się, gdy zamówienie ma płatnika

- **Rozliczenie idzie za płatnikiem.** Adres rozliczeniowy jest jednym z adresów płatnika dozwolonych
  przez powiązanie; nazwa firmy i NIP w zamówieniu i na fakturze są płatnika. Ręcznego nadpisania
  danych firmy do faktury w checkoucie nie można łączyć z płatnikiem: żądanie zawierające jedno i
  drugie jest odrzucane.
- **Podatek idzie za płatnikiem.** VAT jest liczony według statusu VAT płatnika i kraju jego adresu
  rozliczeniowego, tak samo w podglądzie i przy składaniu zamówienia.
- **Metody płatności idą za płatnikiem.** Checkout oferuje metody płatności dozwolone płatnikowi;
  metoda w ramach limitu kredytowego jest oferowana, gdy dostępny kredyt płatnika pokrywa kwotę, a
  zamówienie rezerwuje kredyt płatnika (albo właściciela jego kredytu, gdy płatnik korzysta ze
  wspólnej puli organizacji nadrzędnej). Kredyt kupującego pozostaje nietknięty.
- **Dostawa zostaje przy kupującym.** Adres i metody dostawy są kupującego.
- **Zamówienie zostaje przy kupującym.** Należy do organizacji kupującej i ma blok *payer*
  (organizacja, nazwa, NIP, warunki). Konto kupującego pokazuje *Płaci*; szczegóły zamówienia w
  panelu pokazują płatnika, a listę zamówień można filtrować po płatniku.
- **Faktura i rejestr faktur wskazują płatnika**, a faktura nie jest wyświetlana przy kupującym.
  Rozliczenie zwrotu takiego zamówienia w formie kredytu uznaje płatnika.
- **Płatnik widzi zamówienie** tylko do odczytu w *Zamówieniach, za które płacimy*, bez adresu
  dostawy, uwagi klienta i komentarzy, ale z fakturami. Nie może go anulować, zamówić ponownie,
  wycenić, zwrócić ani skomentować. Późniejsze odwołanie powiązania nie ukrywa wcześniejszych
  zamówień.

Każda odmowa — moduł albo kanał wyłączony, brak uprawnienia, powiązanie nieaktywne, odwołane albo
poza okresem ważności, płatnik zablokowany, adres spoza powiązania — odrzuca całe zamówienie: nic nie
zostaje zapisane, zarezerwowane ani wysłane.

## Kupowanie dla płatnika (warunki handlowe płatnika)

Gdy powiązanie jest na **warunkach płatnika**, kupujący z uprawnieniem *Zamawianie z płatnikiem
powiązanym* może wybrać tego płatnika w polu *Płaci* w koszyku. Od tej chwili koszyk i katalog są
wyceniane tak, jak byłby wyceniany płatnik według cenników kanału: lista produktów, strona produktu,
wyniki i podpowiedzi wyszukiwania, porównania, pozycje koszyka, promocje i zamówienie. VAT pozycji
idzie za statusem VAT i krajem płatnika. To, co kupujący może **zobaczyć**, pozostaje kupującego:
widoczność produktów i tryb wyświetlania cen (na przykład *tylko brutto* albo ukryte ceny) są
ustalane dla kupującego.

Przełączenie pokazuje podsumowanie: pozycje, których cena się zmieniła, pozycje, które nie mają już
ceny (trzeba je usunąć przed złożeniem zamówienia), oraz dodane i usunięte promocje. Checkout
ustala wtedy płatnika i nie można go tam zmienić. Jeśli powiązania nie da się już użyć albo jego
warunki wrócą do warunków kupującego, następny odczyt koszyka przywraca ceny kupującego z
komunikatem, a zamówienie składane równolegle z tą zmianą jest odrzucane. Minimalna wartość
zamówienia jest sprawdzana na sumie według cen płatnika. Wykorzystanie promocji jest zapisywane na
płatnika.

Powiązanie na **warunkach kupującego** nie zmienia żadnej ceny: płatnik tylko płaci.

## Powiadomienia

E-maile są szablonami ekranu *E-maile transakcyjne* (grupa *related_payers*), wysyłanymi w domyślnym
języku sklepu; wpisy w koncie pojawiają się w centrum powiadomień storefrontu, a dla operatorów w
dzwonku panelu, jeśli te moduły są obecne.

| Szablon | Do kogo | Kiedy |
| --- | --- | --- |
| `related_payer_order_placed` | Członkowie płatnika z *Podglądem zamówień, za które płacimy* | Złożono zamówienie na płatnika, jeśli powiązanie ma włączone e-maile do płatnika. |
| `related_payer_order_cancelled` | Ci sami | Takie zamówienie anulowano, pod tym samym warunkiem. |
| `related_payer_request_received` | Osoby zatwierdzające u płatnika | Kupujący prosi o płacenie. Nigdy na e-mail kontaktowy. |
| `related_payer_invitation_received` | Osoby zarządzające płatnikami u kupującego | Płatnik proponuje płacenie. Nigdy na e-mail kontaktowy. |
| `related_payer_request_decided` | Nadawca i osoby zarządzające albo zatwierdzające po jego stronie | Prośbę albo zaproszenie przyjęto lub odrzucono. |
| `related_payer_request_expired` | Członek, który ją wysłał | Prośba albo zaproszenie wygasło. Wycofanie nie powiadamia nikogo. |
| `related_payer_invitation_to_register` | E-mail kontaktowy | Prośba wskazuje NIP bez konta, w trybie `invite` albo gdy operator wybierze *Wyślij zaproszenie*. |
| `related_payer_link_revoked` | Druga strona (obie, gdy odwołał operator albo integracja) | Odwołano powiązanie. |

Gdy prośba trafia do kolejki, operatorzy dostają wpis w dzwonku.

## Dla programistów: port automatyzacji

Moduł nakładkowy (overlay) wdrożenia może wiązać płatników bez udziału operatora — na przykład
dodawać inwestora projektu jako płatnika każdego wykonawcy w tym projekcie. Rozwiąż
`relatedPayerWritePort` przez `lazyPort` i zadeklaruj niewiążącą zależność od `related_payers`:

```ts
const payers = lazyPort<RelatedPayerWritePort>(ctx, 'relatedPayerWritePort');

await payers.addPayer({
  buyerOrganizationId,
  payerOrganizationId,
  source: 'project_investors', // ^[a-z0-9_.-]{1,64}$, recorded as the link's origin source
  commercialTerms: 'buyer', // optional; addressScope, validFrom, validTo are optional too
});

await payers.revokePayer({ buyerOrganizationId, payerOrganizationId, source: 'project_investors' });
```

- `addPayer` jest idempotentne dla aktywnego powiązania: odpowiada `{ created: false }` i niczego
  nie zmienia. Para, której nie można powiązać (ta sama organizacja, organizacja osobista), jest
  odrzucana.
- `revokePayer` odwołuje nieodwołane powiązanie pary i odpowiada `{ revoked: false }`, gdy go nie ma.
- Każde wywołanie to jedno audytowane polecenie (Command), którego aktorem jest `automation`, z
  przekazanym `source`.
- Gdy moduł jest wyłączony, wywołanie przez port rzuca `ModuleDisabledError`
  (`503 MODULE_DISABLED`) i nic nie zostaje zapisane.

Moduł publikuje też `relatedPayerPolicyPort`, przez który `orders`, `carts` i `payment_methods`
pytają, czy powiązania można użyć i na jakich warunkach; moduły nakładkowe zwykle go nie potrzebują.

**Akcje z hookami.** `related_payers.request.create`, `.request.accept`, `.request.reject`,
`.request.expire`, `.request.route` i `related_payers.link.revoke` są publiczne, tylko z fazą
`afterCommit`. Moduł dostarcza z nich własne powiadomienia; moduł nakładkowy może zarejestrować
kolejne handlery po zatwierdzeniu transakcji. **Zdarzenia**: `related_payers.link.created.v1`,
`.link.changed.v1`, `.link.revoked.v1`, `related_payers.request.created.v1`,
`.request.decided.v1` — tylko identyfikatory.

## Audyt

Każda zmiana powiązania i prośby jest poleceniem zapisanym w dzienniku audytu z nazwami zmienionych
pól (w tym warunków handlowych) i aktorem — użytkownikiem admina, klientem, systemem (wygaśnięcie)
albo integracją z jej `source`. Do stanu audytu nie trafia żaden NIP, e-mail kontaktowy, komentarz,
powód odrzucenia, nazwa ani adres.

## Wyłączanie

Dezaktywacja modułu na **Platforma → Moduły** niczego nie usuwa. Gdy moduł jest wyłączony: każda
trasa modułu odpowiada `503 MODULE_DISABLED` (port integracji również); checkout i koszyk nie
oferują płatnika, a koszyk kupowany dla płatnika przy następnym odczycie jest wyceniany dla
kupującego; sekcja *Płatnicy* na karcie, kolejka *Prośby o płatnika*, jej akcja w palecie poleceń,
grupa ustawień i uprawnienia organizacji znikają z panelu administracyjnego; ekrany konta *Płatnicy*
i *Zamówienia, za które płacimy* znikają; proces wygaszania próśb nie działa. Złożone już zamówienia
zachowują dane płatnika. Ponowna aktywacja przywraca bez zmian powiązania, prośby, ustawienia i
nadane w rolach uprawnienia, a zaległe prośby wtedy wygasają.

## Bez modułów opcjonalnych

Bez `invoices` — płatnicy widzą opłacane zamówienia, ale nie mogą pobrać ich faktur.
Bez `credit_limits` — dla płatnika nie jest oferowana metoda płatności w ramach limitu kredytowego.
Bez `customer_notifications` i `admin_notifications` — brak wpisów w centrum powiadomień i w dzwonku;
e-maile nadal są wysyłane, a kolejka nadal pokazuje każdy wpis.

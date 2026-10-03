---
title: transactional_emails
description: E-maile transakcyjne edytowane w panelu administracyjnym — temat, treść i wygląd, globalnie i dla poszczególnych kanałów sprzedaży
---

# `transactional_emails`

E-maile transakcyjne edytowane w panelu administracyjnym. Moduł pozwala operatorom zmieniać
**temat**, **treść** i **wygląd** każdego e-maila transakcyjnego wysyłanego przez platformę —
globalnie i osobno dla każdego **kanału sprzedaży** — w panelu administracyjnym, w edytorze WYSIWYG
bezpiecznym dla programów pocztowych i spójnym z Page Builderem modułu CMS. Każdy e-mail jest
opisany **definicją** rejestrowaną przez moduł, do którego należy (orders, returns, organizations,
inventory…), a ta definicja dostarcza domyślny temat, domyślną treść oraz zestaw zmiennych, które
logika biznesowa podstawia w chwili wysyłki.

## Pojęcia

- **Definicja (Definition)** — zarejestrowany e-mail identyfikowany unikalnym `code` (np.
  `order_confirmation`). Zawiera moduł, do którego należy, zadeklarowane zmienne (z przykładowymi
  wartościami do podglądu), obsługiwane języki oraz domyślny temat i treść dostarczone przez moduł.
  Przy starcie jest uzgadniana z tabelą `transactional_emails`; osierocone definicje (gdy moduł, do
  którego należały, odinstalowano) są usuwane.
- **Treść (Content)** — dostosowanie wprowadzone przez administratora dla danego zakresu i języka,
  przechowywane w `transactional_email_contents`. W chwili wysyłki treść jest ustalana w kolejności
  **kanał → ustawienie globalne → wartość domyślna modułu**, z przejściem na domyślny język kanału.
  Brak wiersza oznacza „użyj kolejnego poziomu”; **Reset** usuwa wiersz.
- **Bloki i szablony (Blocks & Templates)** — fragmenty bezpieczne dla e-maili, do wielokrotnego
  użytku. Bloki są osadzane po `code` przez `EmailInsertBlock`. Szablony e-maili pozostają osobną
  listą w panelu administracyjnym (stosowanie i zapisywanie poza obszarem roboczym edytora);
  `EmailInsertTemplate` usunięto z palety (starsze drzewa treści nadal się wyświetlają). Systemowe
  bloki tworzone przy instalacji — `default_email_header` (pokazuje oznakowanie marki przez
  `EmailLogo` / `{{var branding.logoUrl}}`) i `default_email_footer` — są automatycznie dołączane do
  domyślnej treści.
- **Oznakowanie marki (Branding)** — logo w nagłówku, kolor wyróżniający oraz kody domyślnych bloków
  nagłówka i stopki, ustalane dla każdego zakresu przez moduł ustawień (`transactional_emails.*`).
  Ustalone logo jest dostępne w każdym e-mailu jako `{{var branding.logoUrl}}`.
- **Zmienne (Variables)** — dyrektywy w stylu Magento 2 w treści i temacie: `{{var path}}`,
  `{{if path}}…{{/if}}`, `{{for alias in list}}…{{/for}}`. Wartości są escapowane w treści HTML i
  wstawiane bez zmian w wersji tekstowej. Brakująca wartość daje pusty tekst — e-mail nigdy nie jest
  wysyłany z nierozwiązanym `{{…}}`, a brakująca zmienna nigdy nie powoduje niepowodzenia wysyłki.
  Edytor w panelu administracyjnym udostępnia listę **Insert variable** (w temacie, polach tekstowych
  i pasku narzędzi edytora tekstu sformatowanego), zasilaną zmiennymi zadeklarowanymi dla e-maila i
  kluczami oznakowania marki.

## Edytor e-maili

Edytor e-maili transakcyjnych (i newslettera) korzysta ze wspólnego `EmailEditorPane`:

- Paleta Puck bezpieczna dla e-maili z `@endora-commerce/email-components` (bez punktów przełamania
  CMS i bez responsywnego układania elementów jeden pod drugim). **Row** otwiera wybór układu kolumn
  (1–6 kolumn), tak jak w CMS; kolumny w chwili wysyłki tworzą stałą tabelę, a w obszarze roboczym —
  12-kolumnową siatkę CMS. **Column** nie ma na liście palety (występuje tylko wewnątrz Row).
  **Table** to siatka danych (nagłówki i wiersze, jak SimpleTable w CMS).
- Obszar roboczy ma stałą szerokość wiadomości (**600px**) i panel Outline, tak jak w CMS. **Preview
  email** otwiera okno z wyrenderowanym HTML i przykładowymi wartościami zmiennych oraz opcjami
  **Desktop mail (600px)** / **Narrow (320px)** (płynny kontener `max-width:600px`, więc wąski
  podgląd nie wychodzi poza okno). **Save as template** / **Apply template** korzystają z akcji
  nagłówka CMS, ale działają na szablonach e-maili transakcyjnych (`email_templates`).
- `EmailLogo` pokazuje logo z oznakowania marki (bez pola na adres URL). `EmailImage` przyjmuje adres
  URL albo zasób z biblioteki mediów, tak jak w CMS. Pola kolorów korzystają ze wspólnej palety
  kolorów CMS. Logo w ustawieniach oznakowania marki (`*_asset_id`) wybiera się w selektorze
  Biblioteki mediów.
- `EmailRichText` korzysta z edytora tekstu sformatowanego TipTap z CMS (z dodatkiem zmiennych).
- `EmailProductCard` wybiera produkt z katalogu; `EmailOrderSummary` to przełączniki kolumn i sum i
  pojawia się w palecie tylko wtedy, gdy e-mail deklaruje `order.items` (obecnie tylko **Order
  confirmation**). Potwierdzenie zamówienia udostępnia też opisane bloki szczegółów: Order ID,
  Billing/Shipping address, Summary, Applied discounts, Delivery method, Payment method (każdy
  dostępny tylko wtedy, gdy istnieje jego zmienna szablonu).
- Bloki treści obejmują układ (`EmailSection`, `EmailRow`/`EmailColumn`, tabelę, odstęp, separator),
  tekst (`EmailText`, `EmailRichText`, nagłówki, wyróżnienie, stopkę i informacje prawne), media
  (`EmailImage`, `EmailLogo`), handel (`EmailProductCard`, `EmailOrderSummary` i opisane wyżej bloki
  szczegółów zamówienia), `EmailSocial` (ikony, etykiety i włączanie każdego linku osobno) oraz
  `EmailInsertBlock`.

## Renderowanie

Renderowanie odbywa się **po stronie serwera** w pakiecie `@endora-commerce/email-components`,
utrzymywanym w tym repozytorium (bez Reacta): drzewo treści Puck jest przechodzone i zamieniane na
HTML oparty na tabelach, ze stylami wpisanymi w elementy, bezpieczny dla programów pocztowych, oraz
na wersję tekstową. Edytor w panelu administracyjnym korzysta z tej samej palety komponentów
bezpiecznych dla e-maili. HTML z `EmailRichText` przed wysyłką jest oczyszczany według listy
dozwolonych znaczników (`p/strong/em/u/a/ul/ol/li/br`); znaczniki dyrektyw w tekście są zachowywane.

## Rejestrowanie e-maila w module

```ts
// manifest.ts
transactionalEmails: [
  { code: 'order_confirmation', name: 'Order confirmation', group: 'orders',
    variables: [{ key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' }] },
],

// plugin.ts (default subject + content)
emailDefaultsRegistry.register('order_confirmation', { defaultSubject, defaultContent });
```

Moduł, do którego należy e-mail, wysyła go przez port `TransactionalEmailSender` (wstrzykiwany przez
kompozycję), zachowując dotychczasową idempotentność opartą na `messageId`:

```ts
await sender.send({
  code: 'order_confirmation',
  salesChannelId, language, to,
  messageId: `order_confirmation:${order.id}`,
  variables: { order: { businessId, items: [...] }, customer: { firstName } },
});
```

Gdy nadawca nie jest podłączony, moduły wracają do starszych mechanizmów budowania wiadomości w
kodzie, więc w środowiskach bez tego modułu zachowanie się nie zmienia.

## Podgląd

`POST /api/v1/admin/transactional-emails/{code}/preview` renderuje e-mail z zadeklarowanymi
przykładowymi wartościami wszystkich zmiennych (i z ewentualną niezapisaną treścią roboczą), zwracając
`{ subject, html, text }`. Panel administracyjny otwiera HTML w nowej karcie.

## Wyłączanie e-maila

Samego modułu **nie da się wyłączyć**: każde wdrożenie wysyła przez niego weryfikację konta,
zaproszenia i wiadomości dotyczące zamówień, więc `/platform/modules` pokazuje go jako zablokowany,
z tym powodem, zamiast przełącznika. Wyłączać *można* natomiast pojedyncze e-maile — lista na
`/transactional-emails` ma przełącznik w każdym wierszu, obsługiwany przez
`POST /api/v1/admin/transactional-emails/{code}/activation` z `{ active }`. Przełączenie przechodzi
przez Command Bus, więc jest audytowane jako `transactional_email.activation.set` i odwracalne; nie
usuwa treści, nadpisań ani dostosowań dla kanałów. Wyłączony e-mail w chwili wysyłki odpowiada
`{ status: 'deactivated' }` i **nie jest wysyłana żadna wiadomość zastępcza**.

E-maili potrzebnych do założenia konta lub odzyskania do niego dostępu w ogóle nie można wyłączyć:
obecnie są to `email_verification` i `organization_invitation`. Deklaracja znajduje się we wpisie
rejestru modułu, do którego należy e-mail (`EmailDefaults.nonDeactivatable`), a nie na liście
utrzymywanej przez ten moduł czy panel administracyjny, a odrzucone przełączenie zwraca
`409 TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` z powodem podanym przez ten moduł — w tej samej postaci,
jakiej używa odmowa na poziomie modułu.

## Zapis dostarczenia

Każda wysyłka pozostawia jeden wiersz w `email_deliveries` — tabeli należącej do modułu `email`:
o losie wiadomości decyduje transport, więc tam znajduje się zapis tego losu. Wiersz zawiera
odbiorcę, kod e-maila, kanał sprzedaży, identyfikator wiadomości, dokument biznesowy, który
wiadomość dostarczała (zwykle fakturę), wynik i czas próby.

Wynik jest jednym z trzech, a ten podział jest istotą tabeli:

| Status | Znaczenie | Typowy powód |
| --- | --- | --- |
| `sent` | transport przyjął wiadomość | — |
| `suppressed` | platforma celowo jej nie wysłała | `deactivated` (operator wyłączył ten e-mail), `duplicate_message_id` |
| `failed` | wiadomość miała zostać wysłana i nie została | `transport_error`, `no_transport`, `no_definition` |

Operator, który pyta, „czy klient dostał fakturę”, dostaje więc odpowiedź, która przetrwa rotację
logów i nie myli konfiguracji, którą sam wybrał, z awarią. To **dostarczanie bez gwarancji, ale z
trwałym zapisem**, a nie dostarczanie gwarantowane: nie ma kolejki ponowień ani skrzynki nadawczej
(outbox), ponowna wysyłka pozostaje działaniem operatora, a wiadomość utracona między zapisem
biznesowym a wywołaniem transportu przepada. Tabela nie ma jeszcze ekranu w panelu administracyjnym
— odczytuje się ją bezpośrednio z bazy danych.

## Uprawnienia

- `transactional_emails:read` — przeglądanie e-maili, bloków, szablonów, oznakowania marki i podglądu.
- `transactional_emails:write` — edycja treści i oznakowania marki oraz zarządzanie blokami i
  szablonami.

## Zarejestrowane e-maile

Przez ten mechanizm przechodzą wszystkie wcześniejsze e-maile transakcyjne: zamówienia (potwierdzenie,
komentarz, ponowne zamówienie, zamówienie utworzone przez administratora), zwroty (zaakceptowany,
odrzucony), organizacje (weryfikacja, zaproszenie, nowa rejestracja) oraz magazyn (niski stan,
ponowna dostępność). Zarejestrowano też dwa nowe e-maile wysyłane przez subskrybentów zdarzeń:
płatności (`payment_status_changed`, przy otrzymaniu lub niepowodzeniu płatności) i przesyłki
(`shipment_created`, przy utworzeniu przesyłki).

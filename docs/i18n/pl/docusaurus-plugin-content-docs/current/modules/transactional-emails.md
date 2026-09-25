---
title: transactional_emails
description: E-maile transakcyjne edytowalne w adminie — temat, treść i wygląd, globalnie i per sales channel
---

# `transactional_emails`

E-maile transakcyjne edytowalne w adminie. Pozwala operatorom zmieniać **temat**,
**treść** i **wygląd** każdego e-maila transakcyjnego wysyłanego przez platformę —
globalnie i per **Sales Channel** — z Admin UI, używając edytora WYSIWYG
bezpiecznego dla klientów pocztowych, spójnego z CMS Page Builderem. Każdy
e-mail jest opisany przez **definition** zarejestrowaną przez moduł, który go
posiada (orders, returns, organizations, inventory, …), dostarczając domyślny
subject + domyślną treść oraz zestaw zmiennych, które logika biznesowa
podstawia w momencie wysyłki.

## Pojęcia

- **Definition** — zarejestrowany e-mail identyfikowany unikalnym `code` (np.
  `order_confirmation`). Niesie moduł właściciela, zadeklarowane zmienne (ze
  sample values do podglądu), wspierane języki oraz domyślny subject + content
  dostarczone przez moduł. Reconcilowany do `transactional_emails` przy boot;
  osierocone definitions (moduł właściciel odinstalowany) są przycinane.
- **Content** — customizacja admina per scope, per język, przechowywana w
  `transactional_email_contents`. Rozwiązywanie w momencie wysyłki to
  **per-channel → global → module default**, z fallbackiem do domyślnego języka
  kanału. Brak wiersza oznacza „fallback”; **Reset** go usuwa.
- **Blocks & Templates** — wielokrotnie używane fragmenty bezpieczne dla e-maili.
  Bloki są osadzane po `code` przez `EmailInsertBlock`. Szablony e-maili
  pozostają osobną listą admina (apply/save poza canvas); `EmailInsertTemplate`
  jest wycofany z palety (legacy trees nadal renderują). Seedowane systemowe bloki
  `default_email_header` (renderuje branding przez `EmailLogo` / `{{var branding.logoUrl}}`) i `default_email_footer`
  są auto-dołączane do domyślnej treści.
- **Branding** — logo w nagłówku, kolor akcentu oraz kody domyślnych bloków
  header/footer, rozwiązywane per scope przez moduł Settings
  (`transactional_emails.*`). Rozwiązane logo jest eksponowane każdemu e-mailowi jako
  `{{var branding.logoUrl}}`.
- **Variables** — dyrektywy w stylu Magento 2 nad content + subject:
  `{{var path}}`, `{{if path}}…{{/if}}`, `{{for alias in list}}…{{/for}}`. Wartości
  są HTML-escaped w body HTML i raw w alternatywie plain-text. Brakująca wartość
  rozwiązuje się do pustego — e-mail nigdy nie jest wysyłany z nierozwiązanym
  `{{…}}`, a brakująca zmienna nigdy nie fail'uje wysyłki. Edytor admina eksponuje
  picker **Insert variable** (subject, pola plain text i toolbar rich text)
  zasilany zadeklarowanymi zmiennymi e-maila plus kluczami brandingu.

## Edytor e-maili

Edytory transakcyjne (i newsletter) współdzielą `EmailEditorPane`:

- Paleta Puck bezpieczna dla e-maili z `@endora-commerce/email-components` (bez
  breakpointów CMS / responsive stacking). **Row** otwiera picker układu kolumn
  (1–6 kolumn) jak CMS; kolumny używają stałej tabeli w momencie wysyłki i siatki
  CMS 12-col na canvas. **Column** nie jest na liście palety (tylko wewnątrz Row).
  **Table** to siatka danych (nagłówki + wiersze, jak CMS SimpleTable).
- Canvas ma stałą szerokość maila (**600px**), z panelem Outline jak CMS.
  Użyj **Preview email** dla modalnego renderu HTML ze sample variable data oraz
  opcji **Desktop mail (600px)** / **Narrow (320px)** (płynna powłoka
  `max-width:600px`, więc wąski podgląd nie overflow'uje).
  **Save as template** / **Apply template** reużywają akcji nagłówka CMS względem
  szablonów e-maili transakcyjnych (`email_templates`).
- `EmailLogo` pokazuje logo brandingu (bez pola URL). `EmailImage` wspiera URL lub
  bibliotekę assetów, jak CMS. Pola kolorów używają wspólnej palety kolorów CMS.
  Logo brandingu w Settings (`*_asset_id`) używa pickera Assets Library.
- `EmailRichText` reużywa edytora CMS Rich Content TipTap (plus Variable).
- `EmailProductCard` wybiera produkt katalogu; `EmailOrderSummary` to przełączniki
  kolumn/totali i pojawia się w palecie tylko, gdy e-mail deklaruje `order.items`
  (dziś: tylko **Order confirmation**). Order confirmation eksponuje też
  oznakowane bloki szczegółów: Order ID, Billing/Shipping address, Summary,
  Applied discounts, Delivery method, Payment method (każdy gated na swoją
  zmienną szablonu).
- Bloki treści obejmują layout (`EmailSection`, `EmailRow`/`EmailColumn`, table,
  spacer, divider),
  copy (`EmailText`, `EmailRichText`, headings, callout, footer/legal), media
  (`EmailImage`, `EmailLogo`), commerce (`EmailProductCard`, `EmailOrderSummary`
  i powyższe bloki szczegółów zamówienia), `EmailSocial` (ikony + etykiety +
  enable per link) oraz `EmailInsertBlock`.

## Renderowanie

Renderowanie wykonywane jest **po stronie serwera** przez first-party pakiet
`@endora-commerce/email-components` (React-free): drzewo treści Puck jest
przechodzone i emitowane jako HTML oparty na tabelach, inline-styled, bezpieczny
dla klientów pocztowych plus alternatywa plain-text. Edytor admina reużywa tę
samą paletę komponentów bezpieczną dla e-maili.
HTML `EmailRichText` jest whitelist-sanitized (`p/strong/em/u/a/ul/ol/li/br`)
przed wysyłką; markery dyrektyw w tekście są zachowane.

## Rejestrowanie e-maila z modułu

```ts
// manifest.ts
transactionalEmails: [
  { code: 'order_confirmation', name: 'Order confirmation', group: 'orders',
    variables: [{ key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' }] },
],

// plugin.ts (default subject + content)
emailDefaultsRegistry.register('order_confirmation', { defaultSubject, defaultContent });
```

Moduł właściciel wysyła przez port `TransactionalEmailSender` (wstrzykiwany przez
composition), zachowując istniejące idempotency `messageId`:

```ts
await sender.send({
  code: 'order_confirmation',
  salesChannelId, language, to,
  messageId: `order_confirmation:${order.id}`,
  variables: { order: { businessId, items: [...] }, customer: { firstName } },
});
```

Gdy sender nie jest podłączony, moduły fallbackują do legacy builderów in-code,
więc zachowanie jest niezmienione w środowiskach bez modułu.

## Podgląd

`POST /api/v1/admin/transactional-emails/{code}/preview` renderuje e-mail z
zadeklarowaną sample value każdej zmiennej (i dowolną niesave'owaną treścią
draft), zwracając `{ subject, html, text }`. Admin otwiera HTML w nowej karcie.

## Wyłączanie e-maila

Sam moduł jest **non-deactivatable**: każde wdrożenie wysyła weryfikację konta,
zaproszenia i mail zamówieniowy przez niego, więc `/platform/modules`
renderuje go zablokowanym z tym powodem zamiast jako toggle. Granularność, która
*jest* oferowana, to pojedynczy e-mail — lista na `/transactional-emails`
niesie przełącznik per wiersz, wspierany przez
`POST /api/v1/admin/transactional-emails/{code}/activation` z `{ active }`.
Flip przechodzi przez Command Bus, więc jest audytowany jako
`transactional_email.activation.set` i odwracalny; nie usuwa treści, override
ani customizacji per kanał. Dezaktywowany e-mail odpowiada
`{ status: 'deactivated' }` w momencie wysyłki i **nie wychodzi żaden fallback mail**.

E-maile wymagane do utworzenia konta lub powrotu do niego nie mogą być
wyłączone w ogóle: dziś `email_verification` i `organization_invitation`.
Deklaracja żyje na wpisie rejestru modułu właściciela
(`EmailDefaults.nonDeactivatable`), nie na liście trzymanej przez ten moduł ani
Admin UI, a odmówiony flip odpowiada `409 TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`
niosąc własny powód tego modułu — ten sam kształt, jaki używa odmowa na poziomie
modułu.

## Rekord dostawy

Każda wysyłka zostawia jeden wiersz w `email_deliveries`, tabeli należącej do
modułu `email` — transport jest miejscem, gdzie decyduje się los wiadomości, więc
tam żyje rekord tego losu. Wiersz niesie odbiorcę, kod e-maila, sales channel,
message id, dokument biznesowy, który wiadomość dostarczyła (faktura, typowo),
wynik i moment próby.

Wynik to jeden z trzech, a podział jest sednem tabeli:

| Status | Means | Typical reason |
| --- | --- | --- |
| `sent` | transport zaakceptował wiadomość | — |
| `suppressed` | platforma celowo nie wysłała | `deactivated` (operator wyłączył ten e-mail), `duplicate_message_id` |
| `failed` | wiadomość miała wyjść i nie wyszła | `transport_error`, `no_transport`, `no_definition` |

Operator pytający „czy klient dostał fakturę” dostaje więc odpowiedź, która
przeżywa rotację logów i nie myli konfiguracji, którą wybrał, z awarią. To
**best-effort delivery z trwałym rekordem**, nie guaranteed delivery: nie ma kolejki
retry ani outbox, resend pozostaje akcją operatora, a wiadomość utracona między
zapisem biznesowym a wywołaniem transportu jest utracona. Nie ma jeszcze ekranu
admina nad tabelą — czyta się ją z bazy.

## Uprawnienia

- `transactional_emails:read` — podgląd e-maili, bloków, szablonów, brandingu, preview.
- `transactional_emails:write` — edycja treści, brandingu i zarządzanie blokami/szablonami.

## Zarejestrowane e-maile

Wszystkie wcześniejsze e-maile transakcyjne przechodzą przez ten mechanizm:
orders (confirmation, comment, reorder, admin-created), returns (authorized,
rejected), organizations (verification, invitation, new-registration) oraz
inventory (low-stock, back-in-stock). Dwa nowe e-maile są też zarejestrowane i
dispatchowane przez event subscriberów: payments (`payment_status_changed`, przy
payment received/failed) i shipments (`shipment_created`, przy utworzeniu
shipment).

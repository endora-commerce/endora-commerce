---
title: Rozszerzanie Page Buildera
sidebar_position: 2
---

# Rozszerzanie Page Buildera

Moduł CMS dostarcza wbudowane komponenty — `Row`, `Columns`, `Text`, `Heading`, `Button`,
`InsertBlock` i inne — ale każdy inny moduł backendu może dodawać własne komponenty.
(`InsertTemplate` pozostaje zarejestrowany ze względu na dawne drzewa treści, ale nie ma go już w
palecie komponentów). W ten sposób bloki dodają już moduły `cms`, `catalog`, `orders`, `invoices` i
`transactional_emails`. Moduł, który dodaje komponent, robi to w dwóch miejscach:

1. **Deklaracja w manifeście**: zadeklaruj metadane bloku — nazwę, etykiety,
   kategorię palety, konteksty i edytowalne pola — we własnym `manifest.ts`
   modułu. Moduł CMS buduje rejestr Page Buildera z manifestów złożonych
   modułów, więc nie ma żadnego wywołania rejestracji do napisania.
2. **Komponenty wyświetlające**: dostarcz, we własnym pakiecie modułu, kod,
   który wyświetla blok na storefroncie, w e-mailu i w edytorach panelu.

## 1. Deklaracja bloku w manifeście

Dodaj `blocks` i `blockCategories` do manifestu modułu:

```ts
// the promotions module: src/manifest.ts
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'promotions',
  // ...name, version, dependencies...
  blocks: [
    {
      name: 'promotions.PromoBanner',
      labelKey: 'blocks.promoBanner.label',
      descriptionKey: 'blocks.promoBanner.description',
      category: 'promotions',
      /** Omit email/invoice — this component is storefront-only. */
      contexts: ['cms'],
      fields: {
        headline: { type: 'text', label: 'Headline', required: true },
        codeInput: { type: 'text', label: 'Promo code' },
        tone: {
          type: 'select',
          label: 'Tone',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Urgent', value: 'urgent' },
          ],
        },
      },
      previewIcon: 'ticket',
      weight: 10,
    },
  ],
  blockCategories: [
    { key: 'promotions', titleKey: 'blocks.category.promotions', contexts: ['cms'] },
  ],
});
```

Schematy to `BlockDefinitionSchema` i `BlockCategorySchema` w
`packages/contracts/src/cms.ts`. `defineModuleManifest` odrzuca manifest,
który łamie jedną z dwóch reguł:

- Nazwa bloku (`name`) ma postać `<module id>.<PascalCaseName>`, a część przed
  kropką musi być `id` modułu deklarującego. Nazwa jest zapisywana w
  przechowywanej treści strony i nigdy nie jest przepisywana, więc wybierz ją
  raz.
- `category` bloku musi być zadeklarowana w `blockCategories` tego samego
  manifestu dla każdego kontekstu, który blok wymienia. Kilka modułów może
  zadeklarować ten sam klucz kategorii; paleta je scala.

`labelKey`, `descriptionKey` i `titleKey` są względne wobec własnego bundla
i18n modułu deklarującego (`blocks.promoBanner.label`, a nie
`promotions.blocks.promoBanner.label`). Nic nie może tego sprawdzić w chwili
definiowania manifestu, więc trzeba o to zadbać ręcznie.

Typy pól pochodzą ze zamkniętego enum zadeklarowanego w
`packages/contracts/src/cms.ts`: `text | textarea | number | select |
radio | array | object | external | uuid | richtext`. Te metadane są
wolne od React; backend nigdy nie importuje komponentu wyświetlającego.

Blok jest oferowany tylko wtedy, gdy jego moduł jest obecny: rejestr filtruje
deklaracje według obecności modułu, odpowiadając na
`GET /api/v1/admin/cms/page-builder/config`, więc wyłączony moduł zabiera
swoje bloki z palety.

## 2. Komponenty wyświetlające

Pakiet modułu sam wyświetla swoje bloki. Służą do tego najwyżej trzy
**warstwy** — po jednej na każdy proces, który wyświetla blok — oraz
opcjonalny arkusz stylów. Każda jest ścieżką w mapie `exports` pakietu i każda
jest opcjonalna: moduł, którego bloki trafiają tylko do e-maili, dostarcza
warstwę e-mail i nic więcej.

| Ścieżka | Co eksportuje | Kto z niej korzysta |
| --- | --- | --- |
| `./storefront` | `contributions` — komponenty React wyświetlające bloki modułu w kontekście `cms` | storefront, w kodzie HTML generowanym po stronie serwera |
| `./email` | `emailBlocks` — czyste funkcje zamieniające bloki modułu w kontekście `email` na HTML i tekst | backend podczas wysyłki oraz edytor e-maili w panelu |
| `./admin` | `contributions.blocks` — komponenty dla edytorów, obok tras i stref modułu | edytor CMS i edytor e-maili w panelu |
| `./blocks.css` | jeden gotowy arkusz stylów | storefront i edytor w panelu |

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/package.json -->
```json
"exports": {
  ".": {
    "types": "./dist/manifest.d.ts",
    "default": "./dist/manifest.js"
  },
  "./backend": {
    "types": "./dist/backend/index.d.ts",
    "default": "./dist/backend/index.js"
  },
  "./admin": {
    "types": "./dist/admin/index.d.ts",
    "default": "./dist/admin/index.js"
  },
  "./storefront": {
    "types": "./dist/storefront/index.d.ts",
    "default": "./dist/storefront/index.js"
  },
  "./email": {
    "types": "./dist/email/index.d.ts",
    "default": "./dist/email/index.js"
  },
  "./blocks.css": "./blocks.css",
```

Każda warstwa publikuje deklaracje typów obok kodu JavaScript (warunek `types`
powyżej): storefront napisany w TypeScripcie importuje `./storefront` ze
swojego wygenerowanego rejestru, a `blocks:generate` odrzuca warstwę bez
deklaracji, zamiast pozwolić, by dopiero budowanie się na niej wyłożyło.

Przykłady poniżej pochodzą z modułu, na którym platforma sama sprawdza ten
mechanizm — modułu spoza wszystkich pakietów platformy, który wyświetla jeden
blok, `acceptance_blocks.Badge`, na wszystkich trzech powierzchniach.

Każdy komponent wyświetlający jest przypisany do pełnej nazwy bloku, a pakiet
wyświetla wyłącznie bloki, które **deklaruje jego własny manifest**, i tylko w
kontekście, który ten blok deklaruje: `cms` dla storefrontu i edytora CMS,
`email` dla e-maili. Nazwę zapisz jako literał tekstowy — w manifeście i w
każdej warstwie.

### Warstwa storefrontu

`src/storefront/index.ts` eksportuje `contributions`: mapę z nazwy bloku na
konfigurację komponentu Puck:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/storefront/index.ts -->
```ts
export const contributions: StorefrontContributions = {
  blocks: {
    'acceptance_blocks.Badge': {
      defaultProps: { text: 'New badge', explode: 'no' },
      render: Badge,
    },
  },
};
```

Komponent wyświetlający to zwykły komponent React. Jego właściwościami są
zapisane właściwości bloku, pod które podstawiono powyższe `defaultProps` —
dzięki temu właściwość dodana przez moduł po zapisaniu strony nadal ma wartość:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/storefront/Badge.tsx -->
```tsx
export function Badge({ text, explode }: BadgeProps): ReactNode {
  const { language } = useBlockRenderEnvironment();
  if (explode === true || explode === 'yes') {
    throw new Error('acceptance_blocks.Badge was asked to fail on render');
  }
  const label = LABEL[language.slice(0, 2).toLowerCase()] ?? LABEL['en'];
  return (
    <span className="acceptance_blocks-badge" title={label}>
      {`acceptance-badge:${String(text ?? '')}`}
    </span>
  );
}
```

Komponent storefrontu jest wykonywany raz na serwerze i raz w przeglądarce,
dlatego:

- jest **synchroniczny** — bez komponentów `async` — i podczas renderowania nie
  czyta żadnego obiektu przeglądarki (`window`, `document`, `localStorage`);
  wolno to robić tylko w efekcie;
- dla tych samych właściwości daje ten sam wynik na serwerze i w przeglądarce:
  bez `Date.now()`, bez `Math.random()` i bez formatowania zależnego od języka,
  jeśli język nie pochodzi z `useBlockRenderEnvironment()`;
- każdy plik warstwy zaczyna się od `'use client'`;
- importuje wyłącznie `react`, `react-dom`, `@puckeditor/core`,
  `@endora-commerce/page-builder-core`, `@endora-commerce/cms-components`,
  `@endora-commerce/contracts` i własne pliki. Żadnego kodu serwerowego, pakietu
  panelu, platformy ani innego modułu. Potrzebne dane bierze z właściwości, z
  kontekstu renderowania CMS albo pobiera je w efekcie;
- właściwości bloku to **dane niezaufane**: HTML wstawia się wyłącznie jako
  `dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }}`, z
  `sanitizeRichHtml` z `@endora-commerce/cms-components`;
- etykieta, którą komponent wypisuje sam — niebędąca treścią operatora — jest
  dostarczana w warstwie po angielsku i po polsku i wybierana na podstawie
  `useBlockRenderEnvironment().language`; językiem zapasowym jest angielski.

**Instalacja.** Właściciel storefrontu dodaje pakiet do swojego storefrontu i
go buduje. Polecenie `blocks:generate`, uruchamiane przez skrypty `dev` i
`build` storefrontu, znajduje każdy zainstalowany pakiet modułu deklarujący
`./storefront` lub `./blocks.css` i zapisuje rejestr oraz import arkusza stylów
— nie trzeba dopisywać niczego w żadnym pliku. Gdy `endora install` zapisuje
instancję i storefront w jednym przebiegu, dopisuje do zależności storefrontu
moduły instancji, które publikują warstwę storefrontu — jeden raz; potem ta
lista należy do właściciela storefrontu.

**Blok, którego nie wyświetla żaden pakiet.** Storefront może też wyświetlić
blok samodzielnie — zwykle taki, który deklaruje moduł nakładkowy (overlay)
jego własnej instancji — dopisując go w `lib/page-builder/local-blocks.tsx`,
jedynym pliku rejestru bloków, który należy do właściciela storefrontu. Blok
lokalny nigdy nie zastępuje bloku, który wyświetla już pakiet albo platforma.

### Warstwa e-mail

`src/email/index.ts` eksportuje `emailBlocks`. Każdy element to czysta funkcja
— bez Reacta i bez operacji wejścia-wyjścia — która zwraca wiersze tabeli
tworzącej układ e-maila i zabezpiecza każdą właściwość przed wstrzyknięciem
HTML:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/email/index.ts -->
```ts
export const emailBlocks: EmailBlockRenderers = {
  'acceptance_blocks.Badge': {
    defaultProps: { text: 'New badge' },
    html: (props: BadgeProps, ctx) => {
      assertRenderable(props);
      return (
        '<tr><td style="padding:8px 24px;font-family:Arial,Helvetica,sans-serif;">' +
        `<span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:${ctx.accentColor};color:#ffffff;font-size:14px;font-weight:bold;">` +
        `acceptance-badge:${escapeHtml(String(props.text ?? ''))}` +
        '</span></td></tr>'
      );
    },
    text: (props: BadgeProps) => {
      assertRenderable(props);
      return `acceptance-badge:${String(props.text ?? '')}\n`;
    },
  },
};
```

Pole `text` jest opcjonalne; bez niego część tekstowa powstaje z kodu HTML.
Dyrektywy `{{var …}}` w wyniku są rozwijane później, dokładnie tak jak we
wbudowanym bloku. Warstwa importuje wyłącznie
`@endora-commerce/email-components/render/*`, `@endora-commerce/contracts` i
własne pliki, ponieważ ta sama funkcja działa w backendzie i w przeglądarce
administratora.

Backend modułu rejestruje funkcje podczas startu platformy, a manifest modułu
wymienia `email` w `dependencies`:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/backend/index.ts -->
```ts
export function registerModule(ctx: ModuleContext): void {
  // From a boot hook, unprobed: the registry is ungated and decides presence
  // itself, per render, on the contributor recorded here — so switching this
  // module off, or back on, needs no restart and no re-registration.
  ctx.onBoot(() => {
    lazyPort<EmailBlockRendererRegistryPort>(ctx, 'emailBlockRendererRegistry').register(
      'acceptance_blocks',
      emailBlocks,
    );
  });
}
```

Przez ten rejestr przechodzą zarówno e-maile transakcyjne, jak i kampanie
newslettera. Wbudowanego bloku e-mail nie da się nadpisać: funkcja dostarczona
przez moduł jest używana tylko dla nazwy, której platforma nie wyświetla sama.

### Warstwa panelu

Warstwa `./admin` modułu — ta sama, która deklaruje jego trasy i wkłady do
stref — wymienia po jednym komponencie edytora na blok i edytor:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/index.ts -->
```ts
export const contributions: AdminContributions = {
  blocks: [
    {
      name: 'acceptance_blocks.Badge',
      context: 'cms',
      component: () => import('./badge-editor.js'),
    },
    {
      name: 'acceptance_blocks.Badge',
      context: 'email',
      component: () => import('./badge-email.js'),
    },
  ],
};
```

W edytorze CMS eksportem domyślnym jest komponent wyświetlający blok — zwykle
ten sam, którego używa storefront, więc obszar roboczy pokazuje to, co
wyświetli storefront:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/badge-editor.tsx -->
```tsx
const editor: PageBuilderBlockEditorConfig = { render: Badge };

export default editor;
```

W edytorze e-maili jest nim funkcja z warstwy e-mail, czyli ta, którą wykonuje
wysyłka, więc obszar roboczy i podgląd nie mogą różnić się od wiadomości:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/badge-email.ts -->
```ts
export default emailBlocks['acceptance_blocks.Badge'];
```

Etykieta bloku, sekcja palety, wartości domyślne i zestaw pól pochodzą z
deklaracji w manifeście, a nie z wkładu. Konfiguracja edytora CMS może zawierać
`fields`, aby zastąpić edytor pola zadeklarowanego w manifeście — na przykład
selektorem zamiast pola tekstowego — ale nie może dodać pola, którego manifest
nie deklaruje.

Zadeklarowany blok **bez** komponentu edytora nadal można wstawić i edytować:
edytor buduje pola z deklaracji w manifeście i pokazuje neutralny podgląd z
nazwą bloku. Tak właśnie wygląda blok modułu nakładkowego, bo moduł nakładkowy
nie ma warstwy panelu.

### Arkusz stylów bloków

`./blocks.css` to jeden gotowy arkusz stylów. Każdy selektor znajduje się pod
klasą z prefiksem identyfikatora modułu, a kolory i kroje pisma pochodzą z
właściwości niestandardowych motywu storefrontu, z dosłownymi wartościami
zapasowymi — dzięki temu blok dopasowuje się do motywu kanału i nadal
wyświetla się w obszarze roboczym panelu:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/blocks.css -->
```css
.acceptance_blocks-badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: var(--r-md, 6px);
  background: var(--brand-600, #2563eb);
  color: #ffffff;
```

Bez `@import`, bez `@tailwind`, bez `@source` i bez selektorów elementów.
Storefront importuje arkusz przez `blocks:generate`, a panel przez
`endora generate`.

### Gdy moduł jest wyłączony

Blok modułu wyłączonego przez operatora znika z każdej powierzchni, a w
zapisanej treści nic się nie zmienia:

| Powierzchnia | Co się dzieje |
| --- | --- |
| Storefront | blok nie wyświetla klientowi niczego; z parametrem `?cms_admin=1` wyświetla notkę z nazwą bloku |
| E-mail | blok nie dodaje niczego do HTML ani do tekstu |
| Edytory w panelu | zapisany blok jest widocznym symbolem zastępczym, który zachowuje swoje właściwości; bloku nie ma w palecie |

Ponowne włączenie modułu przywraca wszystkie trzy, a żaden dokument nie zmienia
się w międzyczasie. Storefront kieruje się listą modułów, które backend zgłasza
jako nieobecne, więc blok, którego właściciela backend nie zna — blok modułu
nakładkowego — nadal się wyświetla.

### Gdy komponent zawiedzie

Komponent, który zgłosi wyjątek, kosztuje stronę tylko ten jeden blok. Na
storefroncie i w edytorach staje się on takim samym symbolem zastępczym jak
blok bez komponentu, a bloki wokół pozostają nietknięte; w e-mailu nie dodaje
niczego, wiadomość i tak zostaje wysłana, a błąd trafia do logu wraz z nazwą
bloku i jego modułu.

### Sprawdzenie pakietu

Uruchom `endora check` w pakiecie modułu. Reguła `check:block-renderers`
zgłasza:

| Wynik | Znaczenie |
| --- | --- |
| `foreign-block-name` | komponent przypisany do bloku, który należy do innego modułu |
| `undeclared-block` | komponent dla bloku, którego manifest nie deklaruje albo nie deklaruje w kontekście tej powierzchni |
| `storefront-import` | warstwa storefrontu importuje coś spoza dozwolonego zestawu |
| `raw-html` | `dangerouslySetInnerHTML`, którego wartością nie jest `sanitizeRichHtml(…)` |
| `email-layer-import` | warstwa e-mail importuje Reacta, moduł wbudowany Node albo cokolwiek spoza renderera e-maili |
| `unscoped-stylesheet` | `./blocks.css` ma selektor poza prefiksem modułu albo dołącza inny arkusz stylów |
| `layer-without-subpath` | źródła warstwy istnieją, a mapa `exports` ich nie publikuje |

### Starsza treść musi się nadal wyświetlać

Nazwa bloku jest trwała, a jego zapisane właściwości żyją dłużej niż wersja
modułu, która je zapisała. Komponent musi wyświetlić każdy kształt właściwości,
jaki moduł kiedykolwiek opublikował: pominąć właściwość, której nie zna, i
użyć wartości domyślnej dla brakującej. Zmiana, której nie da się wprowadzić w
ten sposób, to nowy blok pod nową nazwą — a stary komponent zostaje.

## Przestrzenie nazw komponentów

Nazwy bloków są unikalne w całej platformie, a zapewnia to prefiks z id
modułu: `cms.Text`, `catalog.ProductCard`, `promotions.PromoBanner`. Dwa
moduły nie mogą zadeklarować tej samej nazwy — segment właściciela musi być
id modułu deklarującego — a jeśli kolizja mimo to dotrze do rejestru, rzuca
on `DuplicateBlockNameError`, zamiast pozwolić, by blok jednego modułu
zastąpił blok innego.

## Konteksty (`contexts`)

Każdy komponent deklaruje w `contexts`, w których edytorach Page Buildera może się pojawić:

| Kontekst | Kto z niego korzysta |
|---------|---------|
| `cms` | Strony, bloki i szablony CMS, blog |
| `email` | Edytor e-maili transakcyjnych |
| `newsletter` | Kampanie newslettera (ten sam zestaw komponentów bezpiecznych dla e-maili) |
| `invoice` | Edytor szablonów PDF faktur |

Zadeklaruj je przy bloku w manifeście. `contexts` jest wymagane i musi wymieniać co najmniej jedną
powierzchnię:

```ts
contexts: ['cms'], // CMS-only
```

Blok bez `email` / `invoice` w `contexts` nigdy nie pojawia się w tych
edytorach (np. karuzela produktów). Moduł dostarcza komponenty wyświetlające
dla kontekstów `cms` i `email`; edytor newslettera pokazuje bloki kontekstu
`email`, a bloki faktur wyświetla moduł faktur.

## Właściwości responsywne i widoczność (tylko CMS)

Page Builder w CMS obsługuje nadpisania dla poszczególnych progów szerokości, z dziedziczeniem
(telefon ← tablet ← komputer). Dla pojedynczych właściwości użyj `createResponsiveField` z
`@endora-commerce/page-builder-core`, a dla kontrolki **Visibility** komponentu —
`withResponsiveVisibility`.

Domyślne progi szerokości (konfigurowalne w ustawieniach `cms.page_builder.breakpoint.*` albo
zmiennymi środowiskowymi `CMS_PB_BREAKPOINT_*`):

- Telefon: &lt; 768px
- Tablet: 768–1023px
- Komputer: ≥ 1024px

Edytory e-maili i faktur mają jedną szerokość układu i nie pokazują pól responsywnych.

**Edytory e-maili** (transakcyjnych i newslettera) **nie** korzystają z podglądów CMS dla telefonu,
tabletu i komputera. Obszar edycji ma stałą szerokość **600 px** (szerokość e-maila). Okno
**Preview** oferuje podgląd HTML w szerokości **600 px** i **320 px**. Pola kolorów korzystają z
palety kolorów CMS.

## Zagnieżdżanie (sloty)

Komponenty układu (`Row`, `Columns`) korzystają z pól Puck typu **slot** — zagnieżdżona treść jest
przechowywana w `props`, a nie w dawnej mapie `zones`.

## Model pudełkowy (komponenty układu i treści CMS)

Komponenty układu i treści mają na zakładce Responsive pola **odstępu zewnętrznego** (margin),
**odstępu wewnętrznego** (padding) i **obramowania**. Wartości można ustawić jednakowo albo osobno dla
każdej strony. **Columns** ma responsywną liczbę kolumn (1–12 dla każdego progu) o równej szerokości.

Przy dodawaniu nowych komponentów CMS korzystaj z `createSpacingField`, `createBorderField` i
`createColorField` z `@endora-commerce/page-builder-core`.

## Wbudowane komponenty Icons i Social

- **`Icons`** — wybrana lista ikon Lucide (ok. 100) w
  `packages/cms-components/src/components/icon-catalog.ts`, z **graficzną siatką wyboru**
  (`IconPickerField`). Nie udostępniaj pełnego katalogu Lucide.
- **`Social`** — ikony serwisów przez `react-icons/fa6` (Facebook, X, Instagram, LinkedIn, YouTube,
  TikTok, …). Elementy tablicy korzystają z `getItemSummary`, aby na liście Links pojawiała się
  wybrana **nazwa serwisu**. Układy: `icons-only` | `icons-with-labels` | `vertical-list` | `pills`.

## Dodatkowe komponenty stron docelowych

| Komponent | Przeznaczenie |
| --------- | ------- |
| `Spacer` | Odstęp pionowy z opcjonalną linią oddzielającą |
| `FeatureList` | Kolumny z ikoną, tytułem i opisem |
| `Hero` | Tło, nagłówek i wezwanie do działania na górze strony |
| `LogoStrip` | Logotypy partnerów lub klientów |
| `Testimonial` | Cytat i autor |
| `Stats` | Pasek wskaźników |
| `AnnouncementBar` | Wąski pasek z komunikatem promocyjnym |
| `SimpleTable` | Nagłówki i wiersze z kolumnami rozdzielonymi znakiem `\|` |
| `NewsletterSignup` | Formularz zapisu (ustaw `actionUrl` na endpoint newslettera) |
| `ContactFormEmbed` | Osadzony formularz w iframe albo link mailto |

## Propozycje dalszych zmian (głębsze integracje)

| Priorytet | Pomysł | Dlaczego |
| -------- | ---- | --- |
| Średni | Newsletter ↔ moduł 048 | Automatyczne podłączenie endpointu zapisu dla kanału |
| Niski | Kontakt ↔ moduł formularzy | Wybór istniejącego formularza zamiast adresu iframe |

`Accordion` i `Tabs` już obsługują sekcje w stylu FAQ; korzystaj z nich zamiast osobnego komponentu
FAQ.

## Testowanie

Platforma ma szkielet testów (TDD) dla tego interfejsu w
`backend/test/integration/cms/page-builder-extension.test.ts`. Pisząc testy własnych komponentów,
korzystaj z danych testowych w `backend/test/fixtures/cms/test-extension-module.ts` jako wzoru.

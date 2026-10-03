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
2. **Wspólny komponent wyświetlający**: dodaj komponent React do pakietu workspace, od którego
   zależą panel i storefront (zwykle sam `@endora-commerce/cms-components` albo pakiet modułu,
   który go reeksportuje).

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

## 2. Komponent wyświetlający

Dodaj `ComponentConfig` Reacta w `packages/cms-components/src/components/` (albo we własnym
pakiecie modułu dla panelu lub storefrontu) i wyeksportuj go z punktu wejścia pakietu:

```tsx
// packages/cms-components/src/components/PromoBanner.tsx
import type { ComponentConfig } from '@puckeditor/core';

interface Props {
  headline: string;
  codeInput?: string;
  tone: 'info' | 'urgent';
}

export const PromoBanner: ComponentConfig<Props> = {
  fields: {
    headline: { type: 'text' },
    codeInput: { type: 'text' },
    tone: { type: 'select', options: [
      { label: 'Info', value: 'info' },
      { label: 'Urgent', value: 'urgent' },
    ] },
  },
  defaultProps: { headline: 'Spring sale', tone: 'info' },
  contexts: ['cms'],
  render: ({ headline, codeInput, tone }) => (
    <div className={`promo-banner promo-${tone}`}>
      <strong>{headline}</strong>
      {codeInput ? <code>{codeInput}</code> : null}
    </div>
  ),
};
```

Podłącz go do `defaultPageBuilderConfig` pod pełną nazwą bloku, żeby edytor
w panelu administracyjnym i wywołania `<Render>` w storefroncie go widziały:

```ts
// packages/cms-components/src/index.ts
import { PromoBanner } from './components/PromoBanner.js';

export const defaultPageBuilderConfig: Config = {
  components: {
    // ...the existing 'cms.*' and 'catalog.*' entries
    'promotions.PromoBanner': definePageBuilderComponent({
      ...(PromoBanner as unknown as ComponentConfig),
      contexts: ['cms'],
    }),
  },
};
```

Komponenty wyświetlające CMS to ten jeden pakiet (bloki e-maili są w ten sam sposób wyświetlane z
`@endora-commerce/email-components`). Moduł publikowany poza tym repozytorium nie może dodać
komponentu wyświetlającego do żadnego z tych pakietów bez zmiany w danym pakiecie.

Brak komponentu wyświetlającego w pakiecie nie psuje panelu: `PageBuilderEditor` łączy opis z
lokalną konfiguracją i dla każdego komponentu, który opis wymienia, a pakiet nie eksportuje,
podstawia `MissingComponentPlaceholder`. W storefroncie ten element zastępczy niczego nie wyświetla,
chyba że strona jest wczytana z parametrem `?cms_admin=1` (tryb podglądu).

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

W `@endora-commerce/cms-components` opakuj konfigurację Puck funkcją
`definePageBuilderComponent` z `@endora-commerce/page-builder-core`, aby filtr palety w panelu
pozostawał zgodny. Komponenty bez `email` / `invoice` w `contexts` nigdy nie pojawiają się w tych
edytorach (np. karuzela produktów).

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

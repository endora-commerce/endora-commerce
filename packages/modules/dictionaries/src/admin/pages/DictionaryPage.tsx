import { type ReactNode } from 'react';
import { Globe2, Languages, WalletCards } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, TabPanel, Tabs, type TabItem } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CountriesTab } from '../tabs/CountriesTab.js';
import { CurrenciesTab } from '../tabs/CurrenciesTab.js';
import { LanguagesTab } from '../tabs/LanguagesTab.js';

type DictionaryTab = 'countries' | 'currencies' | 'languages';

const TABS: ReadonlyArray<{ value: DictionaryTab; labelKey: string; Icon: typeof Globe2 }> = [
  { value: 'countries', labelKey: 'tab.countries', Icon: Globe2 },
  { value: 'currencies', labelKey: 'tab.currencies', Icon: WalletCards },
  { value: 'languages', labelKey: 'tab.languages', Icon: Languages },
];

/** The tab `?tab=` names, or Countries for anything else. */
export function normalizeDictionaryTab(value: string | null): DictionaryTab {
  return value === 'currencies' || value === 'languages' ? value : 'countries';
}

/**
 * `/dictionaries` — the country, currency and language registries, one per tab.
 * The tab lives in `?tab=` so a link can open one; the strip is the kit's
 * `Tabs` (issue #1456 / #1445), so it is a real tablist with arrow keys.
 */
export function DictionaryPage(): ReactNode {
  const t = useTranslation('dictionaries');
  const [params, setParams] = useSearchParams();
  const active = normalizeDictionaryTab(params.get('tab'));

  const setActive = (tab: DictionaryTab): void => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const items: TabItem<DictionaryTab>[] = TABS.map((tab) => ({
    value: tab.value,
    label: t(tab.labelKey),
    icon: <tab.Icon />,
  }));

  return (
    <>
      <PageHeader title={t('page.title')} description={t('page.description')} />

      <Tabs
        items={items}
        value={active}
        onValueChange={setActive}
        idBase="dictionary"
        aria-label={t('tabs.label')}
        className="mb-4"
      />

      <TabPanel idBase="dictionary" value={active}>
        {active === 'countries' ? <CountriesTab /> : null}
        {active === 'currencies' ? <CurrenciesTab /> : null}
        {active === 'languages' ? <LanguagesTab /> : null}
      </TabPanel>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default DictionaryPage;

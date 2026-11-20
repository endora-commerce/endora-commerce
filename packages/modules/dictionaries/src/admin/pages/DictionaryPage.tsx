import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Globe2, Languages, Plus, WalletCards } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, PageHeader, TabPanel, Tabs, type TabItem } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CountriesTab } from '../tabs/CountriesTab.js';
import { CurrenciesTab } from '../tabs/CurrenciesTab.js';
import { LanguagesTab } from '../tabs/LanguagesTab.js';
import type { DictionaryTabHandle } from '../lib/dictionary-tab.js';

type DictionaryTab = 'countries' | 'currencies' | 'languages';

const TABS: ReadonlyArray<{ value: DictionaryTab; labelKey: string; addKey: string; Icon: typeof Globe2 }> = [
  { value: 'countries', labelKey: 'tab.countries', addKey: 'countries.addCountry', Icon: Globe2 },
  { value: 'currencies', labelKey: 'tab.currencies', addKey: 'currencies.addCurrency', Icon: WalletCards },
  { value: 'languages', labelKey: 'tab.languages', addKey: 'languages.addLanguage', Icon: Languages },
];

/** The tab `?tab=` names, or Countries for anything else. */
export function normalizeDictionaryTab(value: string | null): DictionaryTab {
  return value === 'currencies' || value === 'languages' ? value : 'countries';
}

/**
 * `/dictionaries` — the country, currency and language registries, one per tab.
 * The tab lives in `?tab=` so a link can open one; the strip is the kit's
 * `Tabs` (issue #1456 / #1445), so it is a real tablist with arrow keys.
 *
 * The header carries the one *Add* of the tab on screen — "Add country",
 * "Add currency", "Add language" — as every list page does, instead of a
 * second one in the tab's card (issue #1562, UX audit WORK-13). While that
 * dictionary is empty its empty state carries the Add and the header none.
 */
export function DictionaryPage(): ReactNode {
  const t = useTranslation('dictionaries');
  const [params, setParams] = useSearchParams();
  const active = normalizeDictionaryTab(params.get('tab'));

  const tabRef = useRef<DictionaryTabHandle>(null);
  // Which tab reported itself empty; a tab switch leaves the stale answer behind.
  const [emptyTab, setEmptyTab] = useState<DictionaryTab | null>(null);
  const onEmptyChange = useCallback(
    (empty: boolean): void => setEmptyTab((current) => (empty ? active : current === active ? null : current)),
    [active],
  );

  const setActive = (tab: DictionaryTab): void => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const activeTab = TABS.find((tab) => tab.value === active) ?? TABS[0]!;
  const add =
    emptyTab === active ? undefined : (
      <Button className="min-h-11 sm:min-h-9" onClick={(): void => tabRef.current?.create()}>
        <Plus aria-hidden="true" />
        {t(activeTab.addKey)}
      </Button>
    );

  const items: TabItem<DictionaryTab>[] = TABS.map((tab) => ({
    value: tab.value,
    label: t(tab.labelKey),
    icon: <tab.Icon />,
  }));

  return (
    <>
      <PageHeader title={t('page.title')} description={t('page.description')} actions={add} />

      <Tabs
        items={items}
        value={active}
        onValueChange={setActive}
        idBase="dictionary"
        aria-label={t('tabs.label')}
        className="mb-4"
      />

      <TabPanel idBase="dictionary" value={active}>
        {active === 'countries' ? <CountriesTab ref={tabRef} onEmptyChange={onEmptyChange} /> : null}
        {active === 'currencies' ? <CurrenciesTab ref={tabRef} onEmptyChange={onEmptyChange} /> : null}
        {active === 'languages' ? <LanguagesTab ref={tabRef} onEmptyChange={onEmptyChange} /> : null}
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

import { type ReactNode } from 'react';
import { Globe2, Languages, WalletCards } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CountriesTab } from './tabs/CountriesTab';
import { CurrenciesTab } from './tabs/CurrenciesTab';
import { LanguagesTab } from './tabs/LanguagesTab';

type DictionaryTab = 'countries' | 'currencies' | 'languages';

const TABS: Array<{ key: DictionaryTab; label: string; icon: typeof Globe2 }> = [
  { key: 'countries', label: 'Countries', icon: Globe2 },
  { key: 'currencies', label: 'Currencies', icon: WalletCards },
  { key: 'languages', label: 'Languages', icon: Languages },
];

function normalizeTab(value: string | null): DictionaryTab {
  return value === 'currencies' || value === 'languages' ? value : 'countries';
}

export function DictionaryPage(): ReactNode {
  const [params, setParams] = useSearchParams();
  const active = normalizeTab(params.get('tab'));

  const setActive = (tab: DictionaryTab): void => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Dictionary"
        description="Platform registry for country, currency, and language entries used by storefront and admin workflows."
      />

      <div className="mb-4 flex flex-wrap gap-2 border-b">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.key;
          return (
            <Button
              key={tab.key}
              type="button"
              variant="ghost"
              className={cn(
                'rounded-none border-b-2 border-transparent px-3',
                selected && 'border-primary bg-muted text-foreground',
              )}
              onClick={() => setActive(tab.key)}
            >
              <Icon />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {active === 'countries' ? <CountriesTab /> : null}
      {active === 'currencies' ? <CurrenciesTab /> : null}
      {active === 'languages' ? <LanguagesTab /> : null}
    </>
  );
}


import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { DictionaryCurrency, DictionaryLanguage, SalesChannelDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { dictionaryClient } from '../../dictionaries/client';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * ChannelIdentityForm — feature 005 / T040.
 *
 * Captures the identity surface of a Sales Channel for both the create
 * page and the edit page. Language and currency scopes are selected from
 * Dictionary entries and submitted as the existing contract arrays.
 *
 * The i18n display name is captured as a single `en-US` string for
 * v1 (matches the test-server seed). A multi-locale editor lands as
 * a follow-up — the contract already supports the wider shape.
 */

export interface ChannelIdentityFormValue {
  code: string;
  name: string;
  themeCode: string;
  languages: string[];
  defaultLanguage: string;
  currencies: string[];
  defaultCurrency: string;
  active: boolean;
}

export interface ChannelIdentityFormProps {
  mode: 'create' | 'edit';
  initial?: SalesChannelDetail | null;
  /** When true, the code field is read-only (renames possible later via a dedicated dialog). */
  lockCode?: boolean;
  errorMessage?: string | null;
  saving?: boolean;
  onSubmit: (value: ChannelIdentityFormValue) => void;
  onCancel?: () => void;
}

function pickEnglishName(name: Record<string, string> | undefined): string {
  if (!name) return '';
  return name['en-US'] ?? name['en'] ?? Object.values(name)[0] ?? '';
}

export function ChannelIdentityForm({
  mode,
  initial,
  lockCode = false,
  errorMessage,
  saving = false,
  onSubmit,
  onCancel,
}: ChannelIdentityFormProps): ReactNode {
  const t = useTranslation('sales_channels');
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(pickEnglishName(initial?.name));
  const [themeCode, setThemeCode] = useState(initial?.themeCode ?? '');
  const [languages, setLanguages] = useState<string[]>(initial?.languages ?? ['en-US']);
  const [defaultLanguage, setDefaultLanguage] = useState(
    initial?.defaultLanguage ?? 'en-US',
  );
  const [currencies, setCurrencies] = useState<string[]>(initial?.currencies ?? ['PLN']);
  const [defaultCurrency, setDefaultCurrency] = useState(
    initial?.defaultCurrency ?? 'PLN',
  );
  const [active, setActive] = useState(initial?.active ?? true);
  const [dictionaryLanguages, setDictionaryLanguages] = useState<DictionaryLanguage[]>([]);
  const [dictionaryCurrencies, setDictionaryCurrencies] = useState<DictionaryCurrency[]>([]);

  // Re-seed when the underlying entity changes (typical on first GET response after mount).
  useEffect(() => {
    if (!initial) return;
    setCode(initial.code);
    setName(pickEnglishName(initial.name));
    setThemeCode(initial.themeCode ?? '');
    setLanguages(initial.languages);
    setDefaultLanguage(initial.defaultLanguage);
    setCurrencies(initial.currencies);
    setDefaultCurrency(initial.defaultCurrency);
    setActive(initial.active);
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      dictionaryClient.listLanguages({ pageSize: 250, sort: 'sortOrder' }),
      dictionaryClient.listCurrencies({ pageSize: 250, sort: 'sortOrder' }),
    ])
      .then(([languagePage, currencyPage]) => {
        if (cancelled) return;
        setDictionaryLanguages(languagePage.data);
        setDictionaryCurrencies(currencyPage.data);
      })
      .catch(() => {
        if (cancelled) return;
        setDictionaryLanguages([]);
        setDictionaryCurrencies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (languages.length > 0 && !languages.includes(defaultLanguage)) {
      setDefaultLanguage(languages[0] ?? '');
    }
  }, [defaultLanguage, languages]);

  useEffect(() => {
    if (currencies.length > 0 && !currencies.includes(defaultCurrency)) {
      setDefaultCurrency(currencies[0] ?? '');
    }
  }, [currencies, defaultCurrency]);

  const languageRows = useMemo(
    () => mergeSelectedDictionaryRows(dictionaryLanguages, languages),
    [dictionaryLanguages, languages],
  );
  const currencyRows = useMemo(
    () => mergeSelectedDictionaryRows(dictionaryCurrencies, currencies),
    [dictionaryCurrencies, currencies],
  );

  const toggleLanguage = (language: string): void => {
    setLanguages((prev) =>
      prev.includes(language) ? prev.filter((code) => code !== language) : [...prev, language],
    );
  };

  const toggleCurrency = (currency: string): void => {
    setCurrencies((prev) =>
      prev.includes(currency) ? prev.filter((code) => code !== currency) : [...prev, currency],
    );
  };

  const handleSubmit = useCallback(
    (e: FormEvent): void => {
      e.preventDefault();
      onSubmit({
        code: code.trim(),
        name: name.trim(),
        themeCode: themeCode.trim(),
        languages,
        defaultLanguage: defaultLanguage.trim(),
        currencies,
        defaultCurrency: defaultCurrency.trim(),
        active,
      });
    },
    [
      onSubmit,
      code,
      name,
      themeCode,
      languages,
      defaultLanguage,
      currencies,
      defaultCurrency,
      active,
    ],
  );

  const cannotSubmit = saving || languages.length === 0 || currencies.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mode === 'create' ? t('identity.title.create') : t('identity.title.edit')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="sc-code">{t('identity.code.label')}</Label>
            <Input
              id="sc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="serwis-a"
              disabled={lockCode}
              required
            />
            {lockCode && (
              <p className="text-xs text-muted-foreground">{t('identity.code.lockedHelp')}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sc-name">{t('identity.name.label')}</Label>
            <Input
              id="sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('identity.name.placeholder')}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sc-theme">{t('identity.theme.label')}</Label>
            <Input
              id="sc-theme"
              value={themeCode}
              onChange={(e) => setThemeCode(e.target.value)}
              placeholder={t('identity.theme.placeholder')}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label>{t('identity.languages.label')}</Label>
              <DictionaryCheckboxList
                rows={languageRows}
                selected={languages}
                onToggle={toggleLanguage}
              />
              <p className="text-xs text-muted-foreground">{t('identity.languages.help')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sc-default-lang">{t('identity.defaultLanguage.label')}</Label>
              <Select
                id="sc-default-lang"
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
              >
                <option value="" disabled>
                  {t('identity.pickOption')}
                </option>
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label>{t('identity.currencies.label')}</Label>
              <DictionaryCheckboxList
                rows={currencyRows}
                selected={currencies}
                onToggle={toggleCurrency}
              />
              <p className="text-xs text-muted-foreground">{t('identity.currencies.help')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sc-default-curr">{t('identity.defaultCurrency.label')}</Label>
              <Select
                id="sc-default-curr"
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
              >
                <option value="" disabled>
                  {t('identity.pickOption')}
                </option>
                {currencies.map((curr) => (
                  <option key={curr} value={curr}>
                    {curr}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="sc-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={initial?.systemDefault === true}
            />
            <Label htmlFor="sc-active" className="cursor-pointer">
              {t('identity.active')}
            </Label>
            {initial?.systemDefault && (
              <span className="text-xs text-muted-foreground">
                {t('identity.cannotDeactivateDefault')}
              </span>
            )}
          </div>

          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
                {t('identity.action.cancel')}
              </Button>
            )}
            <Button type="submit" disabled={cannotSubmit}>
              {mode === 'create' ? t('identity.action.create') : t('identity.action.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface DictionaryRow {
  code: string;
  label: string;
  isActive: boolean;
}

function mergeSelectedDictionaryRows<T extends DictionaryRow>(rows: T[], selected: string[]): T[] {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const merged: T[] = [...rows];
  for (const code of selected) {
    if (!byCode.has(code)) {
      merged.push({ code, label: code, isActive: false } as T);
    }
  }
  return merged;
}

function DictionaryCheckboxList({
  rows,
  selected,
  onToggle,
}: {
  rows: DictionaryRow[];
  selected: string[];
  onToggle: (code: string) => void;
}): ReactNode {
  const t = useTranslation('sales_channels');
  const activeRows = rows.filter((row) => row.isActive);
  const inactiveSelected = rows.filter((row) => !row.isActive && selected.includes(row.code));
  const visibleRows = [...activeRows, ...inactiveSelected];

  return (
    <div className="max-h-48 overflow-auto rounded-md border p-3">
      {visibleRows.map((row) => (
        <label key={row.code} className="flex items-center gap-2 py-1 text-sm">
          <Checkbox
            checked={selected.includes(row.code)}
            onChange={() => onToggle(row.code)}
          />
          <span className="font-mono text-xs">{row.code}</span>
          <span>{row.label}</span>
          {!row.isActive ? (
            <span className="text-xs text-muted-foreground">{t('identity.dictionary.inactive')}</span>
          ) : null}
        </label>
      ))}
      {visibleRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('identity.dictionary.empty')}</p>
      ) : null}
    </div>
  );
}

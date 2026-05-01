import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { SalesChannelDetail } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * ChannelIdentityForm — feature 005 / T040.
 *
 * Captures the identity surface of a Sales Channel for both the create
 * page and the edit page. The form keeps `languages` / `currencies`
 * as comma- or newline-separated text inputs so an operator can paste
 * a list directly; the parsed list drives the `defaultLanguage` /
 * `defaultCurrency` selects.
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

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function joinList(items: string[]): string {
  return items.join(', ');
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
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(pickEnglishName(initial?.name));
  const [themeCode, setThemeCode] = useState(initial?.themeCode ?? '');
  const [languagesRaw, setLanguagesRaw] = useState(joinList(initial?.languages ?? ['en-US']));
  const [defaultLanguage, setDefaultLanguage] = useState(
    initial?.defaultLanguage ?? 'en-US',
  );
  const [currenciesRaw, setCurrenciesRaw] = useState(joinList(initial?.currencies ?? ['PLN']));
  const [defaultCurrency, setDefaultCurrency] = useState(
    initial?.defaultCurrency ?? 'PLN',
  );
  const [active, setActive] = useState(initial?.active ?? true);

  // Re-seed when the underlying entity changes (typical on first GET response after mount).
  useEffect(() => {
    if (!initial) return;
    setCode(initial.code);
    setName(pickEnglishName(initial.name));
    setThemeCode(initial.themeCode ?? '');
    setLanguagesRaw(joinList(initial.languages));
    setDefaultLanguage(initial.defaultLanguage);
    setCurrenciesRaw(joinList(initial.currencies));
    setDefaultCurrency(initial.defaultCurrency);
    setActive(initial.active);
  }, [initial]);

  const languages = useMemo(() => splitList(languagesRaw), [languagesRaw]);
  const currencies = useMemo(() => splitList(currenciesRaw), [currenciesRaw]);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mode === 'create' ? 'New Sales Channel' : 'Identity'}
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
            <Label htmlFor="sc-code">Code</Label>
            <Input
              id="sc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="serwis-a"
              disabled={lockCode}
              required
            />
            {lockCode && (
              <p className="text-xs text-muted-foreground">
                Channel codes are write-once after creation; edit them through a future
                rename action that handles redirects from cached storefront responses.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sc-name">Display name (en-US)</Label>
            <Input
              id="sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Serwis A"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sc-theme">Theme code</Label>
            <Input
              id="sc-theme"
              value={themeCode}
              onChange={(e) => setThemeCode(e.target.value)}
              placeholder="storefront-a (optional)"
            />
          </div>

          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="sc-langs">Languages</Label>
              <Textarea
                id="sc-langs"
                value={languagesRaw}
                onChange={(e) => setLanguagesRaw(e.target.value)}
                placeholder="en-US, pl-PL"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Comma- or newline-separated language codes. Must be registered in the i18n
                module.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sc-default-lang">Default language</Label>
              <Select
                id="sc-default-lang"
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
              >
                <option value="" disabled>
                  Pick
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
              <Label htmlFor="sc-currs">Currencies</Label>
              <Textarea
                id="sc-currs"
                value={currenciesRaw}
                onChange={(e) => setCurrenciesRaw(e.target.value)}
                placeholder="PLN, EUR"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Comma- or newline-separated ISO-4217 codes. Must be registered in the i18n
                module.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sc-default-curr">Default currency</Label>
              <Select
                id="sc-default-curr"
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
              >
                <option value="" disabled>
                  Pick
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
              Active
            </Label>
            {initial?.systemDefault && (
              <span className="text-xs text-muted-foreground">
                The system-default channel cannot be deactivated.
              </span>
            )}
          </div>

          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {mode === 'create' ? 'Create channel' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

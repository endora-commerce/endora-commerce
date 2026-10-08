import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  type DictionaryCurrenciesPageResponse,
  type DictionaryCurrency,
  type DictionaryLanguage,
  type DictionaryLanguagesPageResponse,
  type SalesChannelDetail,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  Input,
  Label,
  MultiCombobox,
  type ComboboxOption,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * ChannelIdentityForm — feature 005 / T040.
 *
 * Captures the identity surface of a Sales Channel for both the create
 * page and the edit page. Language and currency scopes are selected from
 * Dictionary entries and submitted as the existing contract arrays.
 *
 * **Languages** and **Currencies** are searchable multi-selects, and the two
 * defaults are searchable single selects over what is currently selected
 * beside them. The Dictionary holds a couple of hundred languages, which is
 * past the point where a list of checkboxes can be scanned (Hick's Law): the
 * operator types a code or a name instead, and reads the selection back as
 * chips rather than hunting for ticks in a scroll box.
 *
 * **A default that leaves the selected set is cleared, never re-pointed.** The
 * form used to promote whichever entry happened to be first, which changes the
 * language a storefront serves at `/` — or the currency it prices in — without
 * the operator having chosen it. Now the default goes empty, the field says
 * why, and the form does not submit until one is picked. Selecting the removed
 * entry again does not restore it either: the form does not remember a choice
 * it has just reported as gone.
 *
 * The i18n display name is captured as a single `en-US` string for
 * v1 (matches the test-server seed). A multi-locale editor lands as
 * a follow-up — the contract already supports the wider shape.
 */

/**
 * List dictionary entries (feature 091, P6).
 *
 * The requests are built here rather than through `dictionaries`' own admin
 * API client: that client is another module's **code**, which is what the
 * cross-module ledger recorded, while `/api/v1/admin/dictionary/*` and the
 * `Dictionary*PageResponse` types are an HTTP path and
 * `@endora-commerce/contracts` types that both sides already compile. That is
 * the exit P2 established and `admin-kit-surface.md` R6 records.
 */
function listDictionary<T>(entry: 'languages' | 'currencies', pageSize: number): Promise<T> {
  const qs = new URLSearchParams();
  qs.set('pageSize', String(pageSize));
  qs.set('sort', 'sortOrder');
  return apiClient.get<T>(`/api/v1/admin/dictionary/${entry}?${qs.toString()}`);
}

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
  const [dictionaryStatus, setDictionaryStatus] = useState<DictionaryStatus>('loading');
  const [dictionaryAttempt, setDictionaryAttempt] = useState(0);

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
    setDictionaryStatus('loading');
    void Promise.all([
      listDictionary<DictionaryLanguagesPageResponse>('languages', 250),
      listDictionary<DictionaryCurrenciesPageResponse>('currencies', 250),
    ])
      .then(([languagePage, currencyPage]) => {
        if (cancelled) return;
        setDictionaryLanguages(languagePage.data);
        setDictionaryCurrencies(currencyPage.data);
        setDictionaryStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setDictionaryLanguages([]);
        setDictionaryCurrencies([]);
        setDictionaryStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [dictionaryAttempt]);

  // Only a loaded Dictionary can say a stored code is inactive; while it is
  // loading, or after it failed, a code it has not described is just a code.
  const inactiveSuffix = dictionaryStatus === 'ready' ? t('identity.dictionary.inactive') : null;

  const languageOptions = useMemo(
    () => buildOptions(dictionaryLanguages, languages, inactiveSuffix),
    [dictionaryLanguages, languages, inactiveSuffix],
  );
  const currencyOptions = useMemo(
    () => buildOptions(dictionaryCurrencies, currencies, inactiveSuffix),
    [dictionaryCurrencies, currencies, inactiveSuffix],
  );

  // The defaults are a pure function of the handlers below, not an effect
  // chasing the lists: an effect would also fire on the re-seed above and on
  // every unrelated render, and "the default was cleared" has to be traceable
  // to the one thing the operator did.
  const changeLanguages = (next: string[]): void => {
    setLanguages(next);
    if (!next.includes(defaultLanguage)) setDefaultLanguage('');
  };

  const changeCurrencies = (next: string[]): void => {
    setCurrencies(next);
    if (!next.includes(defaultCurrency)) setDefaultCurrency('');
  };

  const languagesMissing = languages.length === 0;
  const currenciesMissing = currencies.length === 0;
  // With nothing selected there is nothing to choose a default from, so the
  // one message shown is the one that can be acted on (the list's own).
  const defaultLanguageMissing = !languagesMissing && !languages.includes(defaultLanguage);
  const defaultCurrencyMissing = !currenciesMissing && !currencies.includes(defaultCurrency);
  const invalid =
    languagesMissing || currenciesMissing || defaultLanguageMissing || defaultCurrencyMissing;

  const handleSubmit = useCallback(
    (e: FormEvent): void => {
      e.preventDefault();
      // The submit button is disabled while `invalid`, but a form is also
      // submitted by Enter in a text field and by anything calling `submit()`.
      if (invalid) return;
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
      invalid,
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

  const cannotSubmit = saving || invalid;

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

          {/*
            Free text, and never a closed list — feature 102 / D-199.

            The admin and the storefront are separate deployments. Whatever a
            list here showed could only ever be advisory, because the storefront
            is the only thing that knows which themes it has installed, and it
            already answers a wrong value correctly: it renders its own default,
            marks the document `data-theme-requested`, and never rewrites what
            is stored here. A control that *refused* a value would be refusing on
            worse information than the thing that will actually decide.

            `pattern` is the same shape the backend's write schemas validate
            (`themeCodeRe`), so the field refuses a malformed code and accepts
            every well-formed one — including a theme this repository has never
            heard of, which is the whole point.
          */}
          <div className="grid gap-2">
            <Label htmlFor="sc-theme">{t('identity.theme.label')}</Label>
            <Input
              id="sc-theme"
              value={themeCode}
              onChange={(e) => setThemeCode(e.target.value)}
              placeholder={t('identity.theme.placeholder')}
              pattern="[a-z][a-z0-9_-]*"
              title={t('identity.theme.pattern')}
            />
            <p className="text-xs text-muted-foreground">{t('identity.theme.help')}</p>
          </div>

          {dictionaryStatus === 'error' && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('identity.dictionary.loadError')}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDictionaryAttempt((n) => n + 1)}
                >
                  {t('identity.dictionary.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid items-start gap-2 md:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label id="sc-languages-label" htmlFor="sc-languages">
                {t('identity.languages.label')}
              </Label>
              <MultiCombobox
                id="sc-languages"
                ariaLabelledBy="sc-languages-label"
                ariaDescribedBy={describedBy(
                  'sc-languages-help',
                  languagesMissing && 'sc-languages-error',
                )}
                invalid={languagesMissing}
                options={languageOptions.available}
                value={languages}
                onChange={changeLanguages}
                loading={dictionaryStatus === 'loading'}
                loadingMessage={t('identity.dictionary.loading')}
                placeholder={t('identity.languages.placeholder')}
                emptyMessage={
                  languageOptions.available.length === 0
                    ? t('identity.dictionary.empty')
                    : t('identity.languages.noMatches')
                }
              />
              {languagesMissing && (
                <FieldError id="sc-languages-error">{t('identity.languages.required')}</FieldError>
              )}
              <p id="sc-languages-help" className="text-xs text-muted-foreground">
                {t('identity.languages.help')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sc-default-lang">{t('identity.defaultLanguage.label')}</Label>
              <Combobox
                id="sc-default-lang"
                ariaDescribedBy={describedBy(defaultLanguageMissing && 'sc-default-lang-error')}
                invalid={defaultLanguageMissing}
                options={languageOptions.selected}
                value={defaultLanguage === '' ? null : defaultLanguage}
                onChange={(next) => setDefaultLanguage(next ?? '')}
                clearable={false}
                disabled={languagesMissing}
                placeholder={t('identity.pickOption')}
                emptyMessage={t('identity.languages.noMatches')}
              />
              {defaultLanguageMissing && (
                <FieldError id="sc-default-lang-error">
                  {t('identity.defaultLanguage.required')}
                </FieldError>
              )}
            </div>
          </div>

          <div className="grid items-start gap-2 md:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label id="sc-currencies-label" htmlFor="sc-currencies">
                {t('identity.currencies.label')}
              </Label>
              <MultiCombobox
                id="sc-currencies"
                ariaLabelledBy="sc-currencies-label"
                ariaDescribedBy={describedBy(
                  'sc-currencies-help',
                  currenciesMissing && 'sc-currencies-error',
                )}
                invalid={currenciesMissing}
                options={currencyOptions.available}
                value={currencies}
                onChange={changeCurrencies}
                loading={dictionaryStatus === 'loading'}
                loadingMessage={t('identity.dictionary.loading')}
                placeholder={t('identity.currencies.placeholder')}
                emptyMessage={
                  currencyOptions.available.length === 0
                    ? t('identity.dictionary.empty')
                    : t('identity.currencies.noMatches')
                }
              />
              {currenciesMissing && (
                <FieldError id="sc-currencies-error">{t('identity.currencies.required')}</FieldError>
              )}
              <p id="sc-currencies-help" className="text-xs text-muted-foreground">
                {t('identity.currencies.help')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sc-default-curr">{t('identity.defaultCurrency.label')}</Label>
              <Combobox
                id="sc-default-curr"
                ariaDescribedBy={describedBy(defaultCurrencyMissing && 'sc-default-curr-error')}
                invalid={defaultCurrencyMissing}
                options={currencyOptions.selected}
                value={defaultCurrency === '' ? null : defaultCurrency}
                onChange={(next) => setDefaultCurrency(next ?? '')}
                clearable={false}
                disabled={currenciesMissing}
                placeholder={t('identity.pickOption')}
                emptyMessage={t('identity.currencies.noMatches')}
              />
              {defaultCurrencyMissing && (
                <FieldError id="sc-default-curr-error">
                  {t('identity.defaultCurrency.required')}
                </FieldError>
              )}
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

type DictionaryStatus = 'loading' | 'ready' | 'error';

interface DictionaryRow {
  code: string;
  label: string;
  /** Languages carry the language's own name for itself; currencies do not. */
  nativeLabel?: string;
  isActive: boolean;
}

interface DictionaryOptions {
  /** What the multi-select offers: every active entry, plus whatever is selected. */
  available: ComboboxOption[];
  /** What the default's select offers: the selection, in the order it was made. */
  selected: ComboboxOption[];
}

/**
 * One option per Dictionary entry, labelled `code — name` so that both halves
 * are searchable and both are legible on a chip. A language's own name for
 * itself goes in the description, which the pickers search as well: `Polski`
 * finds `pl-PL — Polish`.
 *
 * A stored code the Dictionary has since deactivated — or no longer carries —
 * stays offered while it is selected, marked with `inactiveSuffix`, so opening
 * the form never drops it and the operator can see why it cannot be re-added.
 */
function buildOptions(
  rows: DictionaryRow[],
  selectedCodes: string[],
  inactiveSuffix: string | null,
): DictionaryOptions {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const toOption = (code: string): ComboboxOption => {
    const row = byCode.get(code);
    const name = row ? `${code} — ${row.label}` : code;
    const inactive = row ? !row.isActive : true;
    return {
      value: code,
      label: inactive && inactiveSuffix ? `${name} ${inactiveSuffix}` : name,
      ...(row?.nativeLabel && row.nativeLabel !== row.label ? { description: row.nativeLabel } : {}),
    };
  };
  const selected = [...new Set(selectedCodes)];
  return {
    available: [
      ...rows.filter((row) => row.isActive).map((row) => toOption(row.code)),
      ...selected.filter((code) => byCode.get(code)?.isActive !== true).map(toOption),
    ],
    selected: selected.map(toOption),
  };
}

/** `aria-describedby` from whichever of its parts currently exist. */
function describedBy(...ids: Array<string | false>): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string');
  return present.length > 0 ? present.join(' ') : undefined;
}

/**
 * A field's validation message. `role="alert"` because it appears as the
 * consequence of something the operator just did in a *different* control —
 * removing a language is what empties the default — so it has to be announced
 * rather than waited for. The sentence is the carrier; its colour only agrees
 * with it, and the field is marked `aria-invalid` and points here.
 */
function FieldError({ id, children }: { id: string; children: ReactNode }): ReactNode {
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {children}
    </p>
  );
}

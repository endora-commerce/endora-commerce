import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Plus, Star, Trash2 } from 'lucide-react';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';
import type {
  Country,
  CreateCountryRequest,
  DictionaryCurrency,
  DictionaryLanguage,
  Region,
  UpdateCountryRequest,
} from '@endora-commerce/contracts';
import { normalize } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, FormField, InlineStatus, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { dictionaryClient } from '../api/client.js';
import { EntryStatusBadges } from '../components/EntryStatusBadges.js';
import { RowReorder } from '../components/RowReorder.js';
import { TranslationsDrawer } from '../components/TranslationsDrawer.js';
import { formatDictionaryError } from '../lib/format-error.js';
import { regionLabels } from '../lib/labels.js';


interface CountryFormState {
  code: string;
  alpha3Code: string;
  numericCode: string;
  label: string;
  region: Region;
  subregion: string;
  dialCode: string;
  isEuMember: boolean;
  defaultCurrencyCode: string;
  isActive: boolean;
  sortOrder: number;
}

const emptyCountry: CountryFormState = {
  code: '',
  alpha3Code: '',
  numericCode: '',
  label: '',
  region: 'Europe',
  subregion: '',
  dialCode: '',
  isEuMember: false,
  defaultCurrencyCode: '',
  isActive: true,
  sortOrder: 1000,
};

export function CountriesTab(): ReactNode {
  const t = useTranslation('dictionaries');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<Country[]>([]);
  const [currencies, setCurrencies] = useState<DictionaryCurrency[]>([]);
  const [languages, setLanguages] = useState<DictionaryLanguage[]>([]);
  const [translationCompleteness, setTranslationCompleteness] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Country | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CountryFormState>(emptyCountry);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An action's result is said beside the list's toolbar, in an always-mounted
  // polite region, not as a success banner (issue #1499, DEC-12 a).
  const actionStatus = useInlineStatus();
  const searchId = useId();
  // Read through a ref so `load` keeps one identity while the bundle arrives.
  const tRef = useRef(t);
  tRef.current = t;
  const formatError = (err: unknown, fallback: string): string => formatDictionaryError(err, fallback, tRef.current);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [countryPage, currencyPage, languagePage] = await Promise.all([
        dictionaryClient.listCountries({ pageSize: 250, sort: 'sortOrder' }),
        dictionaryClient.listCurrencies({ pageSize: 250, sort: 'sortOrder' }),
        dictionaryClient.listLanguages({ pageSize: 250, sort: 'sortOrder' }),
      ]);
      setRows(countryPage.data);
      setCurrencies(currencyPage.data);
      setLanguages(languagePage.data);
      setTranslationCompleteness(
        await loadTranslationCompleteness(
          'country',
          countryPage.data.map((row) => row.code),
          languagePage.data,
        ),
      );
    } catch (err) {
      setError(formatDictionaryError(err, tRef.current('countries.error.load'), tRef.current));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = normalize(search);
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.code, row.alpha3Code, row.label, row.region, row.subregion ?? '']
        .map(normalize)
        .join(' ')
        .includes(needle),
    );
  }, [rows, search]);

  const openCreate = (): void => {
    actionStatus.clear();
    setCreating(true);
    setSelected(null);
    setForm({ ...emptyCountry, sortOrder: nextSortOrder(rows) });
  };

  const openEdit = (row: Country): void => {
    setCreating(false);
    setSelected(row);
    setForm({
      code: row.code,
      alpha3Code: row.alpha3Code,
      numericCode: row.numericCode,
      label: row.label,
      region: row.region,
      subregion: row.subregion ?? '',
      dialCode: row.dialCode ?? '',
      isEuMember: row.isEuMember,
      defaultCurrencyCode: row.defaultCurrencyCode ?? '',
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const input: CreateCountryRequest = {
          code: form.code.trim().toUpperCase(),
          alpha3Code: form.alpha3Code.trim().toUpperCase(),
          numericCode: form.numericCode.trim(),
          label: form.label.trim(),
          region: form.region,
          isEuMember: form.isEuMember,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
          ...(form.subregion.trim() ? { subregion: form.subregion.trim() } : {}),
          ...(form.dialCode.trim() ? { dialCode: form.dialCode.trim() } : {}),
          ...(form.defaultCurrencyCode ? { defaultCurrencyCode: form.defaultCurrencyCode } : {}),
        };
        await dictionaryClient.createCountry(input);
        actionStatus.show(t('country.created', { code: input.code }));
      } else if (selected) {
        const input: UpdateCountryRequest = {
          alpha3Code: form.alpha3Code.trim().toUpperCase(),
          numericCode: form.numericCode.trim(),
          label: form.label.trim(),
          region: form.region,
          subregion: form.subregion.trim() || null,
          dialCode: form.dialCode.trim() || null,
          isEuMember: form.isEuMember,
          defaultCurrencyCode: form.defaultCurrencyCode || null,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
        };
        await dictionaryClient.updateCountry(selected.code, input);
        actionStatus.show(t('country.saved', { code: selected.code }));
      }
      await load();
      setCreating(false);
      setSelected(null);
    } catch (err) {
      actionStatus.clear();
      setError(formatError(err, t('error.save')));
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (code: string): Promise<void> => {
    try {
      await dictionaryClient.setDefaultCountry(code);
      actionStatus.show(t('country.madeDefault', { code }));
      await load();
    } catch (err) {
      actionStatus.clear();
      setError(formatError(err, t('error.setDefault')));
    }
  };

  const remove = async (code: string): Promise<void> => {
    const ok = await confirm({
      message: t('country.deleteConfirm', { code }),
      confirmLabel: t('action.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await dictionaryClient.deleteCountry(code);
      actionStatus.show(t('country.deleted', { code }));
      await load();
    } catch (err) {
      actionStatus.clear();
      setError(formatError(err, t('error.delete')));
    }
  };

  const move = async (row: Country, direction: -1 | 1): Promise<void> => {
    const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    const index = ordered.findIndex((item) => item.code === row.code);
    const other = ordered[index + direction];
    if (!other) return;
    try {
      await dictionaryClient.updateCountry(row.code, { sortOrder: other.sortOrder });
      await dictionaryClient.updateCountry(other.code, { sortOrder: row.sortOrder });
      await load();
    } catch (err) {
      actionStatus.clear();
      setError(formatError(err, t('error.reorder')));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between md:space-y-0">
          <CardTitle>{t('countries.title')}</CardTitle>
          <div className="flex w-full flex-wrap gap-2 md:w-auto">
            <Label htmlFor={searchId} className="sr-only">
              {t('countries.searchLabel')}
            </Label>
            <Input
              id={searchId}
              type="search"
              className="min-w-56 md:w-72"
              placeholder={t('countries.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <InlineStatus {...actionStatus.props} className="self-center" />
            <Button type="button" onClick={openCreate}>
              <Plus />
              {t('countries.addCountry')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('countries.loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('column.code')}</TableHead>
                  <TableHead>{t('column.label')}</TableHead>
                  <TableHead>{t('column.region')}</TableHead>
                  <TableHead>{t('column.currency')}</TableHead>
                  <TableHead>{t('column.status')}</TableHead>
                  <TableHead>{t('column.sort')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">{t('column.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, index) => (
                  <TableRow key={row.code}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>
                      <div>{regionLabels.label(t, row.region)}</div>
                      <div className="text-xs text-muted-foreground">{row.subregion ?? '—'}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.defaultCurrencyCode ?? '—'}</TableCell>
                    <TableCell>
                      <EntryStatusBadges
                        isDefault={row.isDefault}
                        isActive={row.isActive}
                        translationsComplete={translationCompleteness[row.code] ?? null}
                      />
                    </TableCell>
                    <TableCell>{row.sortOrder}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1 items-center">
                        <RowReorder
                          onMove={(direction) => void move(row, direction)}
                          first={index === 0}
                          last={index === filtered.length - 1}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            actionStatus.clear();
                            openEdit(row);
                          }}
                        >
                          {t('action.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t('action.setDefault')}
                          aria-label={t('action.setDefault')}
                          disabled={row.isDefault || !row.isActive}
                          onClick={() => void setDefault(row.code)}
                        >
                          <Star aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          title={t('action.delete')}
                          aria-label={t('action.delete')}
                          disabled={row.isDefault}
                          onClick={() => void remove(row.code)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CountryEditor
        title={creating ? t('countries.editor.newCountry') : selected ? t('countries.editor.editTitle', { code: selected.code }) : t('countries.editor.title')}
        form={form}
        setForm={setForm}
        currencies={currencies}
        languages={languages}
        lockedCode={!creating}
        disabled={!creating && !selected}
        saving={saving}
        onSubmit={() => void save()}
        onCancel={() => {
          setCreating(false);
          setSelected(null);
        }}
      />
      {confirmDialog}
    </div>
  );
}

function CountryEditor({
  title,
  form,
  setForm,
  currencies,
  languages,
  lockedCode,
  disabled,
  saving,
  onSubmit,
  onCancel,
}: {
  title: string;
  form: CountryFormState;
  setForm: (value: CountryFormState) => void;
  currencies: DictionaryCurrency[];
  languages: DictionaryLanguage[];
  lockedCode: boolean;
  disabled: boolean;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactNode {
  const t = useTranslation('dictionaries');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Card className="xl:sticky xl:top-4 xl:self-start">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <p className="text-sm text-muted-foreground">{t('countries.editor.selectHint')}</p>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('field.code')}>
                <Input
                  value={form.code}
                  disabled={lockedCode}
                  maxLength={2}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  required
                />
              </FormField>
              <FormField label={t('field.alpha3')}>
                <Input
                  value={form.alpha3Code}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, alpha3Code: e.target.value.toUpperCase() })}
                  required
                />
              </FormField>
              <FormField label={t('field.numeric')}>
                <Input
                  value={form.numericCode}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, numericCode: e.target.value })}
                  required
                />
              </FormField>
              <FormField label={t('field.dialCode')}>
                <Input
                  value={form.dialCode}
                  placeholder="+48"
                  onChange={(e) => setForm({ ...form, dialCode: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label={t('field.label')}>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('field.region')}>
                <Select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value as Region })}
                >
                  {regionLabels.options(t).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('field.subregion')}>
                <Input
                  value={form.subregion}
                  onChange={(e) => setForm({ ...form, subregion: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label={t('field.defaultCurrency')}>
              <Select
                value={form.defaultCurrencyCode}
                onChange={(e) => setForm({ ...form, defaultCurrencyCode: e.target.value })}
              >
                <option value="">{t('option.none')}</option>
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('field.sortOrder')}>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              />
            </FormField>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.isEuMember}
                  onChange={(e) => setForm({ ...form, isEuMember: e.target.checked })}
                />
                {t('countries.editor.euMember')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                {t('field.active')}
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('action.cancel')}
              </Button>
              <Button type="submit" disabled={saving} aria-busy={saving}>
                {t('action.save')}
              </Button>
            </div>
            <TranslationsDrawer
              entryType="country"
              entryCode={lockedCode ? form.code : null}
              languages={languages}
            />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function nextSortOrder(rows: Array<{ sortOrder: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 10;
}

async function loadTranslationCompleteness(
  entryType: 'country',
  entryCodes: string[],
  languages: DictionaryLanguage[],
): Promise<Record<string, boolean>> {
  const activeLanguageCodes = languages.filter((language) => language.isActive).map((language) => language.code);
  const pairs = await Promise.all(
    entryCodes.map(async (code) => {
      const res = await dictionaryClient.listTranslations(entryType, code);
      const translated = new Set(res.data.map((row) => row.languageCode));
      return [code, activeLanguageCodes.every((languageCode) => translated.has(languageCode))] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

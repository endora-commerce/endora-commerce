import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { TouchReorderButtons } from '@/components/TouchReorderButtons';
import type {
  Country,
  CreateCountryRequest,
  DictionaryCurrency,
  DictionaryLanguage,
  Region,
  UpdateCountryRequest,
} from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { dictionaryClient } from '../client';
import { EntryStatusBadges } from '../components/EntryStatusBadges';
import { TranslationsDrawer } from '../components/TranslationsDrawer';

const REGIONS: Region[] = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Antarctic'];

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
  const [rows, setRows] = useState<Country[]>([]);
  const [currencies, setCurrencies] = useState<DictionaryCurrency[]>([]);
  const [languages, setLanguages] = useState<DictionaryLanguage[]>([]);
  const [translationCompleteness, setTranslationCompleteness] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Country | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CountryFormState>(emptyCountry);
  const [search, setSearch] = useState('');
  const [draggingCode, setDraggingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
      setError(formatError(err, 'Failed to load countries.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.code, row.alpha3Code, row.label, row.region, row.subregion ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, search]);

  const openCreate = (): void => {
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
        setInfo(`Country ${input.code} created.`);
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
        setInfo(`Country ${selected.code} saved.`);
      }
      await load();
      setCreating(false);
      setSelected(null);
    } catch (err) {
      setError(formatError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (code: string): Promise<void> => {
    try {
      await dictionaryClient.setDefaultCountry(code);
      setInfo(`Country ${code} is now default.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Failed to set default country.'));
    }
  };

  const remove = async (code: string): Promise<void> => {
    if (!confirm(`Delete country ${code}?`)) return;
    try {
      await dictionaryClient.deleteCountry(code);
      setInfo(`Country ${code} deleted.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Delete failed.'));
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
      setError(formatError(err, 'Reorder failed.'));
    }
  };

  const dropOn = async (target: Country): Promise<void> => {
    if (!draggingCode || draggingCode === target.code) return;
    const source = rows.find((row) => row.code === draggingCode);
    setDraggingCode(null);
    if (!source) return;
    try {
      await dictionaryClient.updateCountry(source.code, { sortOrder: target.sortOrder });
      await dictionaryClient.updateCountry(target.code, { sortOrder: source.sortOrder });
      await load();
    } catch (err) {
      setError(formatError(err, 'Reorder failed.'));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between md:space-y-0">
          <CardTitle>{t('countries.title')}</CardTitle>
          <div className="flex w-full flex-wrap gap-2 md:w-auto">
            <Input
              className="min-w-56 md:w-72"
              placeholder={t('countries.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
          {info ? (
            <Alert variant="success">
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          ) : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('countries.loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, index) => (
                  <TableRow
                    key={row.code}
                    draggable
                    onDragStart={() => setDraggingCode(row.code)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropOn(row)}
                    className={draggingCode === row.code ? 'opacity-50' : undefined}
                  >
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>
                      <div>{row.region}</div>
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
                        <TouchReorderButtons
                          onMoveUp={() => void move(row, -1)}
                          onMoveDown={() => void move(row, 1)}
                          disableUp={index === 0}
                          disableDown={index === filtered.length - 1}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="b2b-reorder-desktop-only"
                          disabled={index === 0}
                          title={t('action.moveUp')}
                          onClick={() => void move(row, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="b2b-reorder-desktop-only"
                          disabled={index === filtered.length - 1}
                          title={t('action.moveDown')}
                          onClick={() => void move(row, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                          {t('action.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t('action.setDefault')}
                          disabled={row.isDefault || !row.isActive}
                          onClick={() => void setDefault(row.code)}
                        >
                          <Star />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          title={t('action.delete')}
                          disabled={row.isDefault}
                          onClick={() => void remove(row.code)}
                        >
                          <Trash2 />
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
              <Field label="Code">
                <Input
                  value={form.code}
                  disabled={lockedCode}
                  maxLength={2}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  required
                />
              </Field>
              <Field label="Alpha-3">
                <Input
                  value={form.alpha3Code}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, alpha3Code: e.target.value.toUpperCase() })}
                  required
                />
              </Field>
              <Field label="Numeric">
                <Input
                  value={form.numericCode}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, numericCode: e.target.value })}
                  required
                />
              </Field>
              <Field label="Dial code">
                <Input
                  value={form.dialCode}
                  placeholder="+48"
                  onChange={(e) => setForm({ ...form, dialCode: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Label">
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Region">
                <Select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value as Region })}
                >
                  {REGIONS.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subregion">
                <Input
                  value={form.subregion}
                  onChange={(e) => setForm({ ...form, subregion: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Default currency">
              <Select
                value={form.defaultCurrencyCode}
                onChange={(e) => setForm({ ...form, defaultCurrencyCode: e.target.value })}
              >
                <option value="">None</option>
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort order">
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              />
            </Field>
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
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Save
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

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function nextSortOrder(rows: Array<{ sortOrder: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 10;
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 409 && err.envelope.error.code === 'DICTIONARY_ENTRY_HAS_DEPENDENTS') {
      return `${err.envelope.error.message} Disable the entry instead or remove dependent records first.`;
    }
    return err.envelope.error.message;
  }
  return fallback;
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

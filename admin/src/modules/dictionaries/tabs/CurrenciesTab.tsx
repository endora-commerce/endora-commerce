import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import type {
  CreateDictionaryCurrencyRequest,
  DictionaryCurrency,
  DictionaryLanguage,
  SymbolPosition,
  UpdateDictionaryCurrencyRequest,
} from '@endora-commerce/contracts';
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
import { normalize } from '@/lib/text-normalization';

interface CurrencyFormState {
  code: string;
  label: string;
  symbol: string;
  symbolPosition: SymbolPosition;
  decimalPlaces: number;
  isActive: boolean;
  sortOrder: number;
}

const emptyCurrency: CurrencyFormState = {
  code: '',
  label: '',
  symbol: '',
  symbolPosition: 'prefix',
  decimalPlaces: 2,
  isActive: true,
  sortOrder: 1000,
};

export function CurrenciesTab(): ReactNode {
  const t = useTranslation('dictionaries');
  const [rows, setRows] = useState<DictionaryCurrency[]>([]);
  const [languages, setLanguages] = useState<DictionaryLanguage[]>([]);
  const [translationCompleteness, setTranslationCompleteness] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<DictionaryCurrency | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CurrencyFormState>(emptyCurrency);
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
      const [page, languagePage] = await Promise.all([
        dictionaryClient.listCurrencies({ pageSize: 250, sort: 'sortOrder' }),
        dictionaryClient.listLanguages({ pageSize: 250, sort: 'sortOrder' }),
      ]);
      setRows(page.data);
      setLanguages(languagePage.data);
      setTranslationCompleteness(
        await loadTranslationCompleteness(
          'currency',
          page.data.map((row) => row.code),
          languagePage.data,
        ),
      );
    } catch (err) {
      setError(formatError(err, 'Failed to load currencies.'));
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
      [row.code, row.label, row.symbol].map(normalize).join(' ').includes(needle),
    );
  }, [rows, search]);

  const openCreate = (): void => {
    setCreating(true);
    setSelected(null);
    setForm({ ...emptyCurrency, sortOrder: nextSortOrder(rows) });
  };

  const openEdit = (row: DictionaryCurrency): void => {
    setCreating(false);
    setSelected(row);
    setForm({
      code: row.code,
      label: row.label,
      symbol: row.symbol,
      symbolPosition: row.symbolPosition,
      decimalPlaces: row.decimalPlaces,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const input: CreateDictionaryCurrencyRequest = {
          code: form.code.trim().toUpperCase(),
          label: form.label.trim(),
          symbol: form.symbol.trim(),
          symbolPosition: form.symbolPosition,
          decimalPlaces: form.decimalPlaces,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
        };
        await dictionaryClient.createCurrency(input);
        setInfo(`Currency ${input.code} created.`);
      } else if (selected) {
        const input: UpdateDictionaryCurrencyRequest = {
          label: form.label.trim(),
          symbol: form.symbol.trim(),
          symbolPosition: form.symbolPosition,
          decimalPlaces: form.decimalPlaces,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
        };
        await dictionaryClient.updateCurrency(selected.code, input);
        setInfo(`Currency ${selected.code} saved.`);
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
      await dictionaryClient.setDefaultCurrency(code);
      setInfo(`Currency ${code} is now default.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Failed to set default currency.'));
    }
  };

  const remove = async (code: string): Promise<void> => {
    if (!confirm(`Delete currency ${code}?`)) return;
    try {
      await dictionaryClient.deleteCurrency(code);
      setInfo(`Currency ${code} deleted.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Delete failed.'));
    }
  };

  const move = async (row: DictionaryCurrency, direction: -1 | 1): Promise<void> => {
    const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    const index = ordered.findIndex((item) => item.code === row.code);
    const other = ordered[index + direction];
    if (!other) return;
    try {
      await dictionaryClient.updateCurrency(row.code, { sortOrder: other.sortOrder });
      await dictionaryClient.updateCurrency(other.code, { sortOrder: row.sortOrder });
      await load();
    } catch (err) {
      setError(formatError(err, 'Reorder failed.'));
    }
  };

  const dropOn = async (target: DictionaryCurrency): Promise<void> => {
    if (!draggingCode || draggingCode === target.code) return;
    const source = rows.find((row) => row.code === draggingCode);
    setDraggingCode(null);
    if (!source) return;
    try {
      await dictionaryClient.updateCurrency(source.code, { sortOrder: target.sortOrder });
      await dictionaryClient.updateCurrency(target.code, { sortOrder: source.sortOrder });
      await load();
    } catch (err) {
      setError(formatError(err, 'Reorder failed.'));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between md:space-y-0">
          <CardTitle>{t('currencies.title')}</CardTitle>
          <div className="flex w-full flex-wrap gap-2 md:w-auto">
            <Input
              className="min-w-56 md:w-72"
              placeholder={t('currencies.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="button" onClick={openCreate}>
              <Plus />
              {t('currencies.addCurrency')}
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
            <p className="text-sm text-muted-foreground">{t('currencies.loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Format</TableHead>
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
                      <div>
                        {row.symbolPosition === 'prefix' ? `${row.symbol} 100` : `100 ${row.symbol}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('currencies.decimalPlaces', { count: row.decimalPlaces })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <EntryStatusBadges
                        isDefault={row.isDefault}
                        isActive={row.isActive}
                        translationsComplete={translationCompleteness[row.code] ?? null}
                      />
                    </TableCell>
                    <TableCell>{row.sortOrder}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
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

      <CurrencyEditor
        title={creating ? t('currencies.editor.newCurrency') : selected ? t('currencies.editor.editTitle', { code: selected.code }) : t('currencies.editor.title')}
        form={form}
        setForm={setForm}
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

function CurrencyEditor({
  title,
  form,
  setForm,
  languages,
  lockedCode,
  disabled,
  saving,
  onSubmit,
  onCancel,
}: {
  title: string;
  form: CurrencyFormState;
  setForm: (value: CurrencyFormState) => void;
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
          <p className="text-sm text-muted-foreground">{t('currencies.editor.selectHint')}</p>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Code">
              <Input
                value={form.code}
                disabled={lockedCode}
                maxLength={3}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
              />
            </Field>
            <Field label="Label">
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Symbol">
                <Input
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  required
                />
              </Field>
              <Field label="Symbol position">
                <Select
                  value={form.symbolPosition}
                  onChange={(e) =>
                    setForm({ ...form, symbolPosition: e.target.value as SymbolPosition })
                  }
                >
                  <option value="prefix">Prefix</option>
                  <option value="suffix">Suffix</option>
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Decimal places">
                <Input
                  type="number"
                  min={0}
                  max={6}
                  value={form.decimalPlaces}
                  onChange={(e) => setForm({ ...form, decimalPlaces: Number(e.target.value) })}
                />
              </Field>
              <Field label="Sort order">
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Save
              </Button>
            </div>
            <TranslationsDrawer
              entryType="currency"
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
  entryType: 'currency',
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

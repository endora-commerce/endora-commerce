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
  Country,
  CreateDictionaryLanguageRequest,
  DictionaryLanguage,
  UpdateDictionaryLanguageRequest,
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
import { dictionaryClient } from '../client';
import { EntryStatusBadges } from '../components/EntryStatusBadges';
import { TranslationsDrawer } from '../components/TranslationsDrawer';

interface LanguageFormState {
  code: string;
  label: string;
  nativeLabel: string;
  isRtl: boolean;
  fallbackCode: string;
  isActive: boolean;
  sortOrder: number;
}

const emptyLanguage: LanguageFormState = {
  code: '',
  label: '',
  nativeLabel: '',
  isRtl: false,
  fallbackCode: '',
  isActive: true,
  sortOrder: 1000,
};

export function LanguagesTab(): ReactNode {
  const [rows, setRows] = useState<DictionaryLanguage[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [translationCompleteness, setTranslationCompleteness] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<DictionaryLanguage | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<LanguageFormState>(emptyLanguage);
  const [search, setSearch] = useState('');
  const [draggingCode, setDraggingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assocSaving, setAssocSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async (): Promise<DictionaryLanguage[]> => {
    setLoading(true);
    setError(null);
    try {
      const [languagePage, countryPage] = await Promise.all([
        dictionaryClient.listLanguages({ pageSize: 250, sort: 'sortOrder' }),
        dictionaryClient.listCountries({ pageSize: 250, sort: 'sortOrder' }),
      ]);
      setRows(languagePage.data);
      setCountries(countryPage.data);
      setTranslationCompleteness(
        await loadTranslationCompleteness(
          'language',
          languagePage.data.map((row) => row.code),
          languagePage.data,
        ),
      );
      return languagePage.data;
    } catch (err) {
      setError(formatError(err, 'Failed to load languages.'));
      return [];
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
      [row.code, row.label, row.nativeLabel, row.fallbackCode ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, search]);

  const openCreate = (): void => {
    setCreating(true);
    setSelected(null);
    setForm({ ...emptyLanguage, sortOrder: nextSortOrder(rows) });
  };

  const openEdit = (row: DictionaryLanguage): void => {
    setCreating(false);
    setSelected(row);
    setForm({
      code: row.code,
      label: row.label,
      nativeLabel: row.nativeLabel,
      isRtl: row.isRtl,
      fallbackCode: row.fallbackCode ?? '',
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const input: CreateDictionaryLanguageRequest = {
          code: form.code.trim(),
          label: form.label.trim(),
          nativeLabel: form.nativeLabel.trim(),
          isRtl: form.isRtl,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
          ...(form.fallbackCode ? { fallbackCode: form.fallbackCode } : {}),
        };
        await dictionaryClient.createLanguage(input);
        setInfo(`Language ${input.code} created.`);
      } else if (selected) {
        const input: UpdateDictionaryLanguageRequest = {
          label: form.label.trim(),
          nativeLabel: form.nativeLabel.trim(),
          isRtl: form.isRtl,
          fallbackCode: form.fallbackCode || null,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
        };
        await dictionaryClient.updateLanguage(selected.code, input);
        setInfo(`Language ${selected.code} saved.`);
      }
      const fresh = await load();
      const code = creating ? form.code.trim() : selected?.code;
      const nextSelected = fresh.find((row) => row.code === code) ?? null;
      setCreating(false);
      setSelected(nextSelected);
      if (nextSelected) openEdit(nextSelected);
    } catch (err) {
      setError(formatError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (code: string): Promise<void> => {
    try {
      await dictionaryClient.setDefaultLanguage(code);
      setInfo(`Language ${code} is now default.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Failed to set default language.'));
    }
  };

  const remove = async (code: string): Promise<void> => {
    if (!confirm(`Delete language ${code}?`)) return;
    try {
      await dictionaryClient.deleteLanguage(code);
      setInfo(`Language ${code} deleted.`);
      const fresh = await load();
      setSelected(fresh.find((row) => row.code === selected?.code) ?? null);
    } catch (err) {
      setError(formatError(err, 'Delete failed.'));
    }
  };

  const move = async (row: DictionaryLanguage, direction: -1 | 1): Promise<void> => {
    const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    const index = ordered.findIndex((item) => item.code === row.code);
    const other = ordered[index + direction];
    if (!other) return;
    try {
      await dictionaryClient.updateLanguage(row.code, { sortOrder: other.sortOrder });
      await dictionaryClient.updateLanguage(other.code, { sortOrder: row.sortOrder });
      await load();
    } catch (err) {
      setError(formatError(err, 'Reorder failed.'));
    }
  };

  const dropOn = async (target: DictionaryLanguage): Promise<void> => {
    if (!draggingCode || draggingCode === target.code) return;
    const source = rows.find((row) => row.code === draggingCode);
    setDraggingCode(null);
    if (!source) return;
    try {
      await dictionaryClient.updateLanguage(source.code, { sortOrder: target.sortOrder });
      await dictionaryClient.updateLanguage(target.code, { sortOrder: source.sortOrder });
      await load();
    } catch (err) {
      setError(formatError(err, 'Reorder failed.'));
    }
  };

  const setAssociation = async (
    language: DictionaryLanguage,
    countryCode: string,
    enabled: boolean,
  ): Promise<void> => {
    setAssocSaving(countryCode);
    setError(null);
    try {
      if (enabled) {
        await dictionaryClient.upsertLanguageCountry(language.code, countryCode);
      } else {
        await dictionaryClient.removeLanguageCountry(language.code, countryCode);
      }
      const fresh = await load();
      const nextSelected = fresh.find((row) => row.code === language.code) ?? null;
      setSelected(nextSelected);
      if (nextSelected) openEdit(nextSelected);
    } catch (err) {
      setError(formatError(err, 'Association update failed.'));
    } finally {
      setAssocSaving(null);
    }
  };

  const makePrimary = async (language: DictionaryLanguage, countryCode: string): Promise<void> => {
    setAssocSaving(countryCode);
    setError(null);
    try {
      await dictionaryClient.upsertLanguageCountry(language.code, countryCode, { isPrimary: true });
      setInfo(`${countryCode} is primary for ${language.code}.`);
      const fresh = await load();
      const nextSelected = fresh.find((row) => row.code === language.code) ?? null;
      setSelected(nextSelected);
      if (nextSelected) openEdit(nextSelected);
    } catch (err) {
      setError(formatError(err, 'Primary country update failed.'));
    } finally {
      setAssocSaving(null);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between md:space-y-0">
          <CardTitle>Languages</CardTitle>
          <div className="flex w-full flex-wrap gap-2 md:w-auto">
            <Input
              className="min-w-56 md:w-72"
              placeholder="Search code or label"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="button" onClick={openCreate}>
              <Plus />
              Add language
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
            <p className="text-sm text-muted-foreground">Loading languages…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Fallback</TableHead>
                  <TableHead>Countries</TableHead>
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
                    <TableCell>
                      <div>{row.label}</div>
                      <div className="text-xs text-muted-foreground">{row.nativeLabel}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.fallbackCode ?? '—'}</TableCell>
                    <TableCell>{row.countries.length}</TableCell>
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
                          title="Move up"
                          onClick={() => void move(row, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={index === filtered.length - 1}
                          title="Move down"
                          onClick={() => void move(row, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Set default"
                          disabled={row.isDefault || !row.isActive}
                          onClick={() => void setDefault(row.code)}
                        >
                          <Star />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          title="Delete"
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

      <LanguageEditor
        title={creating ? 'New language' : selected ? `Edit ${selected.code}` : 'Language editor'}
        form={form}
        setForm={setForm}
        languages={rows}
        countries={countries}
        selected={selected}
        lockedCode={!creating}
        disabled={!creating && !selected}
        saving={saving}
        assocSaving={assocSaving}
        onSubmit={() => void save()}
        onCancel={() => {
          setCreating(false);
          setSelected(null);
        }}
        onSetAssociation={setAssociation}
        onMakePrimary={makePrimary}
      />
    </div>
  );
}

function LanguageEditor({
  title,
  form,
  setForm,
  languages,
  countries,
  selected,
  lockedCode,
  disabled,
  saving,
  assocSaving,
  onSubmit,
  onCancel,
  onSetAssociation,
  onMakePrimary,
}: {
  title: string;
  form: LanguageFormState;
  setForm: (value: LanguageFormState) => void;
  languages: DictionaryLanguage[];
  countries: Country[];
  selected: DictionaryLanguage | null;
  lockedCode: boolean;
  disabled: boolean;
  saving: boolean;
  assocSaving: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  onSetAssociation: (
    language: DictionaryLanguage,
    countryCode: string,
    enabled: boolean,
  ) => Promise<void>;
  onMakePrimary: (language: DictionaryLanguage, countryCode: string) => Promise<void>;
}): ReactNode {
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
          <p className="text-sm text-muted-foreground">Select a language or create a new one.</p>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Code">
              <Input
                value={form.code}
                disabled={lockedCode}
                placeholder="en-US"
                onChange={(e) => setForm({ ...form, code: e.target.value })}
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
            <Field label="Native label">
              <Input
                value={form.nativeLabel}
                onChange={(e) => setForm({ ...form, nativeLabel: e.target.value })}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fallback">
                <Select
                  value={form.fallbackCode}
                  onChange={(e) => setForm({ ...form, fallbackCode: e.target.value })}
                >
                  <option value="">None</option>
                  {languages
                    .filter((language) => language.code !== form.code)
                    .map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.code} — {language.label}
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
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.isRtl}
                  onChange={(e) => setForm({ ...form, isRtl: e.target.checked })}
                />
                RTL
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

            {selected ? (
              <div className="border-t pt-4">
                <div className="mb-2 text-sm font-medium">Associated countries</div>
                <div className="max-h-72 space-y-2 overflow-auto rounded-md border p-2">
                  {countries.map((country) => {
                    const checked = selected.countries.includes(country.code);
                    return (
                      <div key={country.code} className="flex items-center justify-between gap-2">
                        <label className="flex min-w-0 items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            disabled={assocSaving === country.code}
                            onChange={(e) =>
                              void onSetAssociation(selected, country.code, e.target.checked)
                            }
                          />
                          <span className="truncate">
                            <span className="font-mono text-xs">{country.code}</span> {country.label}
                          </span>
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!checked || assocSaving === country.code}
                          onClick={() => void onMakePrimary(selected, country.code)}
                        >
                          Primary
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <TranslationsDrawer
              entryType="language"
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
  entryType: 'language',
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

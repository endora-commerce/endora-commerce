import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { pimLocaleTagSchema, type ImportProfile, type PimLocaleMappingEntry } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  MultiSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  createProfile,
  errorMessage,
  listChannelLanguageTargets,
  updateProfile,
  type ChannelLanguageTarget,
} from './import-profiles-api.js';

/**
 * Create / edit one products import profile (feature 172, `contracts/import-profiles-and-csv.md`
 * §4): its name, the source language whose values write Global, and the mapping table — source
 * locale, optional source channel, and the target channel × language pairs from the module's
 * own channel-targets read. A target whose channel no longer exists is kept and flagged (§1: targets are not
 * validated at save; the import reports them per row).
 */

interface MappingRow {
  /** A client-side key only — mapping entries have no id of their own. */
  key: number;
  sourceLocale: string;
  sourceChannel: string;
  targets: PimLocaleMappingEntry['targets'];
}

const targetValue = (channelId: string, languageCode: string): string => `${channelId}|${languageCode}`;

/** Which input a validation problem names, so it is marked and focused (WCAG 3.3.1). */
type Problem = { message: string; field: 'name' | 'global' } | { message: string; field: 'sourceLocale' | 'targets'; row: number };

/** A language tag in the admin's language ("pl-PL" → "Polish (Poland)"), else the tag itself. */
function languageName(tag: string, adminLanguage: string): string {
  try {
    return new Intl.DisplayNames([adminLanguage], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export interface ImportProfileDialogProps {
  /** `null` creates a profile. */
  profile: ImportProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ImportProfileDialog({ profile, onClose, onSaved }: ImportProfileDialogProps): ReactNode {
  const t = useTranslation('import_export');
  const adminLanguage = useContext(AppLanguageContext)?.language ?? 'en';
  const nameId = useId();
  const globalId = useId();
  const problemId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const globalRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);
  const [name, setName] = useState(profile?.name ?? '');
  const [sourceLanguageForGlobal, setSourceLanguageForGlobal] = useState(profile?.sourceLanguageForGlobal ?? '');
  const [rows, setRows] = useState<MappingRow[]>(() =>
    (profile?.localeMapping ?? []).map((entry) => ({
      key: nextKey.current++,
      sourceLocale: entry.sourceLocale,
      sourceChannel: entry.sourceChannel ?? '',
      targets: entry.targets,
    })),
  );
  const [targets, setTargets] = useState<ChannelLanguageTarget[] | null>(null);
  const [targetsError, setTargetsError] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const targetsRequest = useRef(0);
  const loadTargets = useCallback((): void => {
    const request = ++targetsRequest.current;
    setTargetsError(false);
    setTargets(null);
    listChannelLanguageTargets()
      .then((list) => {
        if (request === targetsRequest.current) setTargets(list);
      })
      .catch(() => {
        if (request === targetsRequest.current) setTargetsError(true);
      });
  }, []);
  useEffect(() => {
    loadTargets();
    return (): void => {
      targetsRequest.current += 1;
    };
  }, [loadTargets]);

  const options = useMemo(
    () =>
      (targets ?? []).map((target) => ({
        value: targetValue(target.channelId, target.languageCode),
        label: `${target.channelCode} / ${languageName(target.languageCode, adminLanguage)}`,
      })),
    [targets, adminLanguage],
  );
  const knownChannels = useMemo(() => new Set((targets ?? []).map((target) => target.channelId)), [targets]);

  const updateRow = (key: number, patch: Partial<MappingRow>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const validate = (): Problem | null => {
    if (name.trim() === '') return { message: t('importProfiles.error.nameRequired'), field: 'name' };
    const global = sourceLanguageForGlobal.trim();
    if (global !== '' && !pimLocaleTagSchema.safeParse(global).success) {
      return { message: t('importProfiles.error.locale'), field: 'global' };
    }
    for (const row of rows) {
      if (!pimLocaleTagSchema.safeParse(row.sourceLocale.trim()).success) {
        return { message: t('importProfiles.error.locale'), field: 'sourceLocale', row: row.key };
      }
      if (row.targets.length === 0) {
        return { message: t('importProfiles.error.targetRequired'), field: 'targets', row: row.key };
      }
    }
    return null;
  };

  /** The control a problem names; the targets select is reached through its row's cell. */
  const focusProblem = (found: Problem): void => {
    if (!('row' in found)) {
      (found.field === 'name' ? nameRef : globalRef).current?.focus();
    } else {
      const selector = found.field === 'sourceLocale' ? 'input' : 'button';
      dialogBodyRef.current
        ?.querySelector<HTMLElement>(`[data-mapping-row="${found.row}"] [data-mapping-cell="${found.field}"] ${selector}`)
        ?.focus();
    }
  };

  const invalid = (field: Problem['field'], row?: number): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    problem !== null && problem.field === field && (row === undefined || ('row' in problem && problem.row === row))
      ? { 'aria-invalid': true, 'aria-describedby': problemId }
      : {};

  const save = async (): Promise<void> => {
    const found = validate();
    setProblem(found);
    setSaveError(null);
    if (found !== null) {
      focusProblem(found);
      return;
    }
    const body = {
      name: name.trim(),
      sourceLanguageForGlobal: sourceLanguageForGlobal.trim() === '' ? null : sourceLanguageForGlobal.trim(),
      localeMapping: rows.map((row) => ({
        sourceLocale: row.sourceLocale.trim(),
        sourceChannel: row.sourceChannel.trim() === '' ? null : row.sourceChannel.trim(),
        targets: row.targets,
      })),
    };
    setSaving(true);
    try {
      if (profile === null) await createProfile({ ...body, entity: 'products' });
      else await updateProfile(profile.id, body);
      onSaved();
    } catch (err) {
      setSaveError(errorMessage(err, t, 'importProfiles.error.save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={profile === null ? t('importProfiles.dialog.createTitle') : t('importProfiles.dialog.editTitle')}
      onClose={onClose}
      busy={saving}
      dismissOnScrim={false}
      initialFocusRef={nameRef}
      widthClassName="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('importProfiles.cancel')}
          </Button>
          <Button
            type="button"
            onClick={(): void => {
              void save();
            }}
            disabled={saving}
          >
            {saving ? t('importProfiles.saving') : t('importProfiles.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" ref={dialogBodyRef}>
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{t('importProfiles.field.name')}</Label>
          <Input
            id={nameId}
            ref={nameRef}
            {...invalid('name')}
            value={name}
            maxLength={120}
            onChange={(event): void => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={globalId}>{t('importProfiles.field.sourceLanguageForGlobal')}</Label>
          <Input
            id={globalId}
            ref={globalRef}
            {...invalid('global')}
            value={sourceLanguageForGlobal}
            placeholder="en_US"
            onChange={(event): void => setSourceLanguageForGlobal(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('importProfiles.field.sourceLanguageForGlobalHint')}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('importProfiles.mapping.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('importProfiles.mapping.hint')}</p>
          {targetsError ? (
            <Alert variant="warning">
              <AlertDescription>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">{t('importProfiles.error.channels')}</span>
                  <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={loadTargets}>
                    {t('importProfiles.retry')}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          <p role="status" className={targets === null && !targetsError ? 'text-xs text-muted-foreground' : 'sr-only'}>
            {targets === null && !targetsError ? t('importProfiles.mapping.targetsLoading') : ''}
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('importProfiles.mapping.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('importProfiles.mapping.sourceLocale')}</TableHead>
                  <TableHead>{t('importProfiles.mapping.sourceChannel')}</TableHead>
                  <TableHead>{t('importProfiles.mapping.targets')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('importProfiles.mapping.remove')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, position) => {
                  const rowNumber = position + 1;
                  const missing = targets === null ? [] : row.targets.filter((target) => !knownChannels.has(target.channelId));
                  const selected = row.targets
                    .filter((target) => knownChannels.has(target.channelId))
                    .map((target) => targetValue(target.channelId, target.languageCode));
                  return (
                    <TableRow key={row.key} data-mapping-row={row.key}>
                      <TableCell className="align-top" data-mapping-cell="sourceLocale">
                        <Input
                          aria-label={t('importProfiles.mapping.rowLabel', { label: t('importProfiles.mapping.sourceLocale'), row: rowNumber })}
                          {...invalid('sourceLocale', row.key)}
                          value={row.sourceLocale}
                          placeholder="pl_PL"
                          onChange={(event): void => updateRow(row.key, { sourceLocale: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          aria-label={t('importProfiles.mapping.rowLabel', { label: t('importProfiles.mapping.sourceChannel'), row: rowNumber })}
                          value={row.sourceChannel}
                          placeholder={t('importProfiles.mapping.anySourceChannel')}
                          onChange={(event): void => updateRow(row.key, { sourceChannel: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="min-w-56 align-top" data-mapping-cell="targets">
                        {targets === null && row.targets.length > 0 ? (
                          // The channel read failed or is still running: the saved targets are kept unchanged.
                          <p className="mb-1 text-xs text-muted-foreground">
                            {t('importProfiles.mapping.keptTargets', { count: row.targets.length })}
                          </p>
                        ) : null}
                        <MultiSelect
                          options={options}
                          selected={selected}
                          ariaLabel={t('importProfiles.mapping.rowLabel', { label: t('importProfiles.mapping.targets'), row: rowNumber })}
                          placeholder={t('importProfiles.mapping.targetsPlaceholder')}
                          disabled={targets === null}
                          onChange={(next): void =>
                            updateRow(row.key, {
                              targets: [
                                ...missing,
                                ...next.map((value) => {
                                  const [channelId = '', languageCode = ''] = value.split('|');
                                  return { channelId, languageCode };
                                }),
                              ],
                            })
                          }
                        />
                        {problem !== null && 'row' in problem && problem.field === 'targets' && problem.row === row.key ? (
                          <p className="mt-1 text-xs text-destructive">{problem.message}</p>
                        ) : null}
                        {missing.length > 0 ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <p className="text-xs text-destructive">{t('importProfiles.mapping.missingChannel')}</p>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={(): void =>
                                updateRow(row.key, {
                                  targets: row.targets.filter((target) => knownChannels.has(target.channelId)),
                                })
                              }
                            >
                              {t('importProfiles.mapping.dropMissing')}
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="max-lg:min-h-11 max-lg:min-w-11"
                          aria-label={t('importProfiles.mapping.removeRow', { row: rowNumber })}
                          onClick={(): void => {
                            setRows((current) => current.filter((other) => other.key !== row.key));
                            // The row and its button are gone: keep focus in the dialog.
                            addRef.current?.focus();
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Button
            ref={addRef}
            type="button"
            variant="outline"
            size="sm"
            className="max-lg:min-h-11"
            onClick={(): void =>
              setRows((current) => [
                ...current,
                { key: nextKey.current++, sourceLocale: '', sourceChannel: '', targets: [] },
              ])
            }
          >
            <Plus />
            {t('importProfiles.mapping.add')}
          </Button>
        </div>

        {problem !== null || saveError !== null ? (
          <Alert variant="destructive" id={problemId}>
            <AlertDescription>{problem?.message ?? saveError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}

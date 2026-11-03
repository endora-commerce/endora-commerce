import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  createProfile,
  errorMessage,
  listChannelLanguageTargets,
  updateProfile,
  type ChannelLanguageTarget,
} from './import-profiles-api.js';

/**
 * Create / edit one products import profile (feature 170, `contracts/import-profiles-and-csv.md`
 * §4): its name, the source language whose values write Global, and the mapping table — source
 * locale, optional source channel, and the target channel × language pairs from the channels
 * API. A target whose channel no longer exists is kept and flagged (§1: targets are not
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

export interface ImportProfileDialogProps {
  /** `null` creates a profile. */
  profile: ImportProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ImportProfileDialog({ profile, onClose, onSaved }: ImportProfileDialogProps): ReactNode {
  const t = useTranslation('import_export');
  const nameId = useId();
  const globalId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listChannelLanguageTargets()
      .then((list) => {
        if (!cancelled) setTargets(list);
      })
      .catch(() => {
        if (!cancelled) setTargetsError(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () =>
      (targets ?? []).map((target) => ({
        value: targetValue(target.channelId, target.languageCode),
        label: `${target.channelCode} / ${target.languageCode}`,
      })),
    [targets],
  );
  const knownChannels = useMemo(() => new Set((targets ?? []).map((target) => target.channelId)), [targets]);

  const updateRow = (key: number, patch: Partial<MappingRow>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const validate = (): string | null => {
    if (name.trim() === '') return t('importProfiles.error.nameRequired');
    const global = sourceLanguageForGlobal.trim();
    if (global !== '' && !pimLocaleTagSchema.safeParse(global).success) return t('importProfiles.error.locale');
    for (const row of rows) {
      if (!pimLocaleTagSchema.safeParse(row.sourceLocale.trim()).success) return t('importProfiles.error.locale');
      if (row.targets.length === 0) return t('importProfiles.error.targetRequired');
    }
    return null;
  };

  const save = async (): Promise<void> => {
    const problem = validate();
    setValidationError(problem);
    setSaveError(null);
    if (problem !== null) return;
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
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{t('importProfiles.field.name')}</Label>
          <Input
            id={nameId}
            ref={nameRef}
            value={name}
            maxLength={120}
            onChange={(event): void => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={globalId}>{t('importProfiles.field.sourceLanguageForGlobal')}</Label>
          <Input
            id={globalId}
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
              <AlertDescription>{t('importProfiles.error.channels')}</AlertDescription>
            </Alert>
          ) : null}
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
                {rows.map((row) => {
                  const missing = targets === null ? [] : row.targets.filter((target) => !knownChannels.has(target.channelId));
                  const selected = row.targets
                    .filter((target) => knownChannels.has(target.channelId))
                    .map((target) => targetValue(target.channelId, target.languageCode));
                  return (
                    <TableRow key={row.key}>
                      <TableCell className="align-top">
                        <Input
                          aria-label={t('importProfiles.mapping.sourceLocale')}
                          value={row.sourceLocale}
                          placeholder="pl_PL"
                          onChange={(event): void => updateRow(row.key, { sourceLocale: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          aria-label={t('importProfiles.mapping.sourceChannel')}
                          value={row.sourceChannel}
                          placeholder={t('importProfiles.mapping.anySourceChannel')}
                          onChange={(event): void => updateRow(row.key, { sourceChannel: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="min-w-56 align-top">
                        <MultiSelect
                          options={options}
                          selected={selected}
                          ariaLabel={t('importProfiles.mapping.targets')}
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
                          aria-label={t('importProfiles.mapping.remove')}
                          onClick={(): void => setRows((current) => current.filter((other) => other.key !== row.key))}
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
            type="button"
            variant="outline"
            size="sm"
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

        {validationError ?? saveError ? (
          <Alert variant="destructive">
            <AlertDescription>{validationError ?? saveError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  LANGUAGE_FALLBACK,
  PROJECT_DICTIONARY_NAME_MAX,
  SUPPORTED_LANGUAGES,
  type ProjectRole,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Checkbox, Input, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import {
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi, type ProjectDictionaryKind } from '../api.js';
import { errorMessage } from '../lib/labels.js';

/** A Project Role or a loss reason — one shape (`contracts/src/projects.ts`). */
type Entry = ProjectRole;

/** The i18n key prefix of each dictionary's own sentences. */
const PREFIX: Record<ProjectDictionaryKind, 'roles' | 'lossReasons'> = {
  roles: 'roles',
  'loss-reasons': 'lossReasons',
};

/**
 * A page description only where it states a rule the screen does not show:
 * a project role grants no permission. The loss reasons need none (UX audit
 * WORK-11).
 */
const DESCRIPTION: Record<ProjectDictionaryKind, 'roles.description' | null> = {
  roles: 'roles.description',
  'loss-reasons': null,
};

/** The fallback language first: its name is the row's default name, so it is the one required. */
const LANGUAGES: readonly SupportedLanguage[] = [
  LANGUAGE_FALLBACK,
  ...SUPPORTED_LANGUAGES.filter((language) => language !== LANGUAGE_FALLBACK),
];

export interface DictionaryScreenProps {
  kind: ProjectDictionaryKind;
}

/**
 * The screen of one configuration dictionary of `projects` — Project Roles or
 * loss reasons (`specs/163-projects-and-tasks/`, User Story 4;
 * `contracts/admin-surfaces.md` §2, "Dictionary screens").
 *
 * Every row with its name in each admin language; built-in rows marked. Rows
 * are added and renamed in a dialog with one field per admin language — the
 * fallback language's name is required and is the row's default name —
 * archived and restored from the row's menu, and deleted behind a
 * confirmation. A built-in row's delete is shown disabled with the reason, so
 * the rule is visible rather than a missing entry. Archived rows are listed on
 * request. Every refusal is shown in the server's words where it was asked.
 */
export function DictionaryScreen({ kind }: DictionaryScreenProps): ReactNode {
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const prefix = PREFIX[kind];
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** `null` closed; `'new'` adding; an entry renaming it. */
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const options = { active: !showArchived };
      const entries = await (kind === 'roles' ? projectsApi.listRoles(options) : projectsApi.listLossReasons(options));
      if (current !== sequence.current) return;
      setRows(entries);
      setLoaded(true);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t(`${prefix}.loadError`)));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [kind, prefix, showArchived, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setArchived = async (entry: Entry, archived: boolean): Promise<void> => {
    setActionError(null);
    try {
      await (archived
        ? projectsApi.archiveDictionaryEntry(kind, entry.id)
        : projectsApi.restoreDictionaryEntry(kind, entry.id));
      await load();
    } catch (failure) {
      setActionError(errorMessage(failure, t('dictionary.actionError')));
    }
  };

  const columns: ResponsiveColumn<Entry>[] = [
    ...LANGUAGES.map(
      (language, index): ResponsiveColumn<Entry> => ({
        id: `name-${language}`,
        header: t('dictionary.col.name', { language: t(`dictionary.language.${language}`) }),
        primary: index === 0,
        render: (entry) =>
          index === 0 ? (
            <span className="font-medium [overflow-wrap:anywhere]">{entry.name[language] ?? entry.defaultName}</span>
          ) : (
            <span className="[overflow-wrap:anywhere]">{entry.name[language] ?? '—'}</span>
          ),
      }),
    ),
    {
      id: 'status',
      header: t('dictionary.col.status'),
      render: (entry) => (
        <span className="flex flex-wrap gap-1">
          {entry.isSystem ? <Badge variant="outline">{t(`${prefix}.builtIn`)}</Badge> : null}
          {entry.archivedAt ? <Badge variant="secondary">{t(`${prefix}.archived`)}</Badge> : null}
        </span>
      ),
    },
  ];

  const add = (
    <Button className="min-h-11 sm:min-h-9" onClick={(): void => setEditing('new')}>
      <Plus aria-hidden="true" />
      {t(`${prefix}.add`)}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t(`${prefix}.title`)}
        description={DESCRIPTION[kind] ? t(DESCRIPTION[kind]) : undefined}
        actions={add}
      />

      <Card>
        <CardContent className="space-y-4" aria-busy={loading}>
          <div className="space-y-1">
            <label htmlFor={`${kind}-archived`} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <Checkbox
                id={`${kind}-archived`}
                checked={showArchived}
                onChange={(event): void => setShowArchived(event.target.checked)}
              />
              {t(`${prefix}.showArchived`)}
            </label>
            <p className="text-xs text-muted-foreground">{t(`${prefix}.archivedNote`)}</p>
          </div>
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('dictionary.loading')}
            </p>
          ) : (
            <ResponsiveTable
              data={rows}
              columns={columns}
              keyExtractor={(entry): string => entry.id}
              renderActions={(entry): ReactNode => (
                <RowActionMenu label={t('dictionary.actionsFor', { name: entry.label })}>
                  <RowActionMenuItem onSelect={(): void => setEditing(entry)}>{t('dictionary.rename')}</RowActionMenuItem>
                  {entry.archivedAt ? (
                    <RowActionMenuItem onSelect={(): void => void setArchived(entry, false)}>
                      {t('dictionary.restore')}
                    </RowActionMenuItem>
                  ) : (
                    <RowActionMenuItem onSelect={(): void => void setArchived(entry, true)}>
                      {t('dictionary.archive')}
                    </RowActionMenuItem>
                  )}
                  <RowActionMenuSeparator />
                  <RowActionMenuItem
                    destructive
                    disabled={entry.isSystem}
                    title={entry.isSystem ? t('dictionary.deleteBuiltIn') : undefined}
                    onSelect={(): void => setDeleting(entry)}
                  >
                    {t('dictionary.delete')}
                  </RowActionMenuItem>
                </RowActionMenu>
              )}
              emptyState={<p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('dictionary.empty')}</p>}
            />
          )}
        </CardContent>
      </Card>

      {editing ? (
        <EntryDialog
          kind={kind}
          entry={editing === 'new' ? null : editing}
          title={editing === 'new' ? t(`${prefix}.addTitle`) : t('dictionary.renameTitle', { name: editing.label })}
          onClose={(): void => setEditing(null)}
          onSaved={(): void => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteEntryDialog
          kind={kind}
          entry={deleting}
          onClose={(): void => setDeleting(null)}
          onDeleted={(): void => {
            setDeleting(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

interface EntryDialogProps {
  kind: ProjectDictionaryKind;
  /** `null` adds a row. */
  entry: Entry | null;
  title: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Adding or renaming a row: one name per admin language, the fallback language's required. */
function EntryDialog({ kind, entry, title, onClose, onSaved }: EntryDialogProps): ReactNode {
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const formId = useId();
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(LANGUAGES.map((language) => [language, entry?.name[language] ?? ''])),
  );
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fallbackLabel = t(`dictionary.language.${LANGUAGE_FALLBACK}`);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = Object.fromEntries(
      LANGUAGES.map((language) => [language, (names[language] ?? '').trim()]).filter(([, value]) => value !== ''),
    ) as Record<string, string>;
    const defaultName = name[LANGUAGE_FALLBACK];
    if (!defaultName) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setBusy(true);
    setError(null);
    try {
      await (entry
        ? projectsApi.updateDictionaryEntry(kind, entry.id, { defaultName, name })
        : projectsApi.createDictionaryEntry(kind, { defaultName, name }));
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure, t('dictionary.saveError')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={title}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
            {tCore('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy}>
            {t('dictionary.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" noValidate onSubmit={(event): void => void submit(event)}>
        {LANGUAGES.map((language) => {
          const id = `${formId}-${language}`;
          const isFallback = language === LANGUAGE_FALLBACK;
          const invalid = isFallback && missing;
          const describedBy = isFallback ? [`${id}-hint`, invalid ? `${id}-error` : null].filter(Boolean).join(' ') : undefined;
          return (
            <div key={language} className="space-y-1">
              <Label htmlFor={id}>{t('dictionary.field.name', { language: t(`dictionary.language.${language}`) })}</Label>
              <Input
                id={id}
                value={names[language] ?? ''}
                maxLength={PROJECT_DICTIONARY_NAME_MAX}
                required={isFallback}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event): void => setNames((current) => ({ ...current, [language]: event.target.value }))}
              />
              {isFallback ? (
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                  {t('dictionary.field.fallbackHint')}
                </p>
              ) : null}
              {invalid ? (
                <p id={`${id}-error`} className="text-xs text-destructive">
                  {t('dictionary.field.required', { language: fallbackLabel })}
                </p>
              ) : null}
            </div>
          );
        })}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </form>
    </ModalDialog>
  );
}

interface DeleteEntryDialogProps {
  kind: ProjectDictionaryKind;
  entry: Entry;
  onClose: () => void;
  onDeleted: () => void;
}

/** Deleting an operator row, behind a confirmation; a refusal stays in the dialog. */
function DeleteEntryDialog({ kind, entry, onClose, onDeleted }: DeleteEntryDialogProps): ReactNode {
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await projectsApi.deleteDictionaryEntry(kind, entry.id);
      onDeleted();
    } catch (failure) {
      setError(errorMessage(failure, t('dictionary.actionError')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('dictionary.deleteTitle', { name: entry.label })}
      busy={busy}
      onClose={onClose}
      aria-describedby={bodyId}
      footer={
        <>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
            {tCore('common.action.cancel')}
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 sm:min-h-9"
            disabled={busy}
            aria-busy={busy}
            onClick={(): void => void confirm()}
          >
            {t('dictionary.delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p id={bodyId} className="text-sm">
          {t('dictionary.deleteBody')}
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import type {
  AdminSearchConfigurationEntityView,
  AdminSearchConfigurationView,
  UpdateAdminSearchConfigurationRequest,
} from '@endora-commerce/contracts';
import { ApiError, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  InlineStatus,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { getConfiguration, putConfiguration } from '../api.js';

/** One record type's choice on the screen, before it is saved. */
interface Draft {
  readonly enabled: boolean;
  readonly fields: readonly string[];
  /** "Restore defaults" was chosen: the stored entry is removed on save. */
  readonly restore: boolean;
}

function draftOf(entity: AdminSearchConfigurationEntityView): Draft {
  return { enabled: entity.enabled, fields: entity.fields.filter((f) => f.selected).map((f) => f.code), restore: false };
}

/** The type's shipped choice; only a customised type has a stored entry to remove. */
function defaultsOf(entity: AdminSearchConfigurationEntityView): Draft {
  return {
    enabled: true,
    fields: entity.fields.filter((f) => f.defaultSelected).map((f) => f.code),
    restore: entity.customized,
  };
}

function sameSelection(a: Draft, b: Draft): boolean {
  return a.enabled === b.enabled && a.fields.length === b.fields.length && a.fields.every((code) => b.fields.includes(code));
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.restore === b.restore && sameSelection(a, b);
}

/**
 * Global search configuration (`specs/150-admin-global-search/` User Story 2,
 * contracts/admin-ui.md §2.2): for each record type whose module is present,
 * whether it takes part and which of its offered fields are searched.
 *
 * One card per record type, in the server's order. A type that takes part
 * needs a field: the card says so beside the checklist and **Save** waits
 * (FR-020; the server refuses it too). A save sends only the types that
 * changed, with the version the screen was loaded at — a configuration changed
 * meanwhile by somebody else is answered with a dialog offering to reload
 * (FR-026), never overwritten.
 */
export function GlobalSearchConfigurationPage(): ReactNode {
  const t = useTranslation('admin_search');
  const { language } = useTranslationContext();
  const [view, setView] = useState<AdminSearchConfigurationView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);

  const adopt = useCallback((next: AdminSearchConfigurationView): void => {
    setView(next);
    setDrafts(Object.fromEntries(next.entities.map((entity) => [entity.entityType, draftOf(entity)])));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      adopt(await getConfiguration(language));
    } catch (error) {
      setLoadError(
        error instanceof ApiError && error.status === 403 ? t('page.configuration.forbidden') : t('page.configuration.loadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [adopt, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(
    () => (view === null ? [] : view.entities.filter((entity) => !sameDraft(drafts[entity.entityType] ?? draftOf(entity), draftOf(entity)))),
    [view, drafts],
  );
  const dirty = changed.length > 0;
  const invalid = Object.values(drafts).some((draft) => draft.enabled && draft.fields.length === 0);
  useUnsavedChangesPrompt(dirty);

  const update = (entityType: string, change: (draft: Draft) => Draft): void => {
    setSaved(false);
    setDrafts((current) => {
      const draft = current[entityType];
      return draft === undefined ? current : { ...current, [entityType]: change(draft) };
    });
  };

  const save = async (): Promise<void> => {
    if (view === null || invalid || !dirty) return;
    const request: UpdateAdminSearchConfigurationRequest = {
      expectedVersion: view.version,
      entities: changed.map((entity) => {
        const draft = drafts[entity.entityType]!;
        return draft.restore
          ? { entityType: entity.entityType }
          : { entityType: entity.entityType, enabled: draft.enabled, fields: [...draft.fields] };
      }),
    };
    setSaving(true);
    setSaveError(null);
    try {
      adopt(await putConfiguration(language, request));
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else setSaveError(error instanceof ApiError ? error.envelope.error.message : t('page.configuration.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('page.configuration.title')}
        description={t('page.configuration.description')}
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {t('page.configuration.settingsNote')}{' '}
        <Link className="underline underline-offset-2" to="/settings">
          {t('page.configuration.settingsLink')}
        </Link>
      </p>

      {saveError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('page.configuration.loading')}
        </p>
      ) : loadError !== null ? (
        <Alert variant="destructive">
          <AlertDescription>
            {loadError}{' '}
            <Button type="button" variant="link" className="h-auto p-0" onClick={(): void => void load()}>
              {t('page.configuration.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : view !== null ? (
        <>
          <div className="grid gap-4">
            {view.entities.map((entity) => (
              <EntityCard
                key={entity.entityType}
                entity={entity}
                draft={drafts[entity.entityType] ?? draftOf(entity)}
                onToggleEnabled={(enabled): void => update(entity.entityType, (d) => ({ ...d, enabled, restore: false }))}
                onToggleField={(code, selected): void =>
                  update(entity.entityType, (d) => ({
                    ...d,
                    restore: false,
                    fields: selected
                      ? entity.fields.filter((f) => f.code === code || d.fields.includes(f.code)).map((f) => f.code)
                      : d.fields.filter((c) => c !== code),
                  }))
                }
                onRestore={(): void => update(entity.entityType, () => defaultsOf(entity))}
              />
            ))}
          </div>
          <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-2 border-t bg-background py-4">
            {/* "Saved" beside Save, mounted before it has text (issue #1499, DEC-12 a). */}
            <InlineStatus className="mr-2">{saved ? t('page.configuration.saved') : null}</InlineStatus>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={(): void => {
                setSaved(false);
                adopt(view);
              }}
            >
              {t('page.configuration.discard')}
            </Button>
            <Button type="button" disabled={!dirty || invalid || saving} aria-busy={saving} onClick={(): void => void save()}>
              {saving ? t('page.configuration.saving') : t('page.configuration.save')}
            </Button>
          </div>
        </>
      ) : null}

      {conflict ? (
        <ModalDialog
          title={t('page.configuration.conflict.title')}
          onClose={(): void => setConflict(false)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={(): void => setConflict(false)}>
                {t('page.configuration.conflict.keepEditing')}
              </Button>
              <Button
                type="button"
                onClick={(): void => {
                  setConflict(false);
                  void load();
                }}
              >
                {t('page.configuration.conflict.reload')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('page.configuration.conflict.body')}</p>
        </ModalDialog>
      ) : null}
    </>
  );
}

function EntityCard(props: {
  entity: AdminSearchConfigurationEntityView;
  draft: Draft;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleField: (code: string, selected: boolean) => void;
  onRestore: () => void;
}): ReactNode {
  const { entity, draft } = props;
  const t = useTranslation('admin_search');
  const id = useId();
  const errorId = `${id}-error`;
  const missingField = draft.enabled && draft.fields.length === 0;
  const atDefaults = sameSelection(draft, defaultsOf(entity));
  return (
    <Card data-testid={`configuration-${entity.entityType}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{entity.label}</CardTitle>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-enabled`}
            checked={draft.enabled}
            onChange={(event): void => props.onToggleEnabled(event.target.checked)}
          />
          <Label htmlFor={`${id}-enabled`}>{t('page.configuration.include')}</Label>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset
          aria-invalid={missingField || undefined}
          aria-describedby={missingField ? errorId : undefined}
          className="grid gap-2 sm:grid-cols-2"
        >
          <legend className="sr-only">{t('page.configuration.fieldsLegend', { label: entity.label })}</legend>
          {entity.fields.map((field) => (
            <div key={field.code} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${field.code}`}
                checked={draft.fields.includes(field.code)}
                onChange={(event): void => props.onToggleField(field.code, event.target.checked)}
              />
              <Label htmlFor={`${id}-${field.code}`} className="font-normal">
                {field.label}
                {field.defaultSelected ? (
                  <span className="ml-1 text-xs text-muted-foreground">({t('page.configuration.default')})</span>
                ) : null}
              </Label>
            </div>
          ))}
        </fieldset>
        {missingField ? (
          <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
            {t('page.configuration.atLeastOneField')}
          </p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={atDefaults && draft.restore === entity.customized}
          onClick={props.onRestore}
        >
          <RotateCcw aria-hidden="true" />
          {t('page.configuration.restoreDefaults')}
        </Button>
      </CardContent>
    </Card>
  );
}

export default GlobalSearchConfigurationPage;

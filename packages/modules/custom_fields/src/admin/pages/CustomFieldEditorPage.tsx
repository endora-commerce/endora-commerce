import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, DetailSkeleton, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  SupportedEntityType,
} from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { DefinitionEditor, type SavedDefinition } from '../components/DefinitionEditor.js';
import {
  DEFAULT_ENTITY_TYPE,
  ENTITY_TYPE_PARAM,
  FALLBACK_ENTITY_TYPES,
  entityTypeFromQuery,
  listPath,
  type SavedFieldState,
} from '../lib/routes.js';

/** What the page read before it can offer the form: every read settles, failed or not. */
interface Loaded {
  entityTypes: CustomFieldEntityTypeInfo[];
  /** Every definition of every type, for the carry checks and the taken-key check; `null` when that read failed. */
  definitions: CustomFieldDefinitionDto[] | null;
  /** The definition edited; `null` on `/custom-fields/new`. */
  definition: CustomFieldDefinitionDto | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; loaded: Loaded }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

/**
 * The record type a new field starts on: the one the list showed (the
 * `entityType` query) when this module manages it, else the default, else the
 * first type a field can be created for.
 */
function startingType(query: string | null, entityTypes: readonly CustomFieldEntityTypeInfo[]): SupportedEntityType {
  const creatable = entityTypes.filter((info) => !info.managedBy);
  const asked = entityTypeFromQuery(query, creatable);
  if (asked !== null) return asked;
  if (creatable.some((info) => info.entityType === DEFAULT_ENTITY_TYPE)) return DEFAULT_ENTITY_TYPE;
  return creatable[0]?.entityType ?? DEFAULT_ENTITY_TYPE;
}

/**
 * `/custom-fields/new` and `/custom-fields/:id` — the definition editor on its
 * own route (issue #1804, the kit README's five-field rule). Deep-linkable: the
 * page reads what it needs itself — the entity types, every definition (for the
 * carry warnings and the taken-key check) and, on edit, the definition — and
 * shows the kit's skeleton until those reads settle, a load error with *Retry*,
 * or a field that no longer exists, each with the header's way back.
 *
 * A save returns to the list on the field's record type and hands it the row
 * to focus and the sentence to announce (`SavedFieldState`).
 */
export function CustomFieldEditorPage(): ReactNode {
  const t = useTranslation('custom_fields');
  const tc = useTranslation('core');
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  const [searchParams] = useSearchParams();
  const queryType = searchParams.get(ENTITY_TYPE_PARAM);
  const navigate = useNavigate();
  const canWrite = useAuth().hasPermission('custom_fields:write');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [allLoading, setAllLoading] = useState(false);
  const sequence = useRef(0);
  // Read through a ref: a new translator (the bundle arriving) must not read
  // the page again, which would remount the form under what is being typed.
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setState({ kind: 'loading' });
    const [entityTypes, definitions, definition] = await Promise.all([
      // The static fallback keeps the page usable; the definitions read still works.
      customFieldsClient.listEntityTypes().catch(() => FALLBACK_ENTITY_TYPES),
      customFieldsClient.list().catch(() => null),
      isNew
        ? Promise.resolve<CustomFieldDefinitionDto | null | ApiError | Error>(null)
        : customFieldsClient.get(id).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
    ]);
    if (current !== sequence.current) return;
    if (definition instanceof ApiError && definition.status === 404) {
      setState({ kind: 'not-found' });
      return;
    }
    if (definition instanceof Error) {
      setState({
        kind: 'error',
        message: definition instanceof ApiError ? definition.envelope.error.message : tRef.current('customFields.error.load'),
      });
      return;
    }
    setState({ kind: 'ready', loaded: { entityTypes, definitions, definition } });
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The carry checks' own retry: only every type's definitions are read again. */
  const retryDefinitions = async (): Promise<void> => {
    setAllLoading(true);
    try {
      const definitions = await customFieldsClient.list();
      setState((previous) =>
        previous.kind === 'ready' ? { kind: 'ready', loaded: { ...previous.loaded, definitions } } : previous,
      );
    } catch {
      // The warning stays; its Retry stays offered.
    } finally {
      setAllLoading(false);
    }
  };

  const back = { label: t('customFields.title'), to: listPath(startingType(queryType, FALLBACK_ENTITY_TYPES)) };
  const loadingTitle = isNew ? t('customFields.form.createTitle') : t('customFields.editor.titlePending');

  if (state.kind === 'loading') {
    return (
      <>
        <PageHeader back={back} title={loadingTitle} />
        <DetailSkeleton tabs={false} rows={6} />
      </>
    );
  }
  if (state.kind === 'not-found' || state.kind === 'error') {
    return (
      <>
        <PageHeader back={back} title={loadingTitle} />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="break-words">
              {state.kind === 'error' ? state.message : t('customFields.editor.notFound')}
            </span>
            {state.kind === 'error' ? (
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={(): void => void load()}>
                {tc('common.action.retry')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const { entityTypes, definitions, definition } = state.loaded;
  const known = definitions ?? (definition ? [definition] : []);
  const offersCarry = entityTypes.some((info) => (info.carryTargets ?? []).length > 0);
  const entityTypeInfo = definition
    ? (entityTypes.find((info) => info.entityType === definition.entityType) ?? {
        entityType: definition.entityType,
        labelKey: `customFields.entity.${definition.entityType}`,
        listFilter: false,
        carryTargets: [],
        customerInputSurfaces: [],
      })
    : null;
  const managedBy = entityTypeInfo?.managedBy;
  const readOnly = !canWrite || managedBy !== undefined;

  const done = (saved: SavedDefinition): void => {
    const handoff: SavedFieldState = { customFieldSaved: { id: saved.id, key: saved.key, created: isNew } };
    // Replaced, so Back from the list does not return to a form that was just sent.
    void navigate(listPath(saved.entityType), { replace: true, state: handoff });
  };

  const notice = (
    <>
      {managedBy ? (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('customFields.managedBy.notice')}</span>
            <Link to={managedBy.route} className="font-medium underline underline-offset-4">
              {t(managedBy.labelKey)}
            </Link>
          </AlertDescription>
        </Alert>
      ) : !canWrite ? (
        <Alert className="mb-4">
          <AlertDescription>{t('customFields.editor.readOnly')}</AlertDescription>
        </Alert>
      ) : null}
      {offersCarry && definitions === null && !readOnly ? (
        <Alert variant="warning" live="polite" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="break-words">{t('customFields.carry.checksUnavailable')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={allLoading}
              aria-busy={allLoading}
              onClick={(): void => void retryDefinitions()}
            >
              {t('customFields.carry.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );

  if (definition && entityTypeInfo) {
    return (
      <DefinitionEditor
        key={definition.id}
        definition={definition}
        entityTypeInfo={entityTypeInfo}
        entityTypes={entityTypes}
        definitions={known}
        readOnly={readOnly}
        notice={notice}
        onCancel={(): void => void navigate(listPath(definition.entityType))}
        onSaved={done}
      />
    );
  }
  const entityType = startingType(queryType, entityTypes);
  return (
    <DefinitionEditor
      key="new"
      mode="create"
      entityType={entityType}
      sortOrderFor={(type): number => known.filter((candidate) => candidate.entityType === type).length}
      entityTypes={entityTypes}
      definitions={known}
      notice={notice}
      onCancel={(): void => void navigate(listPath(entityType))}
      onSaved={done}
    />
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default CustomFieldEditorPage;

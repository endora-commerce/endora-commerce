import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ListPlus, Plus, TriangleAlert } from 'lucide-react';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { CarryDriftDialog, CarryDriftSentence } from '../components/CarryDriftWarning.js';
import { AUDIENCES } from '../components/DefinitionForm.js';
import { carryCounterpartsBrokenBy, type CarryCounterpart, type DefinitionChange } from '../lib/carry-drift.js';
import { entityTypeLabelKey, incompatibilitySentence, refusalSentence } from '../lib/carry-labels.js';
import {
  DEFAULT_ENTITY_TYPE,
  ENTITY_TYPE_PARAM,
  FALLBACK_ENTITY_TYPES,
  editPath,
  newPath,
  savedFieldFrom,
} from '../lib/routes.js';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  EmptyState,
  InlineStatus,
  Label,
  Select,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  StatusChangeControl,
  resolveCustomFieldLabel,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  assessCustomFieldCarry,
  type CustomFieldAudience,
  type CustomFieldDefinitionDto,
  type CustomFieldEntityTypeInfo,
  type SupportedEntityType,
} from '@endora-commerce/contracts';

/** A row's identity, for the focus that follows a deletion; module-level so it is stable. */
const definitionId = (definition: CustomFieldDefinitionDto): string => definition.id;

/** A change from the table waiting on the drift warning's answer (feature 162). */
interface PendingTableChange {
  change: DefinitionChange;
  counterparts: CarryCounterpart[];
  /** The deleted field's sentence above the warning; none for an audience change. */
  lead?: string;
  proceed: () => void;
}

/**
 * Custom-field definition management (feature 055). The definitions of one
 * entity type in a table — the type is the address's `entityType` query; a
 * field is created and edited in the one definition form on its own page,
 * `/custom-fields/new` and `/custom-fields/:id` (issue #1804, the kit README's
 * five-field rule; the form is feature 157's, issue #447). Back from a save,
 * the saved field's link takes the focus and the result is announced beside
 * *New field*.
 * Every write control — create, edit, delete, audience — is offered only to an
 * operator holding `custom_fields:write`; a reader sees the table.
 *
 * Feature 162 (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md`
 * §1): the *Carry value to …* options, a *Carries to* column whose chips are
 * marked *Incompatible* when the same-key target no longer fits, and a warning
 * before an audience change or a deletion that breaks an enabled carry. Both
 * read the definitions of **every** type — a second, unfiltered list, asked
 * only once some type offers a carry target.
 *
 * The frame is the kit `ListPage` (issue #1749, DS-05): *New field* in the
 * header (a link to the create page), the record-type select as the toolbar,
 * the announced count, the kit skeleton and Retry. A row's Edit and Delete are its `RowActionMenu`, Delete
 * last and confirmed once — in the kit dialog, or in the drift warning when it
 * breaks a carry. The audience is a `StatusChangeControl` (README *A value
 * edited from the row*), whose confirm step carries the drift warning.
 */
export function CustomFieldsPage(): ReactNode {
  // One namespace, this module's own (feature 091, R8). The screen used to
  // read `customFields.title` and `customFields.description` out of the shared
  // `core` bundle beside four keys of its own; both were already written in
  // this module's `i18n/{en,pl}.json`, so the `core` reader was a second copy
  // of two strings and nothing else. `customFields.title` and
  // `customFields.save` stay in `_i18n` because
  // `@endora-commerce/admin-kit`'s `CustomFieldValuesPanel` renders them, and a
  // kit component reads the shared namespace by construction.
  const t = useTranslation('custom_fields');
  const { language } = useTranslationContext();
  const canWrite = useAuth().hasPermission('custom_fields:write');
  const [entityTypes, setEntityTypes] = useState<CustomFieldEntityTypeInfo[]>(
    FALLBACK_ENTITY_TYPES,
  );
  // The record type is the address's (issue #1804), so the editor's way back
  // and a shared link land on the type they were about.
  const [searchParams, setSearchParams] = useSearchParams();
  const entityType = (searchParams.get(ENTITY_TYPE_PARAM) || DEFAULT_ENTITY_TYPE) as SupportedEntityType;
  const setEntityType = useCallback(
    (next: SupportedEntityType): void =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.set(ENTITY_TYPE_PARAM, next);
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const navigate = useNavigate();
  const location = useLocation();
  /** A save on the editor page: the sentence beside *New field*, and the row that takes the focus. */
  const status = useInlineStatus();
  const [arrived] = useState(() => savedFieldFrom(location.state));
  const rowLinks = useRef(new Map<string, HTMLAnchorElement>());
  const [rows, setRows] = useState<CustomFieldDefinitionDto[]>([]);
  /** The record type the rows on screen belong to; another one means its read is still on the way. */
  const [loadedFor, setLoadedFor] = useState<SupportedEntityType | null>(null);
  /** The last read of the selected type's definitions failed: the list's own error. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A read of the selected type is in flight. */
  const [reading, setReading] = useState(false);
  /** A write from the table failed; the rows are still valid, so it is a notice above them. */
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const currentEntityType = useRef(entityType);
  currentEntityType.current = entityType;

  // Host-managed marker for the selected type (feature 061): definitions are
  // rendered read-only with a link to the owning module's surface.
  const entityTypeInfo = entityTypes.find((i) => i.entityType === entityType);
  const managedBy = entityTypeInfo?.managedBy;
  const editable = canWrite && !managedBy;

  // Feature 162 — every type's definitions, for the carry marks and warnings.
  // `null` until read (or when the read failed): no mark is shown on a guess.
  const offersCarry = entityTypes.some((info) => (info.carryTargets ?? []).length > 0);
  const [allDefinitions, setAllDefinitions] = useState<CustomFieldDefinitionDto[] | null>(null);
  /**
   * The last read of every type's definitions failed. The marks and the drift
   * warnings then know only the selected type's rows, so the page says the
   * checks are off rather than letting a change pass silently unchecked.
   */
  const [allFailed, setAllFailed] = useState(false);
  const [allLoading, setAllLoading] = useState(false);
  const allSequence = useRef(0);
  const [pendingChange, setPendingChange] = useState<PendingTableChange | null>(null);

  const loadAll = useCallback(async (): Promise<void> => {
    const current = ++allSequence.current;
    setAllLoading(true);
    try {
      const listed = await customFieldsClient.list();
      if (current !== allSequence.current) return;
      setAllDefinitions(listed);
      setAllFailed(false);
    } catch {
      if (current !== allSequence.current) return;
      setAllDefinitions(null);
      setAllFailed(true);
    } finally {
      if (current === allSequence.current) setAllLoading(false);
    }
  }, []);

  useEffect(() => {
    if (offersCarry) void loadAll();
  }, [offersCarry, loadAll]);

  /** What the page knows of every definition: the full list, the selected type's rows fresher. */
  const known = useMemo(() => {
    const byId = new Map<string, CustomFieldDefinitionDto>();
    for (const definition of allDefinitions ?? []) byId.set(definition.id, definition);
    for (const row of rows) byId.set(row.id, row);
    return [...byId.values()];
  }, [allDefinitions, rows]);

  const typeLabel = useCallback(
    (type: SupportedEntityType): string => t(entityTypeLabelKey(type, entityTypes)),
    [t, entityTypes],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoadError(null);
    setReading(true);
    try {
      const listed = await customFieldsClient.list(entityType);
      // A slower read of a record type no longer selected must not replace the current one.
      if (currentEntityType.current !== entityType) return;
      setRows(listed);
      setLoadedFor(entityType);
    } catch (err) {
      if (currentEntityType.current !== entityType) return;
      setLoadError(err instanceof ApiError ? err.envelope.error.message : t('customFields.error.load'));
    } finally {
      if (currentEntityType.current === entityType) setReading(false);
    }
  }, [entityType, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        setEntityTypes(await customFieldsClient.listEntityTypes());
      } catch {
        // Keep the static fallback; the definitions list still works.
      }
    })();
  }, []);

  /** The table's rows and, where carries exist, every type's definitions. */
  const reload = useCallback(async (): Promise<void> => {
    await Promise.all([refresh(), offersCarry ? loadAll() : Promise.resolve()]);
  }, [refresh, offersCarry, loadAll]);

  /** A write's refusal, as a sentence: a carry refusal is built from `details` (feature 162). */
  const writeError = useCallback(
    (err: unknown): string => refusalSentence(t, err, typeLabel, t('customFields.error.action')),
    [t, typeLabel],
  );

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setActionError(null);
      try {
        await fn();
        await reload();
      } catch (err) {
        setActionError(writeError(err));
      }
    },
    [reload, writeError],
  );

  const ready = loadedFor === entityType && loadError === null;
  const removalFocus = useRemovalFocus(rows, definitionId, ready);

  /**
   * Back from the editor page with a save (issue #1804): once its type's rows
   * are on screen, the saved field's link takes the focus and the sentence is
   * announced beside *New field*. The history entry's hand-off is dropped
   * at once, so a reload of the list neither refocuses nor repeats it.
   */
  const settledArrival = useRef(false);
  useEffect(() => {
    if (arrived === null || settledArrival.current || !ready) return;
    settledArrival.current = true;
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    const shown = rows.find((row) => row.id === arrived.id);
    const name = shown ? resolveCustomFieldLabel(shown.label, shown.labelDefault, language) : arrived.key;
    status.show(t(arrived.created ? 'customFields.saved.created' : 'customFields.saved.updated', { label: name }));
    rowLinks.current.get(arrived.id)?.focus();
  }, [arrived, ready, rows, navigate, location.pathname, location.search, language, status, t]);
  /** The row menu's trigger is the row's focus target once a neighbour is deleted. */
  const rowMenuRef =
    (d: CustomFieldDefinitionDto) =>
    (element: HTMLDivElement | null): void =>
      removalFocus.targetRef(d)(element?.querySelector('button') ?? null);

  /**
   * Delete, asked once: in the drift warning when the deletion breaks an
   * enabled carry, in the kit confirmation otherwise, which runs the request
   * and keeps itself open with the reason when it is refused.
   */
  const askDelete = (d: CustomFieldDefinitionDto): void => {
    const question = t('customFields.table.deleteConfirm', { key: d.key });
    const counterparts = carryCounterpartsBrokenBy({ kind: 'delete', definitionId: d.id }, known);
    if (counterparts.length > 0) {
      setPendingChange({
        change: { kind: 'delete', definitionId: d.id },
        counterparts,
        lead: question,
        proceed: () => void run(() => customFieldsClient.remove(d.id)),
      });
      return;
    }
    void confirm({
      message: question,
      confirmLabel: t('customFields.table.deleteAction'),
      destructive: true,
      action: () => customFieldsClient.remove(d.id),
      describeError: writeError,
      returnFocusTo: removalFocus.returnFocusTo(d),
    }).then((deleted) => {
      if (!deleted) return;
      // In place, not a reload: a reload would unmount the row that just took the focus.
      setRows((current) => current.filter((row) => row.id !== d.id));
      if (offersCarry) void loadAll();
    });
  };

  /**
   * What an audience change breaks, said on the control's confirm step — the
   * one question it asks, so the drift warning is never a second one. Phrasing
   * content only: the control renders it inside its summary sentence.
   */
  const audienceConsequence = (d: CustomFieldDefinitionDto, to: string): ReactNode => {
    const counterparts = carryCounterpartsBrokenBy(
      { kind: 'audience', definitionId: d.id, audience: to as CustomFieldAudience },
      known,
    );
    return counterparts.length === 0 ? null : <CarryDriftSentence counterparts={counterparts} typeLabel={typeLabel} />;
  };

  const columns: ResponsiveColumn<CustomFieldDefinitionDto>[] = [
    {
      id: 'key',
      header: t('customFields.table.key'),
      primary: true,
      className: 'font-mono text-xs',
      render: (d) => d.key,
    },
    {
      id: 'label',
      header: t('customFields.table.label'),
      primary: true,
      // Feature 175 (FR-035, FR-036) — every definition is listed, whatever its
      // admin access; the badges say which ones a buyer fills in at
      // registration and which ones the admin panel does not offer for editing.
      render: (d) => {
        // The record's name is the link to it (README *List pages*); the editor
        // shows a reader or a managed type the field without offering it.
        const label = (
          <Link
            to={editPath(d.id)}
            ref={(element): void => {
              if (element === null) rowLinks.current.delete(d.id);
              else rowLinks.current.set(d.id, element);
            }}
            className="min-w-0 break-words font-medium underline-offset-4 hover:underline"
          >
            {resolveCustomFieldLabel(d.label, d.labelDefault, language)}
          </Link>
        );
        const access = d.adminAccess ?? 'edit';
        const collected = (d.customerInput ?? []).length > 0;
        if (!collected && access === 'edit') return label;
        return (
          <span className="flex flex-wrap items-center gap-1">
            {label}
            {collected ? <Badge variant="secondary">{t('customFields.badge.registration')}</Badge> : null}
            {access !== 'edit' ? <Badge variant="outline">{t(`customFields.badge.${access}`)}</Badge> : null}
          </span>
        );
      },
    },
    { id: 'type', header: t('customFields.table.type'), render: (d) => t(`customFields.valueType.${d.valueType}`) },
    {
      id: 'required',
      header: t('customFields.table.required'),
      render: (d) => (
        <Badge variant={d.required ? 'default' : 'secondary'}>
          {d.required ? t('customFields.required.yes') : t('customFields.required.no')}
        </Badge>
      ),
    },
    {
      id: 'audience',
      header: t('customFields.audience.column'),
      render: (d) =>
        managedBy ? (
          '—'
        ) : !canWrite ? (
          t(`customFields.audience.${d.audience}`)
        ) : (
          <StatusChangeControl
            label={t('customFields.audience.rowLabel', { key: d.key })}
            dialogTitle={t('customFields.audience.rowLabel', { key: d.key })}
            labelVisuallyHidden
            current={d.audience}
            currentLabel={t(`customFields.audience.${d.audience}`)}
            options={AUDIENCES.map((a) => ({ value: a, label: t(`customFields.audience.${a}`) }))}
            consequence={(to) => audienceConsequence(d, to)}
            errorMessage={writeError}
            onConfirm={async (to) => {
              await customFieldsClient.update(d.id, { audience: to as CustomFieldAudience });
              await reload();
            }}
          />
        ),
    },
    {
      id: 'options',
      header: t('customFields.table.options'),
      hideOnMobile: true,
      className: 'text-xs',
      render: (d) => d.options.map((o) => o.value).join(', ') || '—',
    },
    {
      id: 'listFilter',
      header: t('customFields.table.listFilter'),
      render: (d) => (d.listFilter ? t('customFields.listFilter.yes') : t('customFields.listFilter.no')),
    },
    {
      id: 'carriesTo',
      header: t('customFields.table.carriesTo'),
      render: (d) => carryChips(d),
    },
  ];

  /**
   * One chip per carry target, and an *Incompatible* mark with its reason
   * where the same-key target no longer fits (FR-020). The reason is visible
   * text under the chip at every width — never a hover-only `title` — and is
   * read once, as the text it is.
   */
  function carryChips(d: CustomFieldDefinitionDto): ReactNode {
    const targets = d.carryTo ?? [];
    if (targets.length === 0) return '—';
    return (
      <ul className="flex flex-col gap-1">
        {targets.map((target) => {
          const entityType = typeLabel(target);
          const reasons =
            allDefinitions === null
              ? []
              : assessCustomFieldCarry(
                  d,
                  known.find((candidate) => candidate.entityType === target && candidate.key === d.key) ?? null,
                );
          const reason = reasons.map((item) => incompatibilitySentence(t, item, entityType, d.key)).join(' ');
          return (
            <li key={target} className="min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary">{entityType}</Badge>
                {reasons.length > 0 ? (
                  <Badge variant="warning" className="gap-1">
                    <TriangleAlert className="size-3" aria-hidden="true" />
                    {t('customFields.carry.incompatible')}
                  </Badge>
                ) : null}
              </span>
              {reasons.length > 0 ? (
                <span className="block break-words text-xs text-muted-foreground">{reason}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const actions = (d: CustomFieldDefinitionDto): ReactNode => (
    <div ref={rowMenuRef(d)}>
      <RowActionMenu label={t('customFields.table.actions', { key: d.key })}>
        <RowActionMenuItem onSelect={() => void navigate(editPath(d.id))}>{t('customFields.table.edit')}</RowActionMenuItem>
        <RowActionMenuSeparator />
        <RowActionMenuItem destructive onSelect={() => askDelete(d)}>
          {t('customFields.table.deleteAction')}
        </RowActionMenuItem>
      </RowActionMenu>
    </div>
  );

  const load: ListPageLoad =
    loadError !== null
      ? { kind: 'error', message: loadError }
      : loadedFor !== entityType
        ? { kind: 'loading' }
        : { kind: 'ready' };

  return (
    <>
      <ListPage
        title={t('customFields.title')}
        description={t('customFields.description')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {/* Mounted before it has text, so the editor's result is announced (WCAG 4.1.3). */}
            <InlineStatus {...status.props} />
            {editable ? (
              <Button asChild className="min-h-11 sm:min-h-9">
                <Link
                  to={newPath(entityType)}
                  ref={(element) => {
                    removalFocus.createRef.current = element;
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t('customFields.form.newField')}
                </Link>
              </Button>
            ) : null}
          </div>
        }
        toolbar={
          <div className="space-y-1">
            <Label htmlFor="entity">{t('customFields.form.entity')}</Label>
            <Select id="entity" value={entityType} onChange={(e) => setEntityType(e.target.value as SupportedEntityType)}>
              {entityTypes.map((info) => (
                <option key={info.entityType} value={info.entityType}>
                  {t(info.labelKey)}
                </option>
              ))}
            </Select>
          </div>
        }
        count={t('customFields.table.count', { count: rows.length })}
        notice={
          <>
            {managedBy ? (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>{t('customFields.managedBy.notice')}</span>
                  <Link to={managedBy.route} className="font-medium underline underline-offset-4">
                    {t(managedBy.labelKey)}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
            {offersCarry && allFailed ? (
              <Alert variant="warning" live="polite">
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span className="break-words">{t('customFields.carry.checksUnavailable')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    disabled={allLoading}
                    aria-busy={allLoading}
                    onClick={(): void => void loadAll()}
                  >
                    {t('customFields.carry.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {actionError ? (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
          </>
        }
        load={load}
        busy={reading && loadedFor === entityType}
        onRetry={(): void => void reload()}
        // The definitions endpoint answers a type's whole, bounded list: there is nothing to page.
        pagination={null}
      >
        <ResponsiveTable
          label={t('customFields.table.title')}
          data={rows}
          columns={columns}
          keyExtractor={definitionId}
          {...(editable ? { renderActions: actions } : {})}
          emptyState={
            <EmptyState
              icon={<ListPlus size={20} />}
              title={t('customFields.table.empty')}
              action={
                editable ? (
                  <Button asChild className="min-h-11 sm:min-h-9" variant="outline">
                    <Link to={newPath(entityType)}>{t('customFields.table.emptyAction')}</Link>
                  </Button>
                ) : null
              }
            />
          }
        />
      </ListPage>

      {pendingChange ? (
        <CarryDriftDialog
          counterparts={pendingChange.counterparts}
          typeLabel={typeLabel}
          {...(pendingChange.lead ? { lead: pendingChange.lead } : {})}
          action={pendingChange.change.kind}
          onCancel={() => setPendingChange(null)}
          onProceed={() => {
            setPendingChange(null);
            pendingChange.proceed();
          }}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CustomFieldsPage;

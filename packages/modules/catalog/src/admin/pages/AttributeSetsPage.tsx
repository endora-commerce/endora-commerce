import { useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Layers, Plus } from 'lucide-react';
import type { AttributeSet, AttributeSetDetail } from '@endora-commerce/contracts';
import {
  ImmediateBadge,
  ListPage,
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, EmptyState, InlineStatus, Input, Label, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { valueTypeLabelKey, type ValueType } from '../lib/attribute-list.js';
import { pickLocalized } from '../lib/scope-overview.js';

interface AdminAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  valueType: string;
}

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.envelope.error.message : fallback;

const rowId = (set: AttributeSet): string => set.id;

/**
 * Admin Attribute Sets manager (T030 + T031, feature 002): the list of sets,
 * creating custom ones, managing a set's assigned attributes, and deleting
 * non-system sets that no product uses.
 *
 * UX audit slice S6 (#1439 DS-05, #1441 DS-07, #1448 DS-15): the kit's
 * `ListPage` — the list first, *New attribute set* as the header's one primary
 * opening a dialog instead of a create card above the list, a set's actions in
 * its row's "…" menu instead of an outline *Manage* beside a filled red
 * *Delete*, the attributes managed in a dialog rather than a row expanded
 * inside the table, and an `EmptyState` whose one action is *New attribute set*.
 * Results are said beside *New attribute set* (#1499, DEC-12 a), not in a
 * banner above the page.
 */
export function AttributeSetsPage(): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [sets, setSets] = useState<AttributeSet[]>([]);
  const [allAttributes, setAllAttributes] = useState<AdminAttribute[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<AttributeSet | null>(null);
  const status = useInlineStatus();
  const { show: showStatus, clear: clearStatus } = status;
  const removalFocus = useRemovalFocus(sets, rowId, load.kind === 'ready');

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const [setsRes, attrsRes] = await Promise.all([
        apiClient.get<{ data: AttributeSet[] }>('/api/v1/admin/catalog/attribute-sets'),
        apiClient.get<{ data: AdminAttribute[] }>('/api/v1/admin/catalog/attributes'),
      ]);
      setSets(setsRes.data);
      setAllAttributes(attrsRes.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: messageOf(err, t('attributeSets.error.load')) });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = useCallback((): void => {
    clearStatus();
    setError(null);
    setCreating(true);
  }, [clearStatus]);

  const handleCreated = useCallback(
    (code: string): void => {
      setCreating(false);
      showStatus(t('attributeSets.success.create', { name: code }));
      void refresh();
    },
    [refresh, showStatus, t],
  );

  const handleDelete = useCallback(
    async (set: AttributeSet): Promise<void> => {
      clearStatus();
      setError(null);
      // The request runs inside the dialog: a refusal stays there, beside Retry and Cancel.
      const ok = await confirm({
        message: t('attributeSets.deleteConfirm', { code: set.code }),
        confirmLabel: tc('common.action.delete'),
        destructive: true,
        action: () => apiClient.delete<void>(`/api/v1/admin/catalog/attribute-sets/${set.id}`),
        describeError: (err) => messageOf(err, t('attributeSets.error.delete')),
        // The menu goes with the row: focus moves to a neighbour, or to *New …* when none is left.
        returnFocusTo: removalFocus.returnFocusTo(set),
      });
      if (!ok) return;
      showStatus(t('attributeSets.success.delete', { code: set.code }));
      await refresh();
    },
    [confirm, clearStatus, refresh, removalFocus, showStatus, t, tc],
  );

  const nameOf = useCallback(
    (set: AttributeSet): string => pickLocalized(set.name, language) || set.code,
    [language],
  );

  const newButton = (
    <Button
      ref={(element): void => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      onClick={openCreate}
    >
      <Plus aria-hidden="true" />
      {t('attributeSets.action.new')}
    </Button>
  );
  // While the list is empty the empty state's *New …* is the one primary (Von Restorff).
  const nothingYet = load.kind === 'ready' && sets.length === 0;

  const columns: ResponsiveColumn<AttributeSet>[] = [
    {
      id: 'code',
      header: t('attributeSets.column.code'),
      primary: true,
      render: (set) => (
        <code ref={removalFocus.targetRef(set)} tabIndex={-1} className="font-mono text-sm">
          {set.code}
        </code>
      ),
      meta: (set) => nameOf(set),
    },
    {
      id: 'name',
      header: t('attributeSets.column.name'),
      hideOnMobile: true,
      render: (set) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {nameOf(set)}
          {set.isSystem ? <Badge variant="secondary">{t('attributeSets.badge.system')}</Badge> : null}
        </span>
      ),
    },
    { id: 'attributes', header: t('attributeSets.column.attributes'), render: (set) => set.attributeCount },
    { id: 'products', header: t('attributeSets.column.products'), render: (set) => set.productCount },
  ];

  const deleteHint = (set: AttributeSet): string | undefined =>
    set.isSystem
      ? t('attributeSets.deleteHint.system')
      : set.productCount > 0
        ? t('attributeSets.deleteHint.hasProducts')
        : undefined;

  return (
    <>
      <ListPage
        title={t('attributeSets.page.title')}
        description={t('attributeSets.page.description')}
        actions={
          <div className="flex items-center gap-3">
            <InlineStatus {...status.props} />
            {canWrite && !nothingYet ? newButton : null}
          </div>
        }
        count={t('attributeSets.count', { count: String(sets.length) })}
        notice={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          columns={columns}
          data={sets}
          keyExtractor={rowId}
          emptyState={
            <EmptyState
              icon={<Layers size={20} />}
              title={t('attributeSets.empty')}
              description={canWrite ? t('attributeSets.empty.body') : t('attributeSets.empty.bodyReadOnly')}
              action={canWrite ? newButton : null}
            />
          }
          renderActions={(set): ReactNode => {
            const hint = deleteHint(set);
            return (
              <RowActionMenu label={t('attributeSets.rowActions', { code: set.code })}>
                <RowActionMenuItem
                  onSelect={(): void => {
                    clearStatus();
                    setManaging(set);
                  }}
                >
                  {canWrite ? t('attributeSets.action.manage') : t('attributeSets.action.view')}
                </RowActionMenuItem>
                {canWrite ? (
                  <>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem
                      destructive
                      disabled={hint !== undefined}
                      title={hint}
                      onSelect={(): void => void handleDelete(set)}
                    >
                      {t('attributeSets.action.delete')}
                    </RowActionMenuItem>
                  </>
                ) : null}
              </RowActionMenu>
            );
          }}
        />
      </ListPage>
      {creating ? (
        <CreateAttributeSetDialog onClose={(): void => setCreating(false)} onCreated={handleCreated} />
      ) : null}
      {managing ? (
        <ManageAttributesDialog
          set={managing}
          allAttributes={allAttributes}
          canWrite={canWrite}
          onClose={(changed): void => {
            setManaging(null);
            // The list's attribute counts follow what the dialog changed.
            if (changed) void refresh();
          }}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

/**
 * Three fields, so a dialog rather than a route (the kit README's list-page
 * rule). A refusal keeps it open with the server's message and what was typed.
 */
function CreateAttributeSetDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (code: string) => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const formId = useId();
  const [code, setCode] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelPl, setLabelPl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    const name: Record<string, string> = {};
    if (labelEn) name['en-US'] = labelEn;
    if (labelPl) name['pl-PL'] = labelPl;
    if (!code || Object.keys(name).length === 0) {
      setError(t('attributeSets.create.validationError'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post<{ data: AttributeSetDetail }>('/api/v1/admin/catalog/attribute-sets', {
        code,
        name,
      });
      onCreated(res.data.code);
    } catch (err) {
      setError(messageOf(err, t('attributeSets.error.create')));
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      title={t('attributeSets.create.title')}
      onClose={onClose}
      busy={submitting}
      // A stray click must not throw away what was typed.
      dismissOnScrim={false}
      footer={
        <>
          <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {tc('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={submitting} aria-busy={submitting || undefined}>
            {t('attributeSets.create.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" onSubmit={(e): void => void handleSubmit(e)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${formId}-code`}>{t('attributeSets.field.code')}</Label>
          <Input
            id={`${formId}-code`}
            placeholder={t('attributeSets.field.codePlaceholder')}
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            pattern="[a-z0-9_]+"
            title={t('attributeSets.field.codeTitle')}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-name-en`}>{t('attributeSets.field.nameEn')}</Label>
          <Input id={`${formId}-name-en`} value={labelEn} onChange={(e): void => setLabelEn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-name-pl`}>{t('attributeSets.field.namePl')}</Label>
          <Input id={`${formId}-name-pl`} value={labelPl} onChange={(e): void => setLabelPl(e.target.value)} />
        </div>
      </form>
    </ModalDialog>
  );
}

// ---------------------------------------------------------------------------
// Manage dialog
// ---------------------------------------------------------------------------

/**
 * A set's assigned attributes and the ones it can still take. Each assign and
 * remove is its own request, so the dialog carries the *Applies immediately*
 * badge and has no Save — only Close. Results are said inside the dialog, where
 * they were asked for. Without `catalog:write` it lists the attributes only.
 */
function ManageAttributesDialog({
  set,
  allAttributes,
  canWrite,
  onClose,
}: {
  set: AttributeSet;
  allAttributes: AdminAttribute[];
  canWrite: boolean;
  onClose: (changed: boolean) => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const [detail, setDetail] = useState<AttributeSetDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const changed = useRef(false);
  const status = useInlineStatus();
  const { show: showStatus, clear: clearStatus } = status;

  const loadDetail = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: AttributeSetDetail }>(`/api/v1/admin/catalog/attribute-sets/${set.id}`);
      setDetail(res.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(messageOf(err, t('attributeSets.error.loadDetail')));
    }
  }, [set.id, t]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const run = async (attributeId: string, action: () => Promise<void>, fallback: string): Promise<void> => {
    if (pending) return;
    setPending(attributeId);
    clearStatus();
    setError(null);
    try {
      await action();
      changed.current = true;
    } catch (err) {
      setError(messageOf(err, fallback));
    } finally {
      setPending(null);
    }
  };

  const handleAssign = (attributeId: string): Promise<void> =>
    run(
      attributeId,
      async () => {
        const res = await apiClient.post<{ data: AttributeSetDetail }>(
          `/api/v1/admin/catalog/attribute-sets/${set.id}/attributes`,
          { assignments: [{ attributeId }] },
        );
        setDetail(res.data);
        showStatus(t('attributeSets.success.assign', { code: set.code }));
      },
      t('attributeSets.error.assign'),
    );

  const handleUnassign = (attributeId: string): Promise<void> =>
    run(
      attributeId,
      async () => {
        await apiClient.delete<void>(`/api/v1/admin/catalog/attribute-sets/${set.id}/attributes/${attributeId}`);
        await loadDetail();
        showStatus(t('attributeSets.success.unassign', { code: set.code }));
      },
      t('attributeSets.error.remove'),
    );

  const assignedIds = new Set(detail?.attributes.map((a) => a.id) ?? []);
  const unassigned = allAttributes.filter((a) => !assignedIds.has(a.id));
  const close = (): void => onClose(changed.current);

  return (
    <ModalDialog
      title={t('attributeSets.manage.title', { code: set.code })}
      onClose={close}
      widthClassName="max-w-2xl"
      footer={
        <Button type="button" variant="outline" onClick={close}>
          {tc('common.action.close')}
        </Button>
      }
    >
      <div className="space-y-6">
        {error || loadError ? (
          <Alert variant="destructive">
            <AlertDescription>{error ?? loadError}</AlertDescription>
          </Alert>
        ) : null}
        <section className="space-y-2" aria-busy={detail === null && loadError === null ? true : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {t('attributeSets.assigned.title')}
              {canWrite ? <ImmediateBadge /> : null}
            </h3>
            <InlineStatus {...status.props} />
          </div>
          {detail === null ? (
            loadError === null ? (
              <p className="text-sm text-muted-foreground">{t('attributeSets.loading')}</p>
            ) : null
          ) : detail.attributes.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {detail.attributes.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{pickLocalized(a.label, language) || a.key}</span>{' '}
                    <code className="font-mono text-xs text-muted-foreground">{a.key}</code>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{t(valueTypeLabelKey(a.valueType as ValueType))}</span>
                    {canWrite ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending !== null}
                        aria-busy={pending === a.id || undefined}
                        aria-label={t('attributeSets.action.removeAttribute', { key: a.key })}
                        onClick={(): void => void handleUnassign(a.id)}
                      >
                        {t('attributeSets.action.remove')}
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('attributeSets.assigned.empty')}</p>
          )}
        </section>

        {canWrite && detail !== null && unassigned.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('attributeSets.add.title')}</h3>
            <div className="flex flex-wrap gap-2">
              {unassigned.map((a) => (
                <Button
                  key={a.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  aria-busy={pending === a.id || undefined}
                  aria-label={t('attributeSets.action.assign', { key: a.key })}
                  onClick={(): void => void handleAssign(a.id)}
                >
                  <Plus aria-hidden="true" />
                  {a.key}
                </Button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </ModalDialog>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default AttributeSetsPage;

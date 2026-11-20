import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import type { TransactionalEmailSummary } from '@endora-commerce/contracts';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, EmptyState, Select, Switch } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import {
  customizationOf,
  emailCustomizationLabels,
  filterEmails,
  moduleOptions,
  ownerModuleLabel,
} from '../lib/labels.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Issue #89 — the per-email operator control; issue #1536 (UX audit
 * CONTENT-19) — drawn as a `Switch`, not a filled "Switch on" button on every
 * inactive row, which made the list's most frequent control its loudest one
 * (Von Restorff). The write takes effect at once, as every control on a list
 * does, so the switch is `busy` while it runs and ignores another press
 * (Doherty), and the state is said in words beside the thumb.
 *
 * Modelled on `platform/ModuleActivationControl`: a protected email renders the
 * control **locked with its reason** rather than absent or silently failing,
 * because the answer to "why can I not switch this off" belongs on screen. The
 * reason is the owning module's own sentence, carried by the API — this app
 * holds no list of protected codes, exactly as the platform screen holds no
 * list of non-deactivatable modules.
 */
function ActivationCell({
  email,
  t,
  canWrite,
  onChanged,
  onError,
}: {
  email: TransactionalEmailSummary;
  t: Translate;
  canWrite: boolean;
  onChanged: (next: TransactionalEmailSummary) => void;
  onError: (message: string) => void;
}): React.ReactElement {
  const [pending, setPending] = useState(false);
  const switchLabel = t('activation.switchLabel', { name: email.name });
  const stateText = email.active ? t('activation.on') : t('activation.off');

  const toggle = useCallback(
    async (next: boolean): Promise<void> => {
      setPending(true);
      try {
        onChanged(await transactionalEmailsClient.setActive(email.code, next));
      } catch (err) {
        const message =
          err instanceof ApiError ? err.envelope.error.message : err instanceof Error ? err.message : String(err);
        onError(t('list.toggleError', { name: email.name, message }));
      } finally {
        setPending(false);
      }
    },
    [email.code, email.name, onChanged, onError, t],
  );

  if (!canWrite) {
    return <Badge variant={email.active ? 'success' : 'secondary'}>{stateText}</Badge>;
  }

  if (!email.deactivatable) {
    const reason = email.nonDeactivatableReason ?? t('activation.locked');
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          {/* Focusable and described by the reason, so it is heard rather than skipped. */}
          <Switch
            checked={email.active}
            onCheckedChange={() => undefined}
            disabledReason={reason}
            aria-label={switchLabel}
          />
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('activation.locked')}
          </span>
        </div>
        {/* The switch already carries the reason as its description; this copy is for the eye. */}
        {email.nonDeactivatableReason ? (
          <p aria-hidden="true" className="max-w-prose text-xs text-muted-foreground">
            {email.nonDeactivatableReason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={email.active}
        busy={pending}
        onCheckedChange={(next) => void toggle(next)}
        aria-label={switchLabel}
      />
      {/* The state is the switch's `aria-checked`; the word is for the eye. */}
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        {stateText}
      </span>
    </div>
  );
}

/**
 * The transactional e-mail list — the kit's `ListPage` (issue #1536, UX audit
 * CONTENT-19). The e-mails are declared by the modules that send them, so there
 * is no "New …" and no row menu: a row opens its editor through its name and
 * switches through its switch. The endpoint answers the whole list, which the
 * installed modules bound: no pager, and the search and the module filter run
 * in the browser.
 */
export function EmailsList(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('transactional_emails');
  const { bundle, fallbackBundle } = useTranslationContext();
  const [items, setItems] = useState<TransactionalEmailSummary[]>([]);
  // Until the first answer the list is unknown, not empty: no empty state may
  // claim either "no e-mails" or "no match" before it arrives (#1448).
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    transactionalEmailsClient
      .list()
      .then((res) => {
        if (!live) return;
        setItems(res.items);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (live) setLoad(err instanceof Error && err.message ? { kind: 'error', message: err.message } : { kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const replace = useCallback((next: TransactionalEmailSummary): void => {
    setToggleError(null);
    setItems((prev) => prev.map((i) => (i.code === next.code ? next : i)));
  }, []);

  // The sending module by its own name, never its id (CONTENT-19, Mental Model).
  const moduleLabel = useCallback(
    (moduleId: string): string => ownerModuleLabel(moduleId, bundle, fallbackBundle),
    [bundle, fallbackBundle],
  );
  const modules = useMemo(() => moduleOptions(items, moduleLabel), [items, moduleLabel]);
  const filtered = useMemo(
    () => filterEmails(items, { q, module: moduleFilter }, moduleLabel),
    [items, q, moduleFilter, moduleLabel],
  );
  const filtersActive = q.trim() !== '' || moduleFilter !== '';
  const clearFilters = useCallback((): void => {
    setQ('');
    setModuleFilter('');
  }, []);

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>{t('editor.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const canWrite = hasPermission('transactional_emails:write');

  const columns: ResponsiveColumn<TransactionalEmailSummary>[] = [
    {
      id: 'name',
      header: t('list.column.name'),
      primary: true,
      render: (e) => (
        <Link
          className="font-medium text-primary hover:underline"
          to={`/transactional-emails/${encodeURIComponent(e.code)}`}
        >
          {e.name}
        </Link>
      ),
      meta: (e) => <code className="text-xs">{e.code}</code>,
    },
    {
      id: 'code',
      header: t('list.column.code'),
      hideOnMobile: true,
      render: (e) => <code className="text-xs">{e.code}</code>,
    },
    {
      id: 'module',
      header: t('list.column.module'),
      render: (e) => moduleLabel(e.ownerModule),
    },
    {
      id: 'customized',
      header: t('list.column.customized'),
      render: (e) => {
        const state = customizationOf(e);
        const label = emailCustomizationLabels.label(t, state);
        // Default content is the quiet case; a customisation is what to notice.
        return state === 'default' ? (
          <span className="text-muted-foreground">{label}</span>
        ) : (
          <Badge variant="outline">{label}</Badge>
        );
      },
    },
    {
      id: 'activation',
      header: t('activation.column'),
      render: (e) => (
        <ActivationCell email={e} t={t} canWrite={canWrite} onChanged={replace} onError={setToggleError} />
      ),
    },
  ];

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('page.title')}
        load={load}
        onRetry={() => setReloadKey((key) => key + 1)}
        count={t('list.count', { count: filtered.length })}
        toolbar={
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('list.toolbar.label')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('list.searchLabel')}
                placeholder={t('list.search')}
                value={q}
                onValueChange={setQ}
              />
            }
            filters={
              // One module sends everything on a small install: a filter of one choice is noise (Hick).
              modules.length > 1 ? (
                <Select
                  aria-label={t('list.filter.module')}
                  className="w-auto"
                  value={moduleFilter}
                  onChange={(e): void => setModuleFilter(e.target.value)}
                >
                  <option value="">{t('list.filter.allModules')}</option>
                  {modules.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              ) : null
            }
            filtersActive={filtersActive}
            onClearFilters={clearFilters}
          />
        }
        notice={
          toggleError ? (
            <Alert variant="destructive">
              <AlertDescription>{toggleError}</AlertDescription>
            </Alert>
          ) : null
        }
      >
        <ResponsiveTable
          columns={columns}
          data={filtered}
          keyExtractor={(e) => e.code}
          emptyState={
            // "No e-mails" and "no e-mail matches the filters" are two
            // situations (#1448, DS-15). E-mails are declared by the modules,
            // so the no-data state offers no create action.
            items.length > 0 ? (
              <EmptyState
                variant="no-results"
                title={t('list.emptyFiltered')}
                onClearFilters={clearFilters}
                focusAfterClear={searchRef}
              />
            ) : (
              <EmptyState
                icon={<Mail size={20} />}
                title={t('list.emptyState.title')}
                description={t('list.emptyState.body')}
              />
            )
          }
        />
      </ListPage>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default EmailsList;

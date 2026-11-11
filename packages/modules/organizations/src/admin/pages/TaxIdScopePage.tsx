import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/177-tax-id-scope/` (FR-025; `contracts/admin-surfaces.md` §4.1) — the
 * installation's tax-ID scope: which of the two rules is in force, what each
 * means, and the switch between them.
 *
 * One primary action (Von Restorff): *Apply*, disabled on the scope in force
 * with the reason beside it; the switch pauses writes to organizations for a
 * moment, so it is confirmed first. The two scopes are two native radios with
 * their whole row as the label (Fitts) — the kit has no radio group, and two
 * options do not warrant one. The outcome is announced in a `role="status"`
 * region mounted before it has text, so a screen reader hears it.
 */

type TaxIdScope = 'global' | 'per-tree-root';

interface ScopeStatus {
  scope: TaxIdScope;
  updatedAt: string;
  updatedByAdminUserId: string | null;
  sharedTaxIdCount: number;
  enforcement: 'consistent' | 'mismatch';
}

interface SharedExample {
  taxId: string;
  organizationIds: string[];
}

const SCOPES: ReadonlyArray<{ value: TaxIdScope; key: 'global' | 'perTreeRoot' }> = [
  { value: 'global', key: 'global' },
  { value: 'per-tree-root', key: 'perTreeRoot' },
];

const ENDPOINT = '/api/v1/admin/organizations/tax-id-scope';

export function TaxIdScopePage(): ReactNode {
  const t = useTranslation('organizations');
  const hintId = useId();
  const [status, setStatus] = useState<ScopeStatus | null>(null);
  const [selected, setSelected] = useState<TaxIdScope>('global');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [refusal, setRefusal] = useState<{ message: string; examples: SharedExample[] } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<{ data: ScopeStatus }>(ENDPOINT);
      setStatus(res.data);
      setSelected(res.data.scope);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setLoadError(err instanceof ApiError ? err.envelope.error.message : t('taxIdScope.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const mismatch = status?.enforcement === 'mismatch';
  // Re-applying the scope in force is the repair for a mismatch (FR-016).
  const canApply = status !== null && (selected !== status.scope || mismatch);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setRefusal(null);
    setSaveError(null);
    setAnnouncement('');
    try {
      const res = await apiClient.put<{ data: ScopeStatus }>(ENDPOINT, { scope: selected });
      setStatus(res.data);
      setSelected(res.data.scope);
      setConfirming(false);
      setAnnouncement(t('taxIdScope.success'));
    } catch (err) {
      setConfirming(false);
      const details = err instanceof ApiError ? (err.envelope.error.details as { examples?: SharedExample[] } | undefined) : undefined;
      if (err instanceof ApiError && err.envelope.error.code === 'ORGANIZATION_TAX_ID_SCOPE_DUPLICATES') {
        setRefusal({ message: err.envelope.error.message, examples: details?.examples ?? [] });
      } else {
        setSaveError(err instanceof ApiError ? err.envelope.error.message : t('taxIdScope.saveError'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('taxIdScope.title')}
        description={t('taxIdScope.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/organizations">{t('taxIdScope.back')}</Link>
          </Button>
        }
      />

      <div role="status" aria-live="polite" className={announcement ? 'mb-4' : undefined}>
        {announcement ? (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            {announcement}
          </p>
        ) : null}
      </div>

      {loading ? (
        <Card aria-busy="true">
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">{t('taxIdScope.loading')}</p>
            <div className="h-12 animate-pulse rounded-md bg-muted" />
            <div className="h-12 animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      ) : forbidden ? (
        <Alert variant="destructive">
          <AlertDescription>{t('taxIdScope.forbidden')}</AlertDescription>
        </Alert>
      ) : loadError || !status ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? t('taxIdScope.loadError')}</AlertDescription>
        </Alert>
      ) : (
        <>
          {mismatch ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{t('taxIdScope.mismatch')}</AlertDescription>
            </Alert>
          ) : null}
          {status.scope === 'per-tree-root' && status.sharedTaxIdCount > 0 ? (
            <Alert variant="warning" className="mb-4" data-testid="shared-warning">
              <AlertDescription>
                {t('taxIdScope.sharedWarning', { count: status.sharedTaxIdCount })}
              </AlertDescription>
            </Alert>
          ) : null}
          {refusal ? (
            <Alert variant="destructive" className="mb-4" data-testid="duplicates-alert">
              <AlertTitle>{t('taxIdScope.duplicates.heading')}</AlertTitle>
              <AlertDescription>
                <p>{refusal.message}</p>
                <ul className="mt-2 list-disc pl-5">
                  {refusal.examples.map((example) => (
                    <li key={example.taxId}>
                      <span className="font-mono text-xs">{example.taxId}</span>:{' '}
                      {example.organizationIds.map((id, index) => (
                        <span key={id}>
                          {index > 0 ? ', ' : null}
                          <Link className="underline" to={`/organizations/${id}`}>
                            {id.slice(0, 8)}
                          </Link>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {saveError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardContent className="space-y-4 pt-6">
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">{t('taxIdScope.legend')}</legend>
                {SCOPES.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <input
                      type="radio"
                      name="tax-id-scope"
                      value={option.value}
                      checked={selected === option.value}
                      onChange={(): void => setSelected(option.value)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="space-y-1">
                      <span className="flex items-center gap-2 font-medium">
                        {t(`taxIdScope.scope.${option.key}.label`)}
                        {status.scope === option.value ? <Badge variant="secondary">{t('taxIdScope.current')}</Badge> : null}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {t(`taxIdScope.scope.${option.key}.description`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">
                {t('taxIdScope.updatedAt', { date: formatDateTime(status.updatedAt) })}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={!canApply || saving}
                  aria-busy={saving}
                  aria-describedby={canApply ? undefined : hintId}
                  onClick={(): void => setConfirming(true)}
                >
                  {mismatch && selected === status.scope ? t('taxIdScope.applyAgain') : t('taxIdScope.apply')}
                </Button>
                {canApply ? null : (
                  <p id={hintId} className="text-sm text-muted-foreground">
                    {t('taxIdScope.applyHint')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {confirming ? (
        <ModalDialog
          title={t('taxIdScope.confirm.title')}
          onClose={(): void => setConfirming(false)}
          busy={saving}
          footer={
            <>
              <Button type="button" variant="outline" onClick={(): void => setConfirming(false)} disabled={saving}>
                {t('taxIdScope.confirm.cancel')}
              </Button>
              <Button type="button" onClick={(): void => void submit()} disabled={saving} aria-busy={saving}>
                {t('taxIdScope.confirm.submit')}
              </Button>
            </>
          }
        >
          {/* FR-015a — a switch to per-tree-root cannot be undone from the admin
              once any tax ID is shared, so it says so before it is confirmed. */}
          <p className="text-sm">
            {selected === 'per-tree-root' && status?.scope !== 'per-tree-root'
              ? t('taxIdScope.confirm.bodyToPerTreeRoot')
              : t('taxIdScope.confirm.body')}
          </p>
        </ModalDialog>
      ) : null}
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default TaxIdScopePage;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Power, PowerOff } from 'lucide-react';
import type { TransactionalEmailSummary } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/i18n/useTranslation';
import { transactionalEmailsClient } from '../api/transactional-emails-client';
import { normalize } from '@/lib/text-normalization';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Issue #89 — the per-email operator control.
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

  const toggle = useCallback(async (): Promise<void> => {
    setPending(true);
    try {
      onChanged(await transactionalEmailsClient.setActive(email.code, !email.active));
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : String(err));
    } finally {
      setPending(false);
    }
  }, [email.active, email.code, onChanged, onError]);

  if (!email.deactivatable) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button type="button" variant="outline" size="sm" disabled title={email.nonDeactivatableReason ?? undefined}>
          <Lock className="mr-1 size-3.5" aria-hidden="true" />
          {t('activation.locked')}
        </Button>
        <p className="max-w-prose text-xs text-muted-foreground">{email.nonDeactivatableReason}</p>
      </div>
    );
  }

  if (!canWrite) {
    return (
      <Badge variant={email.active ? 'success' : 'secondary'}>
        {email.active ? t('activation.on') : t('activation.off')}
      </Badge>
    );
  }

  return (
    <Button
      type="button"
      variant={email.active ? 'outline' : 'default'}
      size="sm"
      disabled={pending}
      onClick={() => void toggle()}
    >
      {email.active ? (
        <PowerOff className="mr-1 size-3.5" aria-hidden="true" />
      ) : (
        <Power className="mr-1 size-3.5" aria-hidden="true" />
      )}
      {email.active ? t('activation.action.disable') : t('activation.action.enable')}
    </Button>
  );
}

export function EmailsList(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('transactional_emails');
  const [items, setItems] = useState<TransactionalEmailSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    transactionalEmailsClient
      .list()
      .then((res) => {
        if (live) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const replace = useCallback((next: TransactionalEmailSummary): void => {
    setError(null);
    setItems((prev) => prev.map((i) => (i.code === next.code ? next : i)));
  }, []);

  const filtered = useMemo(() => {
    const needle = normalize(q);
    if (!needle) return items;
    return items.filter(
      (i) => normalize(i.name).includes(needle) || normalize(i.code).includes(needle),
    );
  }, [items, q]);

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view transactional emails.</AlertDescription>
      </Alert>
    );
  }

  const canWrite = hasPermission('transactional_emails:write');

  return (
    <div className="space-y-4">
      <PageHeader title="Transactional Emails" description="Edit the content and look of transactional emails." />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Input placeholder="Search by name or code…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Code</th>
                <th className="p-3 font-medium">Module</th>
                <th className="p-3 font-medium">Customized</th>
                <th className="p-3 font-medium">{t('activation.column')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.code} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/transactional-emails/${encodeURIComponent(e.code)}`}>
                      {e.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs">{e.code}</td>
                  <td className="p-3">{e.ownerModule}</td>
                  <td className="p-3">
                    {e.hasGlobalOverride || e.hasChannelOverride ? 'Yes' : '—'}
                  </td>
                  <td className="p-3">
                    <ActivationCell
                      email={e}
                      t={t}
                      canWrite={canWrite}
                      onChanged={replace}
                      onError={setError}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={5}>
                    No transactional emails found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

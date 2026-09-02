import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SalesChannelSummary } from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Checkbox, Label, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { salesChannelsClient } from '../api/sales-channels-client.js';
import { DefaultChannelBadge } from '../components/DefaultChannelBadge.js';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * SalesChannelsListPage — feature 005 / T041.
 *
 * Top-level list view. The system-default channel always lives in
 * the list; the activeOnly filter toggles whether deactivated
 * channels are hidden. The "+ New channel" CTA sends the operator
 * to the create form (`/sales-channels/new`).
 *
 * The system-default column is where the flag moves (feature 072 / D-51). The
 * list is the right surface for it because the decision is comparative — which
 * of these channels should be the fallback — and because the current default
 * has to be visible while another one is promoted. The current default's cell
 * is deliberately inert: the flag is moved by promoting a different channel,
 * never by clearing it here, which is what keeps "exactly one default" true at
 * every moment.
 */
export function SalesChannelsListPage(): ReactNode {
  const t = useTranslation('sales_channels');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('sales_channels:write');
  const [rows, setRows] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesChannelsClient.list({ activeOnly });
      setRows(res.items);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('list.error.load'),
      );
    } finally {
      setLoading(false);
    }
  }, [activeOnly, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const makeDefault = useCallback(
    async (channel: SalesChannelSummary): Promise<void> => {
      const previous = rows.find((c) => c.systemDefault)?.code ?? '—';
      if (
        !window.confirm(
          t('list.action.makeDefault.confirm', { code: channel.code, previous }),
        )
      ) {
        return;
      }
      setPromoting(channel.code);
      setError(null);
      try {
        await salesChannelsClient.setDefault(channel.code);
        await refresh();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('list.error.makeDefault'),
        );
      } finally {
        setPromoting(null);
      }
    },
    [refresh, rows, t],
  );

  return (
    <>
      <PageHeader
        title={t('list.page.title')}
        description={t('list.page.description')}
        actions={
          // Gated on the code the create route now enforces (feature 091, batch
          // 14). It was ungated while `/sales-channels/new` was `App.tsx`'s and
          // therefore ungated too; the route is this module's own now and takes
          // `sales_channels:write`, so an ungated button would be a dead end for
          // a read-only operator rather than a refusal they could act on.
          canWrite ? (
            <Button asChild>
              <Link to="/sales-channels/new">{t('list.action.newChannel')}</Link>
            </Button>
          ) : null
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="sc-active-only"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <Label htmlFor="sc-active-only" className="cursor-pointer">
              {t('list.filter.activeOnly')}
            </Label>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('list.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('list.column.code')}</TableHead>
                  <TableHead>{t('list.column.name')}</TableHead>
                  <TableHead>{t('list.column.defaultLangCurrency')}</TableHead>
                  <TableHead>{t('list.column.status')}</TableHead>
                  <TableHead className="w-32 text-right">{t('list.column.version')}</TableHead>
                  <TableHead className="w-48 text-right">
                    {t('list.column.systemDefault')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        to={`/sales-channels/${encodeURIComponent(c.code)}`}
                        className="text-primary hover:underline"
                      >
                        {c.code}
                      </Link>
                      <DefaultChannelBadge systemDefault={c.systemDefault} />
                    </TableCell>
                    <TableCell>
                      {c.name['en-US'] ?? c.name['en'] ?? Object.values(c.name)[0] ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.defaultLanguage} / {c.defaultCurrency}
                    </TableCell>
                    <TableCell>
                      {c.active ? (
                        <Badge variant="default" className="text-[10px]">
                          {t('status.active')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          {t('status.inactive')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      v{c.version}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.systemDefault ? (
                        // The current default: stated, not offered. Clearing the
                        // flag without giving it to another channel is the one
                        // state the platform must never be in.
                        <span className="text-xs text-muted-foreground">
                          {t('list.action.makeDefault.current')}
                        </span>
                      ) : canWrite ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!c.active || promoting !== null}
                          title={
                            c.active ? undefined : t('list.action.makeDefault.inactiveHelp')
                          }
                          onClick={() => void makeDefault(c)}
                        >
                          {t('list.action.makeDefault')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default SalesChannelsListPage;

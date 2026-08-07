import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { History, Send, ShieldAlert } from 'lucide-react';
import type {
  FeedDeliveryAttempt,
  FeedDeliveryConfig,
  FeedDeliveryHttpLabel,
  FeedDeliveryProtocol,
  UpsertFeedDeliveryRequest,
} from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/i18n/useTranslation';
import { feedDeliveryClient } from '../api';
import {
  duplicateHeaderNames,
  parseHeaderLines,
  secretHeaderNames,
  toHeaderLines,
} from '../delivery-headers';

/**
 * Delivery configuration — feature 070, the fourth tab on the feed detail.
 *
 * ## The five protocols the operator asked for, and the three that exist
 *
 * The picker offers SFTP, FTP, HTTP Server, API and GraphQL, because that is
 * the vocabulary the request used and the vocabulary a partner's integration
 * documentation uses. The last three are one protocol with one label, which is
 * why picking between them changes nothing on screen — they are the same two
 * fields, exactly as in the reference.
 *
 * ## Read-only administrators (AS-7)
 *
 * Every control is rendered **present and disabled with a reason**, never
 * hidden. Where a feed is delivered is a fact a read-only operator needs — it
 * is the answer to "did the partner get today's file" — and hiding the form
 * would make the tab look like it does not apply to this feed.
 *
 * ## What this screen does not show
 *
 * The stored password, key or token, ever. A stored secret renders as a
 * placeholder note ("a password is stored, leave blank to keep it") and a
 * secret header renders as `Authorization: [redacted]`, which is also what the
 * operator may submit back to keep it.
 */

export interface FeedDeliveryPanelProps {
  feedId: string;
}

type ProtocolChoice = FeedDeliveryProtocol | FeedDeliveryHttpLabel;

/** The picker's values: the operator's five, mapped onto the stored three. */
const PROTOCOL_CHOICES: ProtocolChoice[] = ['sftp', 'ftp', 'http_server', 'api', 'graphql'];

function storedProtocol(choice: ProtocolChoice): FeedDeliveryProtocol {
  return choice === 'sftp' || choice === 'ftp' ? choice : 'http';
}

function choiceFor(config: FeedDeliveryConfig | null): ProtocolChoice {
  if (!config) return 'sftp';
  if (config.protocol !== 'http') return config.protocol;
  return config.httpLabel ?? 'http_server';
}

export function FeedDeliveryPanel(props: FeedDeliveryPanelProps): ReactNode {
  const { feedId } = props;
  const t = useTranslation('product_feeds');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [config, setConfig] = useState<FeedDeliveryConfig | null>(null);
  const [attempts, setAttempts] = useState<FeedDeliveryAttempt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [configuring, setConfiguring] = useState(false);

  const [choice, setChoice] = useState<ProtocolChoice>('sftp');
  const [enabled, setEnabled] = useState(true);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [directoryPath, setDirectoryPath] = useState('');
  const [requestUrl, setRequestUrl] = useState('');
  const [headerText, setHeaderText] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const hydrate = useCallback((next: FeedDeliveryConfig | null): void => {
    setConfig(next);
    setChoice(choiceFor(next));
    setEnabled(next ? next.enabled : true);
    setHost(next?.host ?? '');
    setPort(next?.port ? String(next.port) : '');
    setUsername(next?.username ?? '');
    setDirectoryPath(next?.directoryPath ?? '');
    setRequestUrl(next?.requestUrl ?? '');
    setHeaderText(next ? toHeaderLines(next.headers) : '');
    // Never pre-filled from the server — there is nothing to pre-fill them
    // with, which is the point of FR-107.
    setPassword('');
    setPrivateKey('');
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [detail, history] = await Promise.all([
        feedDeliveryClient.get(feedId),
        feedDeliveryClient.listAttempts(feedId),
      ]);
      hydrate(detail.data);
      setAttempts(history.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [feedId, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const protocol = storedProtocol(choice);
  const duplicates = duplicateHeaderNames(headerText);
  const secretNames = secretHeaderNames(headerText);

  const buildBody = (): UpsertFeedDeliveryRequest => {
    const common = {
      enabled,
      ...(config ? { expectedVersion: config.version } : {}),
    };
    if (protocol === 'http') {
      return {
        ...common,
        protocol: 'http',
        httpLabel: choice as FeedDeliveryHttpLabel,
        requestUrl: requestUrl.trim(),
        headers: parseHeaderLines(headerText),
      };
    }
    const portValue = port.trim() === '' ? null : Number(port);
    const base = {
      ...common,
      host: host.trim(),
      port: Number.isFinite(portValue) ? portValue : null,
      username: username.trim(),
      ...(password.trim() === '' ? {} : { password }),
      ...(directoryPath.trim() === '' ? {} : { directoryPath: directoryPath.trim() }),
    };
    if (protocol === 'sftp') {
      return {
        ...base,
        protocol: 'sftp',
        ...(privateKey.trim() === '' ? {} : { privateKey }),
      };
    }
    return { ...base, protocol: 'ftp', passiveMode: true };
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await feedDeliveryClient.save(feedId, buildBody());
      hydrate(result.data);
      setConfiguring(false);
      setNotice(t('delivery.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await feedDeliveryClient.test(feedId);
      if (result.data.ok) {
        setNotice(t('delivery.test.ok'));
      } else {
        setError(
          `${t('delivery.test.failed')} ${
            result.data.failureReason ? t(`delivery.reason.${result.data.failureReason}`) : ''
          } ${result.data.failureDetail ?? ''}`.trim(),
        );
      }
      setAttempts((await feedDeliveryClient.listAttempts(feedId)).data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(t('delivery.action.removeConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await feedDeliveryClient.remove(feedId);
      hydrate(null);
      setConfiguring(false);
      setNotice(t('delivery.removed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const attemptColumns: ResponsiveColumn<FeedDeliveryAttempt>[] = [
    {
      id: 'status',
      header: t('delivery.history.status'),
      primary: true,
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <Badge variant={row.status === 'succeeded' ? 'default' : 'destructive'}>
            {t(`delivery.status.${row.status}`)}
          </Badge>
          {row.isTest && (
            <span className="text-xs text-muted-foreground">{t('delivery.history.test')}</span>
          )}
        </span>
      ),
      meta: (row) => formatDateTime(row.startedAt),
    },
    {
      id: 'startedAt',
      header: t('delivery.history.startedAt'),
      hideOnMobile: true,
      render: (row) => formatDateTime(row.startedAt),
    },
    {
      id: 'target',
      header: t('delivery.history.target'),
      hideOnMobile: true,
      render: (row) => <span className="font-mono text-xs">{row.target}</span>,
    },
    {
      id: 'attempt',
      header: t('delivery.history.attempt'),
      hideOnMobile: true,
      render: (row) => String(row.attempt),
    },
    {
      id: 'duration',
      header: t('delivery.history.duration'),
      hideOnMobile: true,
      render: (row) =>
        row.durationMs === null ? '—' : `${Math.round(row.durationMs / 100) / 10}s`,
    },
    {
      id: 'detail',
      header: t('delivery.history.detail'),
      render: (row) =>
        row.failureReason ? (
          <span className="text-sm">
            {t(`delivery.reason.${row.failureReason}`)}
            {row.failureDetail && (
              <span className="block text-xs text-muted-foreground">{row.failureDetail}</span>
            )}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  if (!loaded) return null;

  const showForm = config !== null || configuring;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription role="status">{notice}</AlertDescription>
        </Alert>
      )}

      {!showForm && (
        <Card>
          <CardContent className="pt-6">
            <div className="b2b-empty">
              <div className="b2b-empty__icon">
                <Send size={20} aria-hidden="true" />
              </div>
              <div className="b2b-empty__title">{t('delivery.empty.title')}</div>
              <div className="b2b-empty__sub">{t('delivery.empty.subtitle')}</div>
              <Button
                className="mt-4"
                onClick={() => setConfiguring(true)}
                disabled={!canWrite}
                title={writeTitle}
              >
                {t('delivery.action.configure')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('delivery.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('delivery.subtitle')}</p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delivery-enabled">{t('delivery.field.enabled')}</Label>
              <Select
                id="delivery-enabled"
                value={enabled ? 'on' : 'off'}
                onChange={(e) => setEnabled(e.target.value === 'on')}
                disabled={!canWrite}
                title={writeTitle}
              >
                <option value="on">{t('delivery.field.enabled.on')}</option>
                <option value="off">{t('delivery.field.enabled.off')}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t('delivery.field.enabled.help')}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delivery-protocol">{t('delivery.field.protocol')}</Label>
              <Select
                id="delivery-protocol"
                value={choice}
                onChange={(e) => setChoice(e.target.value as ProtocolChoice)}
                disabled={!canWrite}
                title={writeTitle}
              >
                {PROTOCOL_CHOICES.map((value) => (
                  <option key={value} value={value}>
                    {t(`delivery.protocol.${value}`)}
                  </option>
                ))}
              </Select>
            </div>

            {protocol === 'ftp' && (
              <Alert>
                <ShieldAlert size={16} aria-hidden="true" />
                <AlertDescription>{t('delivery.ftp.plaintextWarning')}</AlertDescription>
              </Alert>
            )}

            {protocol !== 'http' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-host">{t('delivery.field.host')}</Label>
                  <Input
                    id="delivery-host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                  <p className="text-xs text-muted-foreground">{t('delivery.field.host.help')}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-port">Port</Label>
                  <Input
                    id="delivery-port"
                    inputMode="numeric"
                    value={port}
                    placeholder={protocol === 'sftp' ? '22' : '21'}
                    onChange={(e) => setPort(e.target.value)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-username">{t('delivery.field.username')}</Label>
                  <Input
                    id="delivery-username"
                    value={username}
                    autoComplete="off"
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-password">{t('delivery.field.password')}</Label>
                  <Input
                    id="delivery-password"
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                  {config?.passwordSet && (
                    <p className="text-xs text-muted-foreground">
                      {t('delivery.field.password.set')}
                    </p>
                  )}
                </div>
                {protocol === 'sftp' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="delivery-key">{t('delivery.field.privateKey')}</Label>
                    <Textarea
                      id="delivery-key"
                      rows={4}
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      disabled={!canWrite}
                      title={writeTitle}
                    />
                    <p className="text-xs text-muted-foreground">
                      {config?.privateKeySet
                        ? t('delivery.field.privateKey.set')
                        : t('delivery.field.privateKey.help')}
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-directory">{t('delivery.field.directoryPath')}</Label>
                  <Input
                    id="delivery-directory"
                    value={directoryPath}
                    onChange={(e) => setDirectoryPath(e.target.value)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('delivery.field.directoryPath.help')}
                  </p>
                </div>
                {protocol === 'ftp' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="delivery-passive">{t('delivery.field.passiveMode')}</Label>
                    <Select id="delivery-passive" value="on" disabled title={writeTitle}>
                      <option value="on">{t('delivery.field.enabled.on')}</option>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t('delivery.field.passiveMode.help')}
                    </p>
                  </div>
                )}
              </>
            )}

            {protocol === 'http' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-url">{t('delivery.field.requestUrl')}</Label>
                  <Input
                    id="delivery-url"
                    value={requestUrl}
                    placeholder="https://partner.example.com/feeds"
                    onChange={(e) => setRequestUrl(e.target.value)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('delivery.field.requestUrl.help')}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delivery-headers">{t('delivery.field.headers')}</Label>
                  <Textarea
                    id="delivery-headers"
                    rows={5}
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    aria-invalid={duplicates.length > 0}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                  <p className="whitespace-pre-line text-xs text-muted-foreground">
                    {t('delivery.field.headers.help')}
                  </p>
                  {secretNames.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('delivery.field.headers.secretNote')}
                    </p>
                  )}
                  {duplicates.length > 0 && (
                    <p className="text-xs text-destructive" role="alert">
                      {duplicates.join(', ')}
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void save()}
                disabled={!canWrite || busy || duplicates.length > 0}
                title={writeTitle}
              >
                {t('delivery.action.save')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void test()}
                disabled={!canWrite || testing || config === null}
                title={writeTitle}
              >
                {testing ? t('delivery.test.running') : t('delivery.action.test')}
              </Button>
              {config !== null && (
                <Button
                  variant="ghost"
                  onClick={() => void remove()}
                  disabled={!canWrite || busy}
                  title={writeTitle}
                >
                  {t('delivery.action.remove')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('delivery.history.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            columns={attemptColumns}
            data={attempts}
            keyExtractor={(row) => row.id}
            emptyState={
              <div className="b2b-empty">
                <div className="b2b-empty__icon">
                  <History size={20} aria-hidden="true" />
                </div>
                <div className="b2b-empty__title">{t('delivery.history.empty.title')}</div>
                <div className="b2b-empty__sub">{t('delivery.history.empty.subtitle')}</div>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

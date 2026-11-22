import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { History, Send, ShieldAlert, Trash2 } from 'lucide-react';
import type {
  FeedDeliveryAttempt,
  FeedDeliveryConfig,
  FeedDeliveryHttpLabel,
  FeedDeliveryProtocol,
  UpsertFeedDeliveryRequest,
} from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  EditorSection,
  EmptyState,
  InlineStatus,
  Input,
  Label,
  Select,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable, type ResponsiveColumn, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { feedDeliveryClient } from '../api.js';
import {
  duplicateHeaderNames,
  parseHeaderLines,
  secretHeaderNames,
  toHeaderLines,
} from '../delivery-headers.js';

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
 * ## One card (issue #1530, UX audit CAT-20)
 *
 * The tab is one card of three sections — the target, its history, and the
 * removal last and on its own (Fitts: the destructive action away from Save).
 * The result of an action — saved, removed, a test that passed or failed — is
 * an `InlineStatus` beside the buttons, not a banner above the form; only a
 * request that failed outright is an `Alert`.
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
  const { language } = useTranslationContext();
  const { feedId } = props;
  const t = useTranslation('product_feeds');
  const { confirm, confirmDialog } = useConfirmDialog();
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
  const status = useInlineStatus();
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
    status.clear();
    try {
      const result = await feedDeliveryClient.save(feedId, buildBody());
      hydrate(result.data);
      setConfiguring(false);
      status.show(t('delivery.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    status.clear();
    try {
      const result = await feedDeliveryClient.test(feedId);
      if (result.data.ok) {
        status.show(t('delivery.test.ok'));
      } else {
        status.show(
          `${t('delivery.test.failed')} ${
            result.data.failureReason ? t(`delivery.reason.${result.data.failureReason}`) : ''
          } ${result.data.failureDetail ?? ''}`.trim(),
          'error',
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
    const ok = await confirm({
      message: t('delivery.action.removeConfirm'),
      confirmLabel: t('delivery.action.remove'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    status.clear();
    try {
      await feedDeliveryClient.remove(feedId);
      hydrate(null);
      setConfiguring(false);
      status.show(t('delivery.removed'));
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
      meta: (row) => formatDateTime(row.startedAt, language),
    },
    {
      id: 'startedAt',
      header: t('delivery.history.startedAt'),
      hideOnMobile: true,
      render: (row) => formatDateTime(row.startedAt, language),
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

  if (!loaded) {
    return (
      <Card aria-busy="true">
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            {t('delivery.loading')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const showForm = config !== null || configuring;
  const field = 'flex flex-col gap-1.5';
  const hintClass = 'text-xs text-muted-foreground';

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-(--section-gap)">
          <EditorSection
            title={t('delivery.title')}
            description={t('delivery.subtitle')}
            contentClassName="flex flex-col gap-4"
          >
            {!showForm && (
              <EmptyState
                icon={<Send size={20} />}
                title={t('delivery.empty.title')}
                description={t('delivery.empty.subtitle')}
                action={
                  <Button
                    className="min-h-11 sm:min-h-9"
                    onClick={() => setConfiguring(true)}
                    disabled={!canWrite}
                    title={writeTitle}
                  >
                    {t('delivery.action.configure')}
                  </Button>
                }
              />
            )}

            {showForm && (
              <>
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <Checkbox
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    disabled={!canWrite}
                    title={writeTitle}
                  />
                  {t('delivery.field.send')}
                </label>

                <div className={field}>
                  <Label htmlFor="delivery-protocol">{t('delivery.field.protocol')}</Label>
                  <Select
                    id="delivery-protocol"
                    className="sm:max-w-xs"
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
                    {/* Host and port, then user and password, pair up on a wide screen (Proximity). */}
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                      <div className={field}>
                        <Label htmlFor="delivery-host">{t('delivery.field.host')}</Label>
                        <Input
                          id="delivery-host"
                          value={host}
                          placeholder={protocol === 'sftp' ? 'sftp.example.com' : 'ftp.example.com'}
                          onChange={(e) => setHost(e.target.value)}
                          disabled={!canWrite}
                          title={writeTitle}
                        />
                      </div>
                      <div className={field}>
                        <Label htmlFor="delivery-port">{t('delivery.field.port')}</Label>
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
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className={field}>
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
                      <div className={field}>
                        <Label htmlFor="delivery-password">{t('delivery.field.password')}</Label>
                        <Input
                          id="delivery-password"
                          type="password"
                          value={password}
                          autoComplete="new-password"
                          aria-describedby={config?.passwordSet ? 'delivery-password-set' : undefined}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={!canWrite}
                          title={writeTitle}
                        />
                        {config?.passwordSet && (
                          <p id="delivery-password-set" className={hintClass}>
                            {t('delivery.field.password.set')}
                          </p>
                        )}
                      </div>
                    </div>
                    {protocol === 'sftp' && (
                      <div className={field}>
                        <Label htmlFor="delivery-key">{t('delivery.field.privateKey')}</Label>
                        <Textarea
                          id="delivery-key"
                          rows={4}
                          value={privateKey}
                          aria-describedby="delivery-key-hint"
                          onChange={(e) => setPrivateKey(e.target.value)}
                          disabled={!canWrite}
                          title={writeTitle}
                        />
                        <p id="delivery-key-hint" className={hintClass}>
                          {config?.privateKeySet
                            ? t('delivery.field.privateKey.set')
                            : t('delivery.field.privateKey.help')}
                        </p>
                      </div>
                    )}
                    <div className={field}>
                      <Label htmlFor="delivery-directory">{t('delivery.field.directoryPath')}</Label>
                      <Input
                        id="delivery-directory"
                        value={directoryPath}
                        placeholder="/incoming/feeds"
                        aria-describedby="delivery-directory-hint"
                        onChange={(e) => setDirectoryPath(e.target.value)}
                        disabled={!canWrite}
                        title={writeTitle}
                      />
                      <p id="delivery-directory-hint" className={hintClass}>
                        {t('delivery.field.directoryPath.help')}
                      </p>
                    </div>
                    {protocol === 'ftp' && (
                      // Passive mode is the only one supported, so it is a fact, not a control (issue #1459).
                      <p className="flex items-center gap-2 text-sm" data-testid="delivery-passive">
                        <span className="font-medium">{t('delivery.field.passiveMode')}</span>
                        <span>{t('delivery.field.enabled.on')}</span>
                      </p>
                    )}
                  </>
                )}

                {protocol === 'http' && (
                  <>
                    <div className={field}>
                      <Label htmlFor="delivery-url">{t('delivery.field.requestUrl')}</Label>
                      <Input
                        id="delivery-url"
                        value={requestUrl}
                        placeholder="https://partner.example.com/feeds"
                        aria-describedby="delivery-url-hint"
                        onChange={(e) => setRequestUrl(e.target.value)}
                        disabled={!canWrite}
                        title={writeTitle}
                      />
                      <p id="delivery-url-hint" className={hintClass}>
                        {t('delivery.field.requestUrl.help')}
                      </p>
                    </div>
                    <div className={field}>
                      <Label htmlFor="delivery-headers">{t('delivery.field.headers')}</Label>
                      <Textarea
                        id="delivery-headers"
                        rows={5}
                        value={headerText}
                        placeholder={t('delivery.field.headers.placeholder')}
                        aria-describedby="delivery-headers-hint"
                        onChange={(e) => setHeaderText(e.target.value)}
                        aria-invalid={duplicates.length > 0}
                        disabled={!canWrite}
                        title={writeTitle}
                      />
                      <div id="delivery-headers-hint" className="flex flex-col gap-1">
                        <p className={hintClass}>{t('delivery.field.headers.help')}</p>
                        {secretNames.length > 0 && (
                          <p className={hintClass}>{t('delivery.field.headers.secretNote')}</p>
                        )}
                      </div>
                      {duplicates.length > 0 && (
                        <p className="text-xs text-destructive" role="alert">
                          {duplicates.join(', ')}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* One status region, mounted whether or not the form is open, so a removal's
                result is announced where the form was (WCAG 4.1.3). */}
            <div className="flex flex-wrap items-center gap-3">
              {showForm && (
                <>
                  <Button
                    onClick={() => void save()}
                    disabled={!canWrite || busy || duplicates.length > 0}
                    aria-busy={busy}
                    title={writeTitle}
                  >
                    {t('delivery.action.save')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void test()}
                    disabled={!canWrite || testing || config === null}
                    aria-busy={testing}
                    title={writeTitle}
                  >
                    {testing ? t('delivery.test.running') : t('delivery.action.test')}
                  </Button>
                </>
              )}
              <InlineStatus {...status.props} />
            </div>
          </EditorSection>

          <EditorSection title={t('delivery.history.title')}>
            <ResponsiveTable
              columns={attemptColumns}
              data={attempts}
              keyExtractor={(row) => row.id}
              emptyState={
                <EmptyState
                  icon={<History size={20} />}
                  title={t('delivery.history.empty.title')}
                  description={t('delivery.history.empty.subtitle')}
                />
              }
            />
          </EditorSection>

          {config !== null && (
            // Last and on its own, after the history (Fitts: away from Save), as on the price book.
            <EditorSection title={t('delivery.remove.title')} description={t('delivery.remove.help')}>
              <div>
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => void remove()}
                  disabled={!canWrite || busy}
                  title={writeTitle}
                >
                  <Trash2 aria-hidden="true" />
                  {t('delivery.action.remove')}
                </Button>
              </div>
            </EditorSection>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}

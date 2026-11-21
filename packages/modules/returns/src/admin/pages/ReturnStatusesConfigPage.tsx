import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { ApiError, useDerivedKey } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, FormField, InlineStatus, Input, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { ModalDialog, StatusTransitionGraph, useConfirmDialog, useRemovalFocus } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';
import { returnStatusName } from '../labels.js';

import type { ReturnNotificationHealth, ReturnStatusDto, ReturnTransitionDto } from '@endora-commerce/contracts';

/**
 * The statuses whose entry sends a dedicated e-mail of its own, so they never send
 * the status e-mail (`specs/180-off-platform-complaints/` FR-A32). The API refuses
 * the flag there; the screen says why beside the control.
 */
const DEDICATED_EMAIL_STATUSES: ReadonlySet<string> = new Set(['authorized', 'rejected']);

/** Stable, module-level: `useRemovalFocus` keys its targets by it. */
const statusCode = (s: { code: string }): string => s.code;

/** Configurable return/complaint workflow (feature 046, US3). */
export function ReturnStatusesConfigPage(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  const [statuses, setStatuses] = useState<Array<ReturnStatusDto & { inUseCount: number }>>([]);
  const [transitions, setTransitions] = useState<ReturnTransitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const status = useInlineStatus();
  const [saving, setSaving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Issue #1472 — the operator's language first (`returnStatusName`), then the default name.
  const statusLabel = (s: Pick<ReturnStatusDto, 'code' | 'name' | 'defaultName'>): string => returnStatusName(s, language);
  const { confirm, confirmDialog } = useConfirmDialog();
  // Only these rows carry a Delete; focus after one goes to the next of them, else "New status".
  const deletable = statuses.filter((s) => !s.isInitial && !s.isSystem);
  const removalFocus = useRemovalFocus(deletable, statusCode, loaded);
  // `specs/180-off-platform-complaints/` D-7 — where the new-case e-mail goes to nobody.
  const [health, setHealth] = useState<ReturnNotificationHealth | null>(null);
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const graph = await returnsClient.statuses();
      setStatuses(graph.statuses);
      setTransitions(graph.transitions);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.loadFailed'));
    }
  }, [tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let live = true;
    void returnsClient
      .notificationHealth()
      .then((answer) => {
        if (live) setHealth(answer);
      })
      .catch(() => undefined);
    // Best effort: an operator who may not read the channel list sees the ids instead.
    void returnsClient
      .salesChannels()
      .then((list) => {
        if (!live) return;
        setChannelNames(
          Object.fromEntries(
            (list.items ?? []).map((c) => [
              c.id,
              c.name[language] ?? c.name['en'] ?? Object.values(c.name)[0] ?? c.code,
            ]),
          ),
        );
      })
      .catch(() => undefined);
    return (): void => {
      live = false;
    };
  }, [language]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
      }
    },
    [refresh, tr],
  );

  // FR-A30 — saved on change, optimistically, and put back with the error when the
  // write fails. The write is audited (FR-A52), so no confirmation is asked for.
  const setNotify = async (statusCode: string, notify: boolean): Promise<void> => {
    setError(null);
    setSaving(statusCode);
    setStatuses((prev) => prev.map((s) => (s.code === statusCode ? { ...s, notifyCustomerOnEntry: notify } : s)));
    try {
      await returnsClient.updateStatus(statusCode, { notifyCustomerOnEntry: notify });
    } catch (err) {
      setStatuses((prev) => prev.map((s) => (s.code === statusCode ? { ...s, notifyCustomerOnEntry: !notify } : s)));
      setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
    } finally {
      setSaving(null);
    }
  };

  // The returns transitions endpoint is a full-list replace, so we derive the
  // next set from the current one for the graph's add/remove callbacks.
  const addTransition = (fromCode: string, toCode: string): void => {
    if (!fromCode || !toCode || fromCode === toCode) return;
    if (transitions.some((x) => x.fromStatusCode === fromCode && x.toStatusCode === toCode)) return;
    const next = [
      ...transitions.map((x) => ({ fromStatusCode: x.fromStatusCode, toStatusCode: x.toStatusCode })),
      { fromStatusCode: fromCode, toStatusCode: toCode },
    ];
    void run(() => returnsClient.setTransitions(next));
  };

  const removeTransition = (fromCode: string, toCode: string): void => {
    const next = transitions
      .filter((x) => !(x.fromStatusCode === fromCode && x.toStatusCode === toCode))
      .map((x) => ({ fromStatusCode: x.fromStatusCode, toStatusCode: x.toStatusCode }));
    void run(() => returnsClient.setTransitions(next));
  };

  const removeStatus = (s: ReturnStatusDto & { inUseCount: number }): void => {
    void confirm({
      title: tr('statusConfig.deleteConfirm.title'),
      message: tr('statusConfig.deleteConfirm.message', { status: statusLabel(s) }),
      confirmLabel: t('common.action.delete'),
      destructive: true,
      // The endpoint answers with the whole graph: taken as is, the other rows stay mounted.
      action: async () => {
        const graph = await returnsClient.deleteStatus(s.code);
        setStatuses(graph.statuses);
        setTransitions(graph.transitions);
      },
      describeError: (err: unknown) => (err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed')),
      returnFocusTo: removalFocus.returnFocusTo(s),
    });
  };

  // Issue #1439 (DS-05): "New status" sits in the header and opens a dialog, rather than a
  // create card drawn open between the statuses and their transitions (Hick). The system
  // statuses always exist, so the header always carries it.
  const newStatus = (
    <Button
      ref={(element: HTMLButtonElement | null) => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      className="min-h-11 sm:min-h-9"
      onClick={() => {
        status.clear();
        setCreating(true);
      }}
    >
      <Plus size={16} aria-hidden="true" />
      {tr('statusConfig.newTitle')}
    </Button>
  );

  const missingChannels = health?.recipientsMissing.salesChannelIds ?? [];
  const recipientsAlert =
    missingChannels.length > 0
      ? tr('statusConfig.recipientsMissing.channels', {
          channels: missingChannels.map((id) => channelNames[id] ?? id).join(', '),
        })
      : health?.recipientsMissing.global
        ? tr('statusConfig.recipientsMissing.any')
        : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('returns.statuses.title')}
        actions={
          loaded ? (
            <>
              <InlineStatus {...status.props} />
              {newStatus}
            </>
          ) : null
        }
      />
      {recipientsAlert && (
        <Alert variant="warning">
          <AlertDescription>
            {recipientsAlert}{' '}
            <Link to="/settings?group=returns" className="underline underline-offset-2">
              {tr('statusConfig.recipientsMissing.link')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr('statusConfig.statuses')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('statusConfig.col.code')}</TableHead>
                <TableHead>{tr('statusConfig.col.name')}</TableHead>
                <TableHead>{tr('statusConfig.col.flags')}</TableHead>
                <TableHead>{tr('statusConfig.notifyColumn')}</TableHead>
                <TableHead>{tr('statusConfig.col.inUse')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((s) => {
                const dedicated = DEDICATED_EMAIL_STATUSES.has(s.code);
                const reasonId = `notify-reason-${s.code}`;
                return (
                  <TableRow key={s.code} aria-busy={saving === s.code}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell>{statusLabel(s)}</TableCell>
                    <TableCell className="flex gap-1">
                      {s.isInitial && <Badge variant="outline">{tr('statusConfig.flag.initial')}</Badge>}
                      {s.isTerminal && <Badge variant="outline">{tr('statusConfig.flag.terminal')}</Badge>}
                      {s.isSystem && <Badge variant="secondary">{tr('statusConfig.flag.system')}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          aria-label={tr('statusConfig.notifyLabel', { status: statusLabel(s) })}
                          checked={dedicated ? false : s.notifyCustomerOnEntry}
                          disabled={dedicated || saving === s.code}
                          onChange={(e) => void setNotify(s.code, e.target.checked)}
                          {...(dedicated || s.isInitial ? { 'aria-describedby': reasonId } : {})}
                        />
                        {dedicated ? (
                          <span id={reasonId} className="text-xs text-muted-foreground">
                            {tr('statusConfig.notifyDedicated')}
                          </span>
                        ) : s.isInitial ? (
                          // D-2 — filing is not an entry into the initial status.
                          <span id={reasonId} className="text-xs text-muted-foreground">
                            {tr('statusConfig.notifyInitialHint')}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{s.inUseCount}</TableCell>
                    <TableCell>
                      {!s.isInitial && !s.isSystem && (
                        <Button
                          variant="ghost"
                          size="sm"
                          ref={removalFocus.targetRef(s)}
                          aria-label={tr('statusConfig.delete', { status: statusLabel(s) })}
                          onClick={() => removeStatus(s)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {/* FR-A33 — marking a status sends nothing for the cases already in it. */}
          <p className="text-xs text-muted-foreground">{tr('statusConfig.notifyExistingHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orderStatusConfig.transitions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusTransitionGraph
            statuses={statuses}
            transitions={transitions}
            statusLabel={statusLabel}
            onAdd={addTransition}
            onRemove={removeTransition}
          />
        </CardContent>
      </Card>
      {creating ? (
        <NewStatusDialog
          finalFocusRef={removalFocus.createRef}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await refresh();
            setCreating(false);
            status.show(tr('statusConfig.added'));
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
interface NewStatusDialogProps {
  /** Focused when the dialog closes: the header's "New status". */
  finalFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

/**
 * The new-status form — a name and a code, so a dialog (DS-05). Tesler: the code follows
 * the English name until the operator edits it (DS-22, `useDerivedKey`). Each refusal is
 * said at its field; the server's stays in the dialog with what was typed kept.
 */
function NewStatusDialog({ finalFocusRef, onClose, onCreated }: NewStatusDialogProps): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const formId = useId();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const codeField = useDerivedKey({ source: name, value: code, onChange: setCode, separator: '_', maxLength: 64 });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    const sent = codeField.commit();
    const found: { name?: string; code?: string } = {};
    if (!name.trim()) found.name = tr('statusConfig.validation.nameRequired');
    if (!sent) found.code = tr('statusConfig.validation.codeRequired');
    setErrors(found);
    if (found.name || found.code) return;
    setSaving(true);
    try {
      await returnsClient.createStatus({ code: sent, name: { en: name.trim() }, defaultName: name.trim() });
      await onCreated();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={tr('statusConfig.newTitle')}
      onClose={onClose}
      busy={saving}
      dismissOnScrim={false}
      finalFocusRef={finalFocusRef}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {tr('statusConfig.addStatus')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        <FormField label={tr('statusConfig.newName')} required error={errors.name}>
          <Input
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors(({ code: codeError }) => (codeError ? { code: codeError } : {}));
            }}
          />
        </FormField>
        <FormField label={tr('statusConfig.newCode')} hint={tr('statusConfig.codeHint')} required error={errors.code}>
          <Input
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            maxLength={64}
            value={code}
            onChange={codeField.onChange}
            onBlur={codeField.onBlur}
          />
        </FormField>
        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      </form>
    </ModalDialog>
  );
}

export default ReturnStatusesConfigPage;

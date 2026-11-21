import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { ListChecks, Loader2, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { ModalDialog, useConfirmDialog, useRemovalFocus } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  PageHeader,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';
import { localizedText } from '../labels.js';

import type { ReturnReasonDto } from '@endora-commerce/contracts';

const APPLIES_TO = ['both', 'return', 'complaint'] as const;

/** Stable, module-level: `useRemovalFocus` keys its targets by it. */
const reasonId = (r: ReturnReasonDto): string => r.id;

/** Managed return/complaint reasons (feature 046, US7; translated in #1472). */
export function ReturnReasonsPage(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  // `null` until the first answer, so the empty state does not flash while loading.
  const [rows, setRows] = useState<ReturnReasonDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const status = useInlineStatus();
  const { confirm, confirmDialog } = useConfirmDialog();
  // After a confirmed delete, focus goes to the next row's Delete, else "New reason" (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows ?? [], reasonId, rows !== null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await returnsClient.reasons());
    } catch (err) {
      setRows((prev) => prev ?? []);
      setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.loadFailed'));
    }
  }, [tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
        return false;
      }
    },
    [refresh, tr],
  );

  const nameOf = (r: ReturnReasonDto): string => localizedText(r.label, language, '—');

  const describeError = (err: unknown): string =>
    err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed');

  // The request runs inside the confirmation, so a refusal is shown in the dialog;
  // the row is removed in place so the neighbour that takes focus stays mounted.
  const remove = (r: ReturnReasonDto): void => {
    void confirm({
      title: tr('reasons.deleteConfirm.title'),
      message: tr('reasons.deleteConfirm.message', { label: nameOf(r) }),
      confirmLabel: t('common.action.delete'),
      destructive: true,
      action: async () => {
        await returnsClient.deleteReason(r.id);
        setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
      },
      describeError,
      returnFocusTo: removalFocus.returnFocusTo(r),
    });
  };

  // Issue #1439 (DS-05): "New reason" sits in the header and opens a dialog, rather than a
  // create card drawn open under the list (Hick). With no reason yet the empty state carries
  // it instead, so the view keeps one create action (Von Restorff). The one ref is both the
  // removal-focus target and the dialog's return target, whichever of the two is drawn.
  const newReason = (
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
      {tr('reasons.newTitle')}
    </Button>
  );
  const nothingYet = rows !== null && rows.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('returns.reasons.title')}
        description={t('returns.reasons.description')}
        actions={
          rows !== null && !nothingYet ? (
            <>
              <InlineStatus {...status.props} />
              {newReason}
            </>
          ) : null
        }
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {rows !== null && (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                icon={<ListChecks size={20} />}
                title={tr('reasons.empty.title')}
                description={tr('reasons.empty.description')}
                action={newReason}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('reasons.col.label')}</TableHead>
                    <TableHead>{tr('reasons.col.appliesTo')}</TableHead>
                    <TableHead className="text-right">{tr('reasons.col.weight')}</TableHead>
                    <TableHead>{tr('reasons.col.active')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{nameOf(r)}</TableCell>
                      <TableCell>{tr(`reasons.appliesTo.${r.appliesTo}`)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.weight}</TableCell>
                      <TableCell>
                        <Switch
                          checked={r.isActive}
                          busy={busyId === r.id}
                          aria-label={tr('reasons.activeLabel', { label: nameOf(r) })}
                          onCheckedChange={(next) => {
                            setBusyId(r.id);
                            void run(() => returnsClient.updateReason(r.id, { isActive: next })).finally(() =>
                              setBusyId(null),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          ref={removalFocus.targetRef(r)}
                          aria-label={tr('reasons.delete', { label: nameOf(r) })}
                          onClick={() => remove(r)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {creating ? (
        <NewReasonDialog
          finalFocusRef={removalFocus.createRef}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await refresh();
            setCreating(false);
            status.show(tr('reasons.added'));
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
interface NewReasonDialogProps {
  /** Focused when the dialog closes: the create action drawn at that moment. */
  finalFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

/**
 * The new-reason form — three fields, so a dialog rather than a route (DS-05). A missing
 * label is refused at its field; the server's refusal stays in the dialog with what was
 * typed kept (Peak-End).
 */
function NewReasonDialog({ finalFocusRef, onClose, onCreated }: NewReasonDialogProps): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const formId = useId();
  const [label, setLabel] = useState('');
  const [appliesTo, setAppliesTo] = useState<string>('both');
  const [weight, setWeight] = useState(100);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    if (!label.trim()) {
      setLabelError(tr('reasons.validation.labelRequired'));
      return;
    }
    setLabelError(null);
    setSaving(true);
    try {
      await returnsClient.createReason({ label: { en: label.trim() }, appliesTo, weight });
      await onCreated();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={tr('reasons.newTitle')}
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
            {tr('reasons.add')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        <FormField label={tr('reasons.field.label')} required error={labelError}>
          <Input
            value={label}
            maxLength={200}
            onChange={(e) => {
              setLabel(e.target.value);
              if (labelError) setLabelError(null);
            }}
          />
        </FormField>
        <FormField label={tr('reasons.field.appliesTo')}>
          <Select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
            {APPLIES_TO.map((value) => (
              <option key={value} value={value}>
                {tr(`reasons.appliesTo.${value}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={tr('reasons.field.weight')} hint={tr('reasons.field.weightHint')}>
          <Input type="number" step="1" className="w-28" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        </FormField>
        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      </form>
    </ModalDialog>
  );
}

export default ReturnReasonsPage;

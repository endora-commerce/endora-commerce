import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { ListChecks, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
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
import { MissingNames } from '../components/MissingNames.js';
import { localizedText, mergeNames, nameDraft, primaryName, type NameDraft } from '../labels.js';

import { SUPPORTED_LANGUAGES, type ReturnReasonDto } from '@endora-commerce/contracts';

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
  // The dialog open: `reason: null` creates, a reason edits it (owner decision 2026-11-21).
  const [dialog, setDialog] = useState<{ reason: ReturnReasonDto | null } | null>(null);
  // An edit's dialog gives focus back to the row's Edit that opened it.
  const editReturnRef = useRef<HTMLElement | null>(null);
  // The code every write route enforces (`requireAdmin('returns:write')`): a read-only
  // operator sees the list but is offered no write it would be refused.
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('returns:write');
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
        setDialog({ reason: null });
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
          canWrite && rows !== null && !nothingYet ? (
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
                action={canWrite ? newReason : null}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('reasons.col.label')}</TableHead>
                    <TableHead>{tr('reasons.col.appliesTo')}</TableHead>
                    <TableHead className="text-right">{tr('reasons.col.weight')}</TableHead>
                    <TableHead>{tr('reasons.col.active')}</TableHead>
                    {canWrite ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          <span>{nameOf(r)}</span>
                          <MissingNames names={r.label} />
                        </span>
                      </TableCell>
                      <TableCell>{tr(`reasons.appliesTo.${r.appliesTo}`)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.weight}</TableCell>
                      <TableCell>
                        <Switch
                          checked={r.isActive}
                          busy={busyId === r.id}
                          disabled={!canWrite}
                          aria-label={tr('reasons.activeLabel', { label: nameOf(r) })}
                          onCheckedChange={(next) => {
                            setBusyId(r.id);
                            void run(() => returnsClient.updateReason(r.id, { isActive: next })).finally(() =>
                              setBusyId(null),
                            );
                          }}
                        />
                      </TableCell>
                      {canWrite ? (
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={tr('reasons.edit', { label: nameOf(r) })}
                            onClick={(event) => {
                              status.clear();
                              editReturnRef.current = event.currentTarget;
                              setDialog({ reason: r });
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
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
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {canWrite && dialog ? (
        <ReasonDialog
          reason={dialog.reason}
          finalFocusRef={dialog.reason ? editReturnRef : removalFocus.createRef}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            const created = dialog.reason === null;
            await refresh();
            setDialog(null);
            status.show(tr(created ? 'reasons.added' : 'reasons.saved'));
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
interface ReasonDialogProps {
  /** `null` creates a reason; a reason is edited in place. */
  reason: ReturnReasonDto | null;
  /** Focused when the dialog closes: the action that opened it. */
  finalFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/**
 * The reason form — a label per shipped language, what it applies to and its weight, so
 * a dialog rather than a route (DS-05). One label in either language is enough: the
 * storefront shows the buyer's language, else English, else the other one. A missing
 * label is refused at the first field; the server's refusal stays in the dialog with
 * what was typed kept (Peak-End).
 */
function ReasonDialog({ reason, finalFocusRef, onClose, onSaved }: ReasonDialogProps): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const formId = useId();
  const [label, setLabel] = useState<NameDraft>(() => nameDraft(reason?.label));
  const [appliesTo, setAppliesTo] = useState<string>(reason?.appliesTo ?? 'both');
  const [weight, setWeight] = useState(reason?.weight ?? 100);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldLabel: NameDraft = { en: tr('reasons.field.labelEn'), pl: tr('reasons.field.labelPl') };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    if (!primaryName(label)) {
      setLabelError(tr('reasons.validation.labelRequired'));
      return;
    }
    setLabelError(null);
    setSaving(true);
    try {
      const body = { label: mergeNames(reason?.label, label), appliesTo, weight };
      if (reason) await returnsClient.updateReason(reason.id, body);
      else await returnsClient.createReason(body);
      await onSaved();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={reason ? tr('reasons.editTitle') : tr('reasons.newTitle')}
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
            {reason ? t('common.action.save') : tr('reasons.add')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        {SUPPORTED_LANGUAGES.map((lang, index) => (
          <FormField
            key={lang}
            label={fieldLabel[lang]}
            // The pair is required, not each field: the refusal is said at the first one.
            error={index === 0 ? labelError : null}
            {...(index === SUPPORTED_LANGUAGES.length - 1 ? { hint: tr('reasons.field.labelHint') } : {})}
          >
            <Input
              lang={lang}
              value={label[lang]}
              maxLength={200}
              onChange={(e) => {
                const value = e.target.value;
                setLabel((prev) => ({ ...prev, [lang]: value }));
                if (labelError) setLabelError(null);
              }}
            />
          </FormField>
        ))}
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, XCircle } from 'lucide-react';
import { ApiError, apiClient, formatDateTime, formatMoney } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  FormField,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { DetailHeaderActions, ModalDialog, RowActionMenuItem } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  cartApprovalStatusLabels,
  cartAuditActionLabels,
  cartAuditActorLabels,
  cartRejectedByLabel,
  cartStateLabel,
  cartStatusLabels,
} from '../lib/labels.js';

/**
 * CartDetail (feature 027 US6).
 *
 * Read-only cart detail + audit feed + emergency Reject action.
 *
 * Issue #1548 (UX audit 2026-11-17, SALES-26): *Reject* is an entry of the
 * header's "More" menu (`DetailHeaderActions`) — a destructive action sits in a
 * menu, away from the content, and is confirmed — and it opens a `ModalDialog`
 * holding the required reason. It used to be a card of its own toggling an
 * inline form between the lines and the history. The result is said by the
 * header's `InlineStatus`; a refusal stays inside the dialog.
 */

/** The longest reason the admin route accepts (`adminRejectCartSchema`). */
const REJECT_REASON_MAX_LENGTH = 2000;

interface AdminCartLine {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
}

interface AdminCartDetail {
  id: string;
  ownerDisplayName: string | null;
  organizationDisplayName: string | null;
  salesChannelCode: string | null;
  status: string;
  approvalStatus: string;
  items: AdminCartLine[];
  /** The net after the discount (issue #1396). */
  total: { amount: number; currency: string };
  /** What the buyer pays after the discount; `null` when a rate is unresolved (issue #1396). */
  totalGross?: { amount: number; currency: string } | null;
  discount: { code: string | null; amount: number; currency: string } | null;
  appliedPromotionCode: string | null;
  lastActivityAt: string;
  createdAt: string;
  convertedToQuoteRequestId: string | null;
  submittedForApprovalAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedByActor: string | null;
  rejectedReason: string | null;
}

interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: string;
  actorDisplayName: string | null;
  action: string;
  fromState: string | null;
  toState: string | null;
  reason: string | null;
}

type DetailError = { text: string } | { key: 'carts.detail.loadFailed' };

export default function CartDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const t = useTranslation('carts');
  const [cart, setCart] = useState<AdminCartDetail | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DetailError | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const actionStatus = useInlineStatus();
  // Where focus goes once the cart is rejected: the "More" menu that opened the
  // dialog leaves with the cart's last action, so focus lands on the reason now
  // recorded in the summary instead of falling to `body` (WCAG 2.4.3). Only on
  // success — on Cancel focus returns to "More", even on a cart that already
  // carries an approver's rejection reason. The dialog reads its
  // `finalFocusRef` as it unmounts, in the commit that renders the rejected
  // cart, so the getter resolves the reason's element only then.
  const rejectionRef = useRef<HTMLDivElement>(null);
  const rejectSucceededRef = useRef(false);
  const afterRejectFocusRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current(): HTMLElement | null {
        return rejectSucceededRef.current ? rejectionRef.current : null;
      },
    }),
    [],
  );

  /** `initial` replaces the screen with the loading line; a refresh after an action keeps it in place. */
  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
    if (!id) return;
    if (mode === 'initial') setLoading(true);
    setError(null);
    try {
      const [detail, auditRes] = await Promise.all([
        apiClient.get<{ data: AdminCartDetail }>(`/api/v1/admin/carts/${id}`),
        apiClient.get<{ data: AuditRow[] }>(`/api/v1/admin/carts/${id}/audit`),
      ]);
      setCart(detail.data);
      setAudit(Array.isArray(auditRes.data) ? auditRes.data : []);
    } catch (err) {
      setError(err instanceof ApiError ? { text: err.envelope.error.message } : { key: 'carts.detail.loadFailed' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Posts the rejection and refreshes the screen with the dialog still open
   * (busy), so the dialog closes onto the rejected cart and can hand focus to
   * the recorded reason. Throws when the server refuses, for the dialog to say.
   */
  const reject = useCallback(
    async (reason: string): Promise<void> => {
      if (!id) return;
      actionStatus.clear();
      await apiClient.post(`/api/v1/admin/carts/${id}/reject`, { reason });
      await load('refresh');
      rejectSucceededRef.current = true;
      setRejectOpen(false);
      actionStatus.show(t('carts.reject.done'));
    },
    [id, load, actionStatus, t],
  );

  // The server's message when it sent one, the catalogue's otherwise — resolved
  // here, at render, so the screen follows a language switch.
  const errorText = error === null ? null : 'text' in error ? error.text : t(error.key);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('carts.loading')}</p>;
  }
  if (!cart) {
    return <Alert variant="destructive"><AlertDescription>{errorText ?? t('carts.detail.notFound')}</AlertDescription></Alert>;
  }

  const isTerminal = cart.status === 'completed' || cart.status === 'rejected';
  const rejectedBy = cartRejectedByLabel(t, cart.rejectedByActor);

  return (
    <>
      {/* Issue #1477 — the owner and the organization, not the cart's UUID. */}
      <PageHeader
        title={t('carts.detail.title')}
        description={[cart.ownerDisplayName ?? t('carts.owner.anonymous'), cart.organizationDisplayName]
          .filter((part): part is string => part !== null)
          .join(' · ')}
        actions={
          // Issue #1548 — no primary: the screen is read-only, and its one action is destructive.
          <DetailHeaderActions status={actionStatus.props}>
            {!isTerminal ? (
              <RowActionMenuItem
                destructive
                onSelect={(): void => {
                  rejectSucceededRef.current = false;
                  setRejectOpen(true);
                }}
              >
                <XCircle aria-hidden="true" />
                {t('carts.reject.open')}
              </RowActionMenuItem>
            ) : null}
          </DetailHeaderActions>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-sm">
            <div><Label>{t('carts.column.status')}</Label><Badge>{cartStatusLabels.label(t, cart.status)}</Badge></div>
            <div><Label>{t('carts.column.approval')}</Label><Badge>{cartApprovalStatusLabels.label(t, cart.approvalStatus)}</Badge></div>
            <div><Label>{t('carts.column.owner')}</Label><span>{cart.ownerDisplayName ?? t('carts.owner.anonymous')}</span></div>
            <div><Label>{t('carts.column.org')}</Label><span>{cart.organizationDisplayName ?? '—'}</span></div>
            <div><Label>{t('carts.column.lastActivity')}</Label><span>{formatDateTime(cart.lastActivityAt)}</span></div>
            <div><Label>{t('carts.column.created')}</Label><span>{formatDateTime(cart.createdAt)}</span></div>
            {cart.appliedPromotionCode ? (
              <div><Label>{t('carts.column.coupon')}</Label><Badge variant="secondary">{cart.appliedPromotionCode}</Badge></div>
            ) : null}
            {cart.convertedToQuoteRequestId ? (
              <div><Label>{t('carts.column.convertedToQr')}</Label><span className="font-mono text-xs">{cart.convertedToQuoteRequestId.slice(0, 8)}</span></div>
            ) : null}
            {cart.rejectedReason ? (
              <div
                ref={rejectionRef}
                tabIndex={-1}
                data-testid="cart-rejection"
                className="col-span-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:col-span-4"
              >
                <Label>{t('carts.column.rejectedReason')}</Label>
                <p className="text-sm">
                  {cart.rejectedReason}
                  {rejectedBy ? <span className="text-muted-foreground text-xs"> — {rejectedBy}</span> : null}
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <h2 className="font-semibold mb-2">{t('carts.detail.lines')}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('carts.column.product')}</TableHead>
                <TableHead>{t('carts.column.qty')}</TableHead>
                <TableHead>{t('carts.column.unit')}</TableHead>
                <TableHead>{t('carts.column.line')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cart.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.productName}</TableCell>
                  <TableCell className="tabular-nums">{it.quantity}</TableCell>
                  <TableCell className="tabular-nums">{formatMoney(it.unitPrice.amount, it.unitPrice.currency, undefined, { unitPrice: true })}</TableCell>
                  <TableCell className="tabular-nums">{formatMoney(it.lineTotal.amount, it.lineTotal.currency)}</TableCell>
                </TableRow>
              ))}
              {cart.discount && cart.discount.amount > 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-muted-foreground">
                    {t('carts.column.discount')}
                  </TableCell>
                  <TableCell className="tabular-nums text-ok">
                    −{formatMoney(cart.discount.amount, cart.discount.currency)}
                  </TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                <TableCell colSpan={3} className="text-right">{t('carts.detail.netTotal')}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(cart.total.amount, cart.total.currency)}</TableCell>
              </TableRow>
              {cart.totalGross ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">{t('carts.detail.grossTotal')}</TableCell>
                  <TableCell className="tabular-nums font-semibold">
                    {formatMoney(cart.totalGross.amount, cart.totalGross.currency)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="font-semibold mb-2">{t('carts.detail.audit')}</h2>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('carts.detail.auditEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('carts.audit.when')}</TableHead>
                  <TableHead>{t('carts.audit.who')}</TableHead>
                  <TableHead>{t('carts.audit.action')}</TableHead>
                  <TableHead>{t('carts.audit.transition')}</TableHead>
                  <TableHead>{t('carts.audit.reason')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{formatDateTime(row.occurredAt)}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-muted-foreground">{cartAuditActorLabels.label(t, row.actorType)}</span>
                      {row.actorDisplayName ? ` · ${row.actorDisplayName}` : ''}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{cartAuditActionLabels.label(t, row.action)}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {cartStateLabel(t, row.fromState)} → {cartStateLabel(t, row.toState)}
                    </TableCell>
                    <TableCell className="text-xs">{row.reason ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {rejectOpen ? (
        <RejectCartDialog
          onReject={reject}
          onClose={(): void => setRejectOpen(false)}
          finalFocusRef={afterRejectFocusRef}
        />
      ) : null}
    </>
  );
}

/**
 * The reason for a rejection, asked in the kit's dialog (issue #1548). The
 * reason is required — the buyer reads it — so an empty one is refused on
 * submit with an error linked to the field rather than by a disabled button
 * that does not say why. The scrim does not close it, so a stray click keeps a
 * typed reason; a refusal from the server is announced inside the dialog.
 */
function RejectCartDialog(props: {
  onReject: (reason: string) => Promise<void>;
  onClose: () => void;
  finalFocusRef: RefObject<HTMLElement | null>;
}): ReactNode {
  const t = useTranslation('carts');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const submit = async (): Promise<void> => {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setMissing(true);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await props.onReject(trimmed);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.envelope.error.message : t('carts.detail.rejectFailed'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('carts.reject.title')}
      onClose={props.onClose}
      busy={busy}
      dismissOnScrim={false}
      initialFocusRef={reasonRef}
      finalFocusRef={props.finalFocusRef}
      widthClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={props.onClose} disabled={busy}>
            {t('carts.reject.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={(): void => void submit()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
            ) : (
              <XCircle aria-hidden="true" />
            )}
            {t('carts.reject.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('carts.reject.message')}</p>
        <FormField
          label={t('carts.reject.reasonLabel')}
          required
          error={missing ? t('carts.reject.reasonRequired') : undefined}
        >
          <Textarea
            ref={reasonRef}
            value={reason}
            onChange={(e): void => {
              setReason(e.target.value);
              if (missing && e.target.value.trim().length > 0) setMissing(false);
            }}
            placeholder={t('carts.reject.reasonPlaceholder')}
            maxLength={REJECT_REASON_MAX_LENGTH}
            rows={3}
            disabled={busy}
          />
        </FormField>
        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p role="alert" className="text-destructive">
          {failure}
        </p>
      </div>
    </ModalDialog>
  );
}

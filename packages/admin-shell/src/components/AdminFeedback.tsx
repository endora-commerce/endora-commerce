import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import {
  ADMIN_FEEDBACK_ERROR_CODES,
  ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH,
  AdminFeedbackRequestSchema,
  adminFeedbackPhoneSchema,
} from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { sendAdminFeedback } from '../lib/admin-feedback/api.js';
import { useTranslationContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Textarea,
} from '@endora-commerce/admin-kit/ui';

/** Where an administrator can write when the form cannot send. */
const SUPPORT_EMAIL = 'support@endora.software';

type Field = 'message' | 'email' | 'phone';
type Outcome = 'notConfigured' | 'rateLimited' | 'delivery';

/** What a failure of the send says, by what the instance answered. */
function outcomeOf(failure: unknown): Outcome {
  if (failure instanceof ApiError) {
    if (failure.envelope.error.code === ADMIN_FEEDBACK_ERROR_CODES.NOT_CONFIGURED) return 'notConfigured';
    if (failure.status === 429) return 'rateLimited';
  }
  return 'delivery';
}

/**
 * *Send feedback* — the sidebar's link beside the release, and the dialog it
 * opens (issue #379). Rendered by the shell only while the `admin_feedback`
 * module is present: that module owns the endpoint, and switching it off is how
 * an operator keeps feedback from leaving the instance.
 *
 * The dialog asks for the words (required), the sender's address — the
 * signed-in administrator's, which they may change — and an optional phone.
 * The release, the instance's addresses and who sent it are the instance's to
 * add; nobody types them. Each field is checked when *Send* is pressed, the
 * first one wrong takes the focus, and its sentence is tied to it.
 *
 * Every way a send ends is said in the dialog: thanks, or what went wrong —
 * sending switched off here, too many sent, the message not delivered — always
 * with the support address to write to by hand, and with what was typed kept.
 */
export function AdminFeedback(props: { rail: boolean }): ReactNode {
  const t = useTranslation('core');
  const [open, setOpen] = useState(false);
  const label = t('appShell.feedback.open');

  return (
    <>
      <button
        type="button"
        className={props.rail ? 'b2b-sidebar__search-rail b2b-sidebar__feedback-rail' : 'b2b-sidebar__feedback'}
        aria-haspopup="dialog"
        {...(props.rail ? { 'aria-label': label, title: label } : {})}
        onClick={(): void => setOpen(true)}
      >
        <MessageSquare aria-hidden="true" size={props.rail ? 16 : 12} />
        {props.rail ? null : <span>{label}</span>}
      </button>
      {/* Into the page's body, not the sidebar's subtree: the sidebar sets the
          light text of its dark panel, and on a phone it is a drawer moved
          with `transform`, which makes it the box a `fixed` dialog is placed
          in — a dialog drawn inside it was faint and squeezed into the drawer. */}
      {open ? createPortal(<AdminFeedbackDialog onClose={(): void => setOpen(false)} />, document.body) : null}
    </>
  );
}

function AdminFeedbackDialog(props: { onClose: () => void }): ReactNode {
  const t = useTranslation('core');
  const { me } = useAuth();
  // The language the shell renders in — what the command palette searches in too.
  const { language } = useTranslationContext();
  const baseId = useId();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(me?.adminUser.email ?? '');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Outcome | null>(null);
  const [sent, setSent] = useState(false);

  const id = (field: Field): string => `${baseId}-${field}`;
  const errorId = (field: Field): string => `${baseId}-${field}-error`;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const next: Partial<Record<Field, string>> = {};
    if (message.trim() === '') next.message = t('appShell.feedback.error.message');
    if (!AdminFeedbackRequestSchema.shape.email.safeParse(email).success) next.email = t('appShell.feedback.error.email');
    if (!adminFeedbackPhoneSchema.safeParse(phone).success) next.phone = t('appShell.feedback.error.phone');
    setErrors(next);
    if (next.message || next.email || next.phone) {
      (next.message ? messageRef : next.email ? emailRef : phoneRef).current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await sendAdminFeedback({
        message: message.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        adminUrl: window.location.origin,
        language,
      });
      setSent(true);
    } catch (caught) {
      setFailure(outcomeOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const fieldProps = (field: Field) => ({
    id: id(field),
    'aria-invalid': errors[field] !== undefined,
    ...(errors[field] ? { 'aria-describedby': errorId(field) } : {}),
  });
  const fieldError = (field: Field): ReactNode =>
    errors[field] ? (
      <p id={errorId(field)} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;

  if (sent) {
    return (
      <ModalDialog
        title={t('appShell.feedback.title')}
        onClose={props.onClose}
        footer={
          <Button type="button" className="min-h-11 sm:min-h-9" onClick={props.onClose}>
            {t('common.action.close')}
          </Button>
        }
      >
        <p role="status" className="text-sm">
          {t('appShell.feedback.sent')}
        </p>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog
      title={t('appShell.feedback.title')}
      onClose={props.onClose}
      busy={busy}
      initialFocusRef={messageRef}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={busy}
            onClick={props.onClose}
          >
            {t('common.action.cancel')}
          </Button>
          <Button
            type="submit"
            form={`${baseId}-form`}
            className="min-h-11 sm:min-h-9"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t('appShell.feedback.sending') : t('appShell.feedback.send')}
          </Button>
        </>
      }
    >
      <form id={`${baseId}-form`} noValidate className="space-y-4" onSubmit={(event): void => void submit(event)}>
        <p className="text-sm text-muted-foreground">{t('appShell.feedback.intro')}</p>
        {failure ? (
          <Alert variant="destructive">
            <AlertDescription>{t(`appShell.feedback.error.${failure}`, { email: SUPPORT_EMAIL })}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={id('message')}>
            {t('appShell.feedback.message')}
            <span aria-hidden="true" className="text-destructive">
              {' *'}
            </span>
          </Label>
          <Textarea
            ref={messageRef}
            {...fieldProps('message')}
            rows={6}
            required
            maxLength={ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH}
            value={message}
            disabled={busy}
            onChange={(event): void => setMessage(event.target.value)}
          />
          {fieldError('message')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={id('email')}>{t('appShell.feedback.email')}</Label>
            <Input
              ref={emailRef}
              {...fieldProps('email')}
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={busy}
              onChange={(event): void => setEmail(event.target.value)}
            />
            {fieldError('email')}
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('phone')}>{t('appShell.feedback.phone')}</Label>
            <Input
              ref={phoneRef}
              {...fieldProps('phone')}
              type="tel"
              autoComplete="tel"
              value={phone}
              disabled={busy}
              onChange={(event): void => setPhone(event.target.value)}
            />
            {fieldError('phone')}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('appShell.feedback.context')}</p>
      </form>
    </ModalDialog>
  );
}

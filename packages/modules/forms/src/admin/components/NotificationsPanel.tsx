import { useEffect, useId, useState, type ReactNode } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { FORMS_LIMITS, type FormDefinition, type FormDetail } from '@endora-commerce/contracts';
import { SalesChannelPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, Checkbox, Label, Separator, Textarea } from '@endora-commerce/admin-kit/ui';
import { formsApi } from '../api.js';
import { errorMessage } from '../lib/errors.js';
import { PanelSection } from './PanelSection.js';
import { TranslatableText } from './TranslatableText.js';

/**
 * The builder's *Notifications* tab (`specs/170-forms-module/` User Story 5; FR-056 – FR-058, A-2,
 * contracts/admin-surfaces.md §4): one card with two sections that are saved differently, and say so:
 *
 * - **Recipients** — the default list and a list per sales channel, which *replaces* the default on
 *   that channel. Live settings of the form: saved on their own with *Save recipients*
 *   (`PUT …/notifications`, naming the revision) and in effect for the next entry without a publish.
 *   Checked here before the call — at most ten addresses a list, each an address, a channel chosen
 *   once per list — and by the server, whose refusal is shown as it arrives.
 * - **The confirmation e-mail** — part of the form's definition: the switch, the summary and the
 *   subject and text edit the builder's draft, saved and published with the form like every other
 *   text of it.
 *
 * The subject and text are the builder's content language's (User Story 7). In another language
 * than the default only they are editable — the recipients and the switches are locked there — and
 * an empty one shows the default language's as its placeholder.
 *
 * Principle IX: admin-kit's `Card`, `Section`, `Textarea`, `Checkbox` and `SalesChannelPicker` —
 * one address per line in a labelled text area is the plainest control that holds ten addresses and
 * is operable with the keyboard alone; no new primitive.
 */

export interface NotificationsPanelProps {
  readonly form: FormDetail;
  /** The builder's draft — the confirmation e-mail is part of it. */
  readonly definition: FormDefinition;
  /** The content language whose texts are edited; defaults to the form's default language. */
  readonly language?: string;
  readonly defaultLanguage: string;
  readonly disabled: boolean;
  readonly onDefinitionChange: (next: FormDefinition) => void;
  /** The form as the server answered a recipients save (a new revision). */
  readonly onSaved: (detail: FormDetail) => void;
}

interface ChannelRow {
  readonly key: string;
  readonly channelId: string | null;
  readonly text: string;
}

type ListError = { readonly code: 'invalid'; readonly address: string } | { readonly code: 'tooMany' };
type RowError = ListError | { readonly code: 'noChannel' } | { readonly code: 'duplicateChannel' };

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One address per line (commas and semicolons tolerated), blanks dropped. */
function addressesOf(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function listError(addresses: readonly string[]): ListError | null {
  const invalid = addresses.find((address) => !ADDRESS.test(address));
  if (invalid !== undefined) return { code: 'invalid', address: invalid };
  if (addresses.length > FORMS_LIMITS.recipients) return { code: 'tooMany' };
  return null;
}

let rowCounter = 0;
const rowKey = (): string => `row-${(rowCounter += 1)}`;

function rowsOf(form: FormDetail): ChannelRow[] {
  return Object.entries(form.channelRecipients).map(([channelId, list]) => ({ key: rowKey(), channelId, text: list.join('\n') }));
}

export function NotificationsPanel(props: NotificationsPanelProps): ReactNode {
  const { form, definition, defaultLanguage, onDefinitionChange } = props;
  const language = props.language ?? defaultLanguage;
  const translating = language !== defaultLanguage;
  // The recipients and the switches are not texts: edited in the default language only.
  const disabled = props.disabled || translating;
  const t = useTranslation('forms');
  const id = useId();

  const [recipients, setRecipients] = useState(() => form.recipients.join('\n'));
  const [rows, setRows] = useState<ChannelRow[]>(() => rowsOf(form));
  const [errors, setErrors] = useState<{ default: ListError | null; rows: Record<string, RowError> } | null>(null);
  const [tooManyRows, setTooManyRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // A recipients save answers a new revision; the lists shown are the server's afterwards.
  useEffect(() => {
    setRecipients(form.recipients.join('\n'));
    setRows(rowsOf(form));
  }, [form.id, form.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const errorText = (error: RowError): string => {
    switch (error.code) {
      case 'invalid':
        return t('notifications.recipients.error.invalid', { address: error.address });
      case 'tooMany':
        return t('notifications.recipients.error.tooMany', { max: FORMS_LIMITS.recipients });
      case 'noChannel':
        return t('notifications.recipients.error.noChannel');
      case 'duplicateChannel':
        return t('notifications.recipients.error.duplicateChannel');
    }
  };

  const save = async (): Promise<void> => {
    setStatus(null);
    setFailure(null);
    const defaults = addressesOf(recipients);
    const rowErrors: Record<string, RowError> = {};
    const seen = new Set<string>();
    const channelRecipients: Record<string, string[]> = {};
    for (const row of rows) {
      const addresses = addressesOf(row.text);
      const error: RowError | null =
        row.channelId === null
          ? { code: 'noChannel' }
          : seen.has(row.channelId)
            ? { code: 'duplicateChannel' }
            : listError(addresses);
      if (error) rowErrors[row.key] = error;
      if (row.channelId !== null) {
        seen.add(row.channelId);
        channelRecipients[row.channelId] = addresses;
      }
    }
    const defaultError = listError(defaults);
    const rowLimit = rows.length > FORMS_LIMITS.channelOverrides;
    setTooManyRows(rowLimit);
    if (defaultError || Object.keys(rowErrors).length > 0 || rowLimit) {
      setErrors({ default: defaultError, rows: rowErrors });
      return;
    }
    setErrors(null);
    setSaving(true);
    try {
      const saved = await formsApi.notifications(form.id, { expectedRevision: form.revision, recipients: defaults, channelRecipients });
      props.onSaved(saved);
      setStatus(t('notifications.recipients.saved'));
    } catch (error) {
      setFailure(errorMessage(error, t('builder.error')));
    } finally {
      setSaving(false);
    }
  };

  const updateRow = (key: string, change: Partial<ChannelRow>): void =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const confirmationEmail = definition.behaviour.confirmationEmail;
  const setConfirmation = (change: Partial<typeof confirmationEmail>): void =>
    onDefinitionChange({
      ...definition,
      behaviour: { ...definition.behaviour, confirmationEmail: { ...confirmationEmail, ...change } },
    });
  const hasSubmitterField = definition.sections.some((section) =>
    section.fields.some((field) => field.type === 'email' && field.submitterEmail),
  );

  const defaultErrorId = `${id}-default-error`;
  const hintId = `${id}-hint`;

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {translating ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{t('language.lockedShort', { language: defaultLanguage })}</span>
          </p>
        ) : null}

        <PanelSection titleId={`${id}-recipients`} title={t('notifications.recipients.title')} description={t('notifications.recipients.description')}>
          <div className="max-w-2xl space-y-5">
            <div className="space-y-1">
              <Label htmlFor={`${id}-default`}>{t('notifications.recipients.default')}</Label>
              <Textarea
                id={`${id}-default`}
                rows={4}
                value={recipients}
                disabled={disabled}
                aria-invalid={errors?.default ? true : undefined}
                aria-describedby={errors?.default ? `${hintId} ${defaultErrorId}` : hintId}
                onChange={(event) => setRecipients(event.target.value)}
              />
              <p id={hintId} className="text-xs text-muted-foreground">
                {t('notifications.recipients.hint', { max: FORMS_LIMITS.recipients })}
              </p>
              {errors?.default ? (
                <p id={defaultErrorId} className="text-sm text-destructive">
                  {errorText(errors.default)}
                </p>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">{t('notifications.recipients.channels')}</h3>
                <p className="text-xs text-muted-foreground">{t('notifications.recipients.channelsHint')}</p>
              </div>
              {rows.map((row, index) => {
                const error = errors?.rows[row.key];
                const errorId = `${id}-${row.key}-error`;
                return (
                  <fieldset
                    key={row.key}
                    aria-label={t('notifications.recipients.channelRow', { number: index + 1 })}
                    className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
                  >
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-${row.key}-channel`}>{t('notifications.recipients.channel')}</Label>
                      <SalesChannelPicker
                        id={`${id}-${row.key}-channel`}
                        value={row.channelId}
                        disabled={disabled}
                        ariaLabel={t('notifications.recipients.channel')}
                        onChange={(channelId) => updateRow(row.key, { channelId })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-${row.key}-list`}>{t('notifications.recipients.channelList')}</Label>
                      <Textarea
                        id={`${id}-${row.key}-list`}
                        rows={3}
                        value={row.text}
                        disabled={disabled}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        onChange={(event) => updateRow(row.key, { text: event.target.value })}
                      />
                    </div>
                    {error ? (
                      <p id={errorId} className="text-sm text-destructive">
                        {errorText(error)}
                      </p>
                    ) : null}
                    {disabled ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t('notifications.recipients.removeChannel')}
                      </Button>
                    )}
                  </fieldset>
                );
              })}
              {tooManyRows ? (
                <p className="text-sm text-destructive">
                  {t('notifications.recipients.error.tooManyChannels', { max: FORMS_LIMITS.channelOverrides })}
                </p>
              ) : null}
              {disabled ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rows.length >= FORMS_LIMITS.channelOverrides}
                  onClick={() => setRows((current) => [...current, { key: rowKey(), channelId: null, text: '' }])}
                >
                  <Plus size={14} aria-hidden="true" />
                  {t('notifications.recipients.addChannel')}
                </Button>
              )}
            </div>

            {failure ? (
              <Alert variant="destructive">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {disabled ? null : (
                <Button type="button" variant="outline" disabled={saving} aria-busy={saving || undefined} onClick={() => void save()}>
                  {saving ? t('notifications.recipients.saving') : t('notifications.recipients.save')}
                </Button>
              )}
              <p role="status" className="text-sm text-muted-foreground">
                {status}
              </p>
            </div>
          </div>
        </PanelSection>

        <Separator />

        <PanelSection
          titleId={`${id}-confirmation`}
          title={t('notifications.confirmation.title')}
          description={t('notifications.confirmation.description')}
        >
          <div className="max-w-2xl space-y-4">
            {hasSubmitterField ? null : (
              <Alert>
                <AlertDescription>{t('notifications.confirmation.noSubmitterField')}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <div className="flex min-h-9 items-center gap-2">
                <Checkbox
                  id={`${id}-enabled`}
                  checked={confirmationEmail.enabled}
                  disabled={disabled}
                  onChange={(event) => setConfirmation({ enabled: event.target.checked })}
                />
                <Label htmlFor={`${id}-enabled`} className="font-normal">
                  {t('notifications.confirmation.enabled')}
                </Label>
              </div>
              <div className="flex min-h-9 items-center gap-2 pl-6">
                <Checkbox
                  id={`${id}-summary`}
                  checked={confirmationEmail.includeSummary}
                  disabled={disabled || !confirmationEmail.enabled}
                  onChange={(event) => setConfirmation({ includeSummary: event.target.checked })}
                />
                <Label htmlFor={`${id}-summary`} className="font-normal">
                  {t('notifications.confirmation.summary')}
                </Label>
              </div>
            </div>
            <TranslatableText
              id={`${id}-subject`}
              label={t('notifications.confirmation.subject')}
              definition={definition}
              language={language}
              defaultLanguage={defaultLanguage}
              textId="email.confirmation.subject"
              maxLength={FORMS_LIMITS.nameChars}
              disabled={props.disabled}
              onChange={onDefinitionChange}
              {...(translating ? {} : { describedBy: `${id}-built-in` })}
            />
            <TranslatableText
              id={`${id}-body`}
              label={t('notifications.confirmation.body')}
              definition={definition}
              language={language}
              defaultLanguage={defaultLanguage}
              textId="email.confirmation.body"
              rows={6}
              disabled={props.disabled}
              onChange={onDefinitionChange}
              {...(translating ? {} : { describedBy: `${id}-built-in` })}
            />
            {translating ? null : (
              <p id={`${id}-built-in`} className="text-xs text-muted-foreground">
                {t('notifications.confirmation.builtInHint')}
              </p>
            )}
          </div>
        </PanelSection>
      </CardContent>
    </Card>
  );
}

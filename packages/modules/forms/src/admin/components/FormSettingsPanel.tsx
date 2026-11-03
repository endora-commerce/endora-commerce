import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FORMS_LIMITS, type FormDefinition, type FormDetail, type FormRestrictions } from '@endora-commerce/contracts';
import { CmsPagePicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { Lock } from 'lucide-react';
import { Alert, AlertDescription, Button, Card, CardContent, Checkbox, Input, Label, Separator } from '@endora-commerce/admin-kit/ui';
import { formsApi } from '../api.js';
import { errorMessage } from '../lib/errors.js';
import { PanelSection } from './PanelSection.js';
import { TranslatableText } from './TranslatableText.js';

/**
 * The builder's *Settings* tab (`specs/170-forms-module/` User Story 6; FR-038, FR-042, FR-043,
 * contracts/admin-surfaces.md §4): one card of plain sections. Three groups edit the builder's
 * draft — saved and published with the form like every other part of it:
 *
 * - **After sending** — a message (the operator's, in the default language; the built-in thanks
 *   when empty), another address, or a CMS page. The page picker is admin-kit's `CmsPagePicker` and
 *   is offered **only while `cms` is present**; without it a note says the message stands in, as the
 *   storefront then shows it (FR-038's fallback).
 * - **Restrictions** — the maximum number of entries, the availability window (entered in the
 *   operator's time zone, stored as instants) and signed-in customers only, each with the message the
 *   block shows while it stops the form, in the default language. A value the server would refuse
 *   (a maximum out of range, an end before the start) is marked inline and not written to the draft.
 * - **Spam protection** — the CAPTCHA switch. While the form asks for a check and no provider is set
 *   up (the form's `captcha_not_configured` warning), it says so with a way to `/settings`, where the
 *   provider and its keys are configured (research R-23). Never a reason to refuse a publish.
 *
 * - **Retention** (User Story 9, FR-054) — how long entries are kept. Unlike the rest of the tab it
 *   is **live** and saved on its own (`PUT …/retention`), like the recipients: the next maintenance
 *   run deletes by it, without a publish. Before a period is saved the panel asks how many entries
 *   it would delete and, if any, says so and saves only once that is confirmed — the deletion cannot
 *   be undone. It needs `forms:entries_write` (else read-only with a note), and the server refuses a
 *   scoped administrator with `FORM_SCOPE_REQUIRED`, whose sentence is shown as it arrives.
 *
 * The texts here are the builder's content language's (User Story 7): in another language than the
 * default only they are editable, every other setting is locked there (the default language's), so
 * one structure serves every language; an empty text shows the default one as its placeholder.
 * Principle IX: admin-kit's `Card`, `Section`, `Input`, `Textarea`, `Checkbox`, `Alert`, `Button`
 * and `CmsPagePicker`; the confirmation choice is native radios in a labelled group, the precedent
 * of other modules.
 */

export interface FormSettingsPanelProps {
  readonly form: FormDetail;
  /** The builder's draft. */
  readonly definition: FormDefinition;
  /** The content language whose texts are edited; defaults to the form's default language. */
  readonly language?: string;
  readonly defaultLanguage: string;
  readonly disabled: boolean;
  readonly onDefinitionChange: (next: FormDefinition) => void;
  /** The form as a live write (retention) left it — its revision is the next write's. */
  readonly onSaved: (detail: FormDetail) => void;
}

const MAX_ENTRIES = 1_000_000;
const ABSOLUTE_URL = /^https?:\/\/[^\s/]+\S*$/i;

/** An instant as a `datetime-local` value in the operator's time zone. */
function localValueOf(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value as an instant; empty is no bound. */
function instantOf(local: string): string | null | undefined {
  if (local === '') return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseMaxEntries(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_ENTRIES ? value : undefined;
}

type Confirmation = FormDefinition['behaviour']['confirmation'];

export function FormSettingsPanel(props: FormSettingsPanelProps): ReactNode {
  const { form, definition, defaultLanguage, onDefinitionChange } = props;
  const language = props.language ?? defaultLanguage;
  const translating = language !== defaultLanguage;
  // Every setting but a text is the structure's, edited in the default language only.
  const disabled = props.disabled || translating;
  const textsDisabled = props.disabled;
  const t = useTranslation('forms');
  const id = useId();
  const { isPresent } = useModulePresence();
  const cmsPresent = isPresent('cms');

  const restrictions = definition.restrictions;
  const confirmation = definition.behaviour.confirmation;
  const [maxEntries, setMaxEntries] = useState(() => (restrictions.maxEntries === null ? '' : String(restrictions.maxEntries)));
  const [from, setFrom] = useState(() => localValueOf(restrictions.availableFrom));
  const [until, setUntil] = useState(() => localValueOf(restrictions.availableUntil));

  const maxEntriesValue = parseMaxEntries(maxEntries);
  const fromValue = instantOf(from);
  const untilValue = instantOf(until);
  const windowInvalid =
    typeof fromValue === 'string' && typeof untilValue === 'string' && Date.parse(untilValue) <= Date.parse(fromValue);

  const setRestrictions = (change: Partial<FormRestrictions>): void =>
    onDefinitionChange({ ...definition, restrictions: { ...restrictions, ...change } });
  const setConfirmation = (next: Confirmation): void =>
    onDefinitionChange({ ...definition, behaviour: { ...definition.behaviour, confirmation: next } });

  const changeWindow = (bound: 'from' | 'until', raw: string): void => {
    if (bound === 'from') setFrom(raw);
    else setUntil(raw);
    const nextFrom = bound === 'from' ? instantOf(raw) : fromValue;
    const nextUntil = bound === 'until' ? instantOf(raw) : untilValue;
    if (nextFrom === undefined || nextUntil === undefined) return;
    // An end before the start is not written: the save would refuse it.
    if (nextFrom !== null && nextUntil !== null && Date.parse(nextUntil) <= Date.parse(nextFrom)) return;
    setRestrictions({ availableFrom: nextFrom, availableUntil: nextUntil });
  };

  const captchaUnconfigured =
    definition.behaviour.captchaRequired && form.warnings.some((warning) => warning.code === 'captcha_not_configured');
  const redirectInvalid = confirmation.type === 'redirect' && confirmation.url !== '' && !ABSOLUTE_URL.test(confirmation.url);
  const showsMessage = confirmation.type === 'message' || (confirmation.type === 'page' && !cmsPresent);

  const messageInput = (textId: string, labelKey: string, rows?: number, describedBy?: string): ReactNode => (
    <TranslatableText
      id={`${id}-${textId}`}
      label={t(labelKey)}
      definition={definition}
      language={language}
      defaultLanguage={defaultLanguage}
      textId={textId}
      disabled={textsDisabled}
      onChange={onDefinitionChange}
      {...(rows !== undefined ? { rows } : { maxLength: FORMS_LIMITS.singleLineChars })}
      {...(describedBy !== undefined ? { describedBy } : {})}
    />
  );

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {translating ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{t('language.lockedShort', { language: defaultLanguage })}</span>
          </p>
        ) : null}

        <PanelSection titleId={`${id}-confirmation`} title={t('settings.confirmation.title')} description={t('settings.confirmation.description')}>
          <div className="max-w-2xl space-y-4">
            <div
              role="radiogroup"
              aria-labelledby={`${id}-confirmation`}
              aria-describedby={`${id}-confirmation-description`}
              className="flex flex-wrap gap-2"
            >
              {(['message', 'redirect', 'page'] as const).map((type) => (
                <label
                  key={type}
                  htmlFor={`${id}-type-${type}`}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                >
                  <input
                    id={`${id}-type-${type}`}
                    type="radio"
                    name={`${id}-confirmation-type`}
                    value={type}
                    checked={confirmation.type === type}
                    disabled={disabled}
                    className="h-4 w-4 accent-primary"
                    onChange={() =>
                      setConfirmation(
                        type === 'message'
                          ? { type: 'message' }
                          : type === 'redirect'
                            ? { type: 'redirect', url: '' }
                            : { type: 'page', cmsPageId: '' },
                      )
                    }
                  />
                  {t(`settings.confirmation.${type}`)}
                </label>
              ))}
            </div>

            {confirmation.type === 'redirect' ? (
              <div className="space-y-1">
                <Label htmlFor={`${id}-url`}>{t('settings.confirmation.url')}</Label>
                <Input
                  id={`${id}-url`}
                  type="url"
                  inputMode="url"
                  value={confirmation.url}
                  maxLength={FORMS_LIMITS.pageUrlChars}
                  disabled={disabled}
                  aria-invalid={redirectInvalid ? true : undefined}
                  aria-describedby={redirectInvalid ? `${id}-url-hint ${id}-url-error` : `${id}-url-hint`}
                  onChange={(event) => setConfirmation({ type: 'redirect', url: event.target.value.trim() })}
                />
                <p id={`${id}-url-hint`} className="text-xs text-muted-foreground">
                  {t('settings.confirmation.urlHint')}
                </p>
                {redirectInvalid ? (
                  <p id={`${id}-url-error`} className="text-sm text-destructive">
                    {t('settings.confirmation.urlInvalid')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {confirmation.type === 'page' ? (
              cmsPresent ? (
                <div className="space-y-1">
                  <Label htmlFor={`${id}-page`}>{t('settings.confirmation.pageLabel')}</Label>
                  <CmsPagePicker
                    id={`${id}-page`}
                    value={confirmation.cmsPageId === '' ? null : confirmation.cmsPageId}
                    disabled={disabled}
                    ariaLabel={t('settings.confirmation.pageLabel')}
                    placeholder={t('settings.confirmation.pagePlaceholder')}
                    onChange={(pageId) => setConfirmation({ type: 'page', cmsPageId: pageId ?? '' })}
                  />
                </div>
              ) : (
                <Alert>
                  <AlertDescription>{t('settings.confirmation.cmsAbsent')}</AlertDescription>
                </Alert>
              )
            ) : null}

            {showsMessage ? (
              <div className="space-y-1">
                {messageInput('messages.success', 'settings.confirmation.messageText', 4, `${id}-success-hint`)}
                <p id={`${id}-success-hint`} className="text-xs text-muted-foreground">
                  {t('settings.confirmation.messageHint')}
                </p>
              </div>
            ) : null}
          </div>
        </PanelSection>

        <Separator />

        <PanelSection titleId={`${id}-restrictions`} title={t('settings.restrictions.title')} description={t('settings.restrictions.description')}>
          <div className="max-w-2xl space-y-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <div className="space-y-1">
                <Label htmlFor={`${id}-max`}>{t('settings.restrictions.maxEntries')}</Label>
                <Input
                  id={`${id}-max`}
                  inputMode="numeric"
                  value={maxEntries}
                  disabled={disabled}
                  aria-invalid={maxEntriesValue === undefined ? true : undefined}
                  aria-describedby={maxEntriesValue === undefined ? `${id}-max-hint ${id}-max-error` : `${id}-max-hint`}
                  onChange={(event) => {
                    setMaxEntries(event.target.value);
                    const parsed = parseMaxEntries(event.target.value);
                    if (parsed !== undefined) setRestrictions({ maxEntries: parsed });
                  }}
                />
                <p id={`${id}-max-hint`} className="text-xs text-muted-foreground">
                  {t('settings.restrictions.maxEntriesHint')}
                </p>
                {maxEntriesValue === undefined ? (
                  <p id={`${id}-max-error`} className="text-sm text-destructive">
                    {t('settings.restrictions.maxEntriesInvalid', { max: String(MAX_ENTRIES) })}
                  </p>
                ) : null}
              </div>
              {messageInput('messages.full', 'settings.restrictions.fullMessage', undefined, `${id}-restrictions-description`)}
            </div>

            <div className="space-y-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-from`}>{t('settings.restrictions.availableFrom')}</Label>
                  <Input
                    id={`${id}-from`}
                    type="datetime-local"
                    value={from}
                    disabled={disabled}
                    aria-describedby={`${id}-window-hint`}
                    onChange={(event) => changeWindow('from', event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-until`}>{t('settings.restrictions.availableUntil')}</Label>
                  <Input
                    id={`${id}-until`}
                    type="datetime-local"
                    value={until}
                    disabled={disabled}
                    aria-invalid={windowInvalid ? true : undefined}
                    aria-describedby={windowInvalid ? `${id}-window-hint ${id}-window-error` : `${id}-window-hint`}
                    onChange={(event) => changeWindow('until', event.target.value)}
                  />
                </div>
              </div>
              <p id={`${id}-window-hint`} className="text-xs text-muted-foreground">
                {t('settings.restrictions.windowHint')}
              </p>
              {windowInvalid ? (
                <p id={`${id}-window-error`} className="text-sm text-destructive">
                  {t('settings.restrictions.windowInvalid')}
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {messageInput('messages.notYetOpen', 'settings.restrictions.notYetOpenMessage', undefined, `${id}-restrictions-description`)}
                {messageInput('messages.closed', 'settings.restrictions.closedMessage', undefined, `${id}-restrictions-description`)}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex min-h-9 items-center gap-2">
                <Checkbox
                  id={`${id}-signed-in`}
                  checked={restrictions.signedInOnly}
                  disabled={disabled}
                  onChange={(event) => setRestrictions({ signedInOnly: event.target.checked })}
                />
                <Label htmlFor={`${id}-signed-in`} className="font-normal">
                  {t('settings.restrictions.signedInOnly')}
                </Label>
              </div>
              {messageInput('messages.signIn', 'settings.restrictions.signInMessage', undefined, `${id}-restrictions-description`)}
            </div>
          </div>
        </PanelSection>

        <Separator />

        <PanelSection titleId={`${id}-spam`} title={t('settings.spam.title')} description={t('settings.spam.description')}>
          <div className="max-w-2xl space-y-3">
            <div className="flex min-h-9 items-center gap-2">
              <Checkbox
                id={`${id}-captcha`}
                checked={definition.behaviour.captchaRequired}
                disabled={disabled}
                onChange={(event) =>
                  onDefinitionChange({ ...definition, behaviour: { ...definition.behaviour, captchaRequired: event.target.checked } })
                }
              />
              <Label htmlFor={`${id}-captcha`} className="font-normal">
                {t('settings.spam.captcha')}
              </Label>
            </div>
            {captchaUnconfigured ? (
              <Alert>
                <AlertDescription>
                  <span>{t('settings.spam.notConfigured')}</span>{' '}
                  <Link to="/settings" className="font-medium underline underline-offset-2">
                    {t('settings.spam.openSettings')}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </PanelSection>

        <Separator />

        <RetentionSettings form={form} disabled={disabled} onSaved={props.onSaved} />
      </CardContent>
    </Card>
  );
}

function parseRetentionDays(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 && value <= FORMS_LIMITS.retentionDaysMax ? value : undefined;
}

/** The retention group: live, saved on its own, with the "this will delete N entries" step. */
function RetentionSettings(props: {
  readonly form: FormDetail;
  readonly disabled: boolean;
  readonly onSaved: (detail: FormDetail) => void;
}): ReactNode {
  const { form } = props;
  const t = useTranslation('forms');
  const id = useId();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('forms:entries_write');
  const readOnly = props.disabled || !canManage;

  const [enabled, setEnabled] = useState(form.retentionDays !== null);
  const [days, setDays] = useState(form.retentionDays === null ? '' : String(form.retentionDays));
  const [pending, setPending] = useState<{ readonly retentionDays: number; readonly count: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const daysValue = enabled ? parseRetentionDays(days) : null;
  const daysInvalid = enabled && days.trim() !== '' && daysValue === undefined;
  const max = String(FORMS_LIMITS.retentionDaysMax);

  const write = async (retentionDays: number | null): Promise<void> => {
    setSaving(true);
    try {
      const saved = await formsApi.retention(form.id, form.revision, retentionDays);
      setPending(null);
      props.onSaved(saved);
      setStatus(t('settings.retention.saved'));
    } catch (error) {
      setFailure(errorMessage(error, t('builder.error')));
    } finally {
      setSaving(false);
    }
  };

  const save = async (): Promise<void> => {
    setStatus(null);
    setFailure(null);
    setPending(null);
    if (daysValue === undefined) return;
    if (daysValue === null) return write(null);
    setSaving(true);
    let count: number;
    try {
      count = (await formsApi.retentionImpact(form.id, daysValue)).entriesToDelete;
    } catch (error) {
      setFailure(errorMessage(error, t('builder.error')));
      setSaving(false);
      return;
    }
    setSaving(false);
    // Deleting entries cannot be undone: say how many, and save only once that is confirmed.
    if (count > 0) setPending({ retentionDays: daysValue, count });
    else await write(daysValue);
  };

  return (
    <PanelSection titleId={`${id}-retention`} title={t('settings.retention.title')} description={t('settings.retention.description')}>
      <div className="max-w-2xl space-y-3">
        <div className="flex min-h-9 items-center gap-2">
          <Checkbox
            id={`${id}-retention-enabled`}
            checked={enabled}
            disabled={readOnly}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setPending(null);
              setStatus(null);
            }}
          />
          <Label htmlFor={`${id}-retention-enabled`} className="font-normal">
            {t('settings.retention.enabled')}
          </Label>
        </div>
        {enabled ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor={`${id}-retention-days`}>{t('settings.retention.days')}</Label>
            <Input
              id={`${id}-retention-days`}
              inputMode="numeric"
              value={days}
              disabled={readOnly}
              aria-invalid={daysInvalid ? true : undefined}
              aria-describedby={daysInvalid ? `${id}-retention-hint ${id}-retention-error` : `${id}-retention-hint`}
              onChange={(event) => {
                setDays(event.target.value);
                setPending(null);
                setStatus(null);
              }}
            />
            <p id={`${id}-retention-hint`} className="text-xs text-muted-foreground">
              {t('settings.retention.daysHint', { max })}
            </p>
            {daysInvalid ? (
              <p id={`${id}-retention-error`} className="text-sm text-destructive">
                {t('settings.retention.daysInvalid', { max })}
              </p>
            ) : null}
          </div>
        ) : null}
        {!canManage ? <p className="text-sm text-muted-foreground">{t('settings.retention.readOnly')}</p> : null}
        {pending ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{t('settings.retention.confirm', { count: String(pending.count) })}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => void write(pending.retentionDays)}>
                  {t('settings.retention.confirmSave')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setPending(null)}>
                  {t('settings.retention.cancel')}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {failure ? (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {readOnly || pending ? null : (
            <Button type="button" variant="outline" disabled={saving || daysValue === undefined} aria-busy={saving || undefined} onClick={() => void save()}>
              {saving ? t('settings.retention.saving') : t('settings.retention.save')}
            </Button>
          )}
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        </div>
      </div>
    </PanelSection>
  );
}

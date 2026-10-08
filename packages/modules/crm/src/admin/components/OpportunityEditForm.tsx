import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  OpportunityDetail,
  OpportunityValueMode,
  UpdateOpportunityRequest,
} from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage, normaliseAmount } from '../lib/labels.js';
import { ContactLookup, SalesChannelLookup } from './LookupPickers.js';
import { ReferenceField } from './ReferenceField.js';

export interface OpportunityEditFormProps {
  opportunity: OpportunityDetail;
  /** The edit was saved (or there was nothing to save): the Opportunity as it now is. */
  onSaved: (next: OpportunityDetail) => void;
  /** A newer read of the Opportunity, made here after a stale-version answer. */
  onReloaded: (next: OpportunityDetail) => void;
  onCancel: () => void;
}

interface Draft {
  title: string;
  description: string;
  customerAccountId: string | null;
  salesChannelId: string | null;
  expectedCloseDate: string;
  valueMode: OpportunityValueMode;
  manualValue: string;
}

function draftOf(opportunity: OpportunityDetail): Draft {
  return {
    title: opportunity.title,
    description: opportunity.description ?? '',
    customerAccountId: opportunity.customerAccount?.id ?? null,
    salesChannelId: opportunity.salesChannelId,
    expectedCloseDate: opportunity.expectedCloseDate ?? '',
    valueMode: opportunity.valueMode,
    manualValue: opportunity.manualValue ?? '',
  };
}

type FieldErrors = Partial<Record<'title' | 'value', string>>;

/**
 * Editing an Opportunity in place (`specs/143-crm-sales-opportunities/`,
 * `contracts/admin-api.md` §1 — `PATCH /opportunities/:id`).
 *
 * **Only what changed is sent.** The request names the fields whose value
 * differs from the one the form was opened on, so two people editing different
 * fields do not undo each other, and saving an untouched form is no request.
 *
 * **The version the draft was read at travels as `If-Match`.** When the server
 * answers 409 `VERSION_CONFLICT` the Opportunity has changed underneath the
 * draft — by another operator, or by a status change made on this very screen.
 * That is said, saving is switched off, and the one way forward is *Reload*,
 * which reads the Opportunity again and starts the form from it. Nothing is
 * retried or merged behind the operator's back.
 *
 * The Organization and the currency are immutable (the endpoint refuses a body
 * naming either), so they are shown as a sentence and not as disabled fields.
 * The assignee and the tags are not here: each has an endpoint of its own, with
 * its own story.
 */
export function OpportunityEditForm(props: OpportunityEditFormProps): ReactNode {
  const { opportunity, onSaved, onReloaded, onCancel } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const headingId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  /** What the draft is compared with, and whose version is sent. */
  const [base, setBase] = useState(opportunity);
  const [draft, setDraft] = useState<Draft>(() => draftOf(opportunity));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);

  const set = (patch: Partial<Draft>): void => setDraft((previous) => ({ ...previous, ...patch }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (conflict) return;
    const original = draftOf(base);
    const title = draft.title.trim();
    const typedValue = draft.manualValue.trim();
    const amount = typedValue === '' ? null : normaliseAmount(typedValue);

    const next: FieldErrors = {};
    if (title === '') next.title = t('opportunity.create.error.title');
    if (draft.valueMode === 'manual' && typedValue !== '' && amount === null) {
      next.value = t('opportunity.create.error.value');
    }
    setErrors(next);
    if (next.title || next.value) {
      if (next.title) titleRef.current?.focus();
      return;
    }

    const description = draft.description.trim();
    const body: UpdateOpportunityRequest = {
      ...(title !== original.title ? { title } : {}),
      ...(description !== original.description.trim()
        ? { description: description === '' ? null : description }
        : {}),
      ...(draft.customerAccountId !== original.customerAccountId
        ? { customerAccountId: draft.customerAccountId }
        : {}),
      ...(draft.salesChannelId !== original.salesChannelId
        ? { salesChannelId: draft.salesChannelId }
        : {}),
      ...(draft.expectedCloseDate !== original.expectedCloseDate
        ? { expectedCloseDate: draft.expectedCloseDate === '' ? null : draft.expectedCloseDate }
        : {}),
      ...(draft.valueMode !== original.valueMode ? { valueMode: draft.valueMode } : {}),
      // The amount is the operator's own estimate; it is kept while the value
      // is computed, and only an edit made in manual mode changes it.
      ...(draft.valueMode === 'manual' && amount !== (base.manualValue ?? null)
        ? { manualValue: amount }
        : {}),
    };
    if (Object.keys(body).length === 0) {
      onSaved(base);
      return;
    }

    setBusy(true);
    setSubmitError(null);
    try {
      onSaved(await crmApi.updateOpportunity(base.id, body, base.version));
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 409 &&
        failure.envelope.error.code === 'VERSION_CONFLICT'
      ) {
        setConflict(true);
      } else {
        setSubmitError(errorMessage(failure, t('opportunity.edit.error')));
      }
      setBusy(false);
    }
  };

  const reload = async (): Promise<void> => {
    setReloading(true);
    try {
      const fresh = await crmApi.getOpportunity(base.id);
      setBase(fresh);
      setDraft(draftOf(fresh));
      setErrors({});
      setConflict(false);
      setSubmitError(null);
      onReloaded(fresh);
    } catch (failure) {
      setSubmitError(errorMessage(failure, t('opportunity.detail.error')));
    } finally {
      setReloading(false);
    }
  };

  const contact = base.customerAccount;

  return (
    <form
      noValidate
      aria-labelledby={headingId}
      aria-busy={busy}
      className="space-y-5"
      onSubmit={(event): void => void submit(event)}
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-tight">
        {t('opportunity.edit.title')}
      </h2>

      {conflict ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('opportunity.edit.conflict')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={reloading}
              aria-busy={reloading}
              onClick={(): void => void reload()}
            >
              {t('opportunity.edit.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {submitError ? (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="crm-edit-title">
          {t('opportunity.field.title')}
          <span aria-hidden="true" className="text-destructive">
            {' *'}
          </span>
        </Label>
        <Input
          id="crm-edit-title"
          ref={titleRef}
          value={draft.title}
          maxLength={200}
          required
          aria-invalid={errors.title !== undefined}
          aria-describedby={errors.title ? 'crm-edit-title-error' : undefined}
          onChange={(event): void => set({ title: event.target.value })}
        />
        {errors.title ? (
          <p id="crm-edit-title-error" className="text-xs text-destructive">
            {errors.title}
          </p>
        ) : null}
      </div>

      <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="crm-edit-contact">{t('opportunity.field.contact')}</Label>
          <ContactLookup
            id="crm-edit-contact"
            ariaLabel={t('opportunity.field.contact')}
            organizationId={base.organization.id}
            value={draft.customerAccountId}
            onChange={(customerAccountId): void => set({ customerAccountId })}
            placeholder={t('opportunity.picker.contactPlaceholder')}
            emptyMessage={t('opportunity.picker.contactEmpty')}
            {...(contact && draft.customerAccountId === contact.id
              ? { selectedLabel: contact.name }
              : {})}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="crm-edit-channel">{t('opportunity.field.salesChannel')}</Label>
          <SalesChannelLookup
            id="crm-edit-channel"
            ariaLabel={t('opportunity.field.salesChannel')}
            value={draft.salesChannelId}
            onChange={(salesChannelId): void => set({ salesChannelId })}
            placeholder={t('opportunity.picker.salesChannelPlaceholder')}
            emptyMessage={t('opportunity.picker.salesChannelEmpty')}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="crm-edit-close-date">{t('opportunity.field.expectedCloseDate')}</Label>
          <Input
            id="crm-edit-close-date"
            type="date"
            value={draft.expectedCloseDate}
            onChange={(event): void => set({ expectedCloseDate: event.target.value })}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="crm-edit-value-mode">{t('opportunity.edit.valueMode')}</Label>
          <Select
            id="crm-edit-value-mode"
            value={draft.valueMode}
            aria-describedby="crm-edit-value-mode-hint"
            onChange={(event): void =>
              set({ valueMode: event.target.value as OpportunityValueMode })
            }
          >
            <option value="manual">{t('opportunity.edit.valueModeManual')}</option>
            <option value="computed">{t('opportunity.edit.valueModeComputed')}</option>
          </Select>
          <p id="crm-edit-value-mode-hint" className="text-xs text-muted-foreground">
            {draft.valueMode === 'manual'
              ? t('opportunity.edit.valueModeManualHint')
              : t('opportunity.edit.valueModeComputedHint')}
          </p>
        </div>

        {draft.valueMode === 'manual' ? (
          <div className="space-y-1">
            <Label htmlFor="crm-edit-value">{t('opportunity.field.value')}</Label>
            <Input
              id="crm-edit-value"
              inputMode="decimal"
              value={draft.manualValue}
              aria-invalid={errors.value !== undefined}
              aria-describedby="crm-edit-value-hint"
              onChange={(event): void => set({ manualValue: event.target.value })}
            />
            <p
              id="crm-edit-value-hint"
              className={
                errors.value ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
              }
            >
              {errors.value ?? t('opportunity.edit.valueHint', { currency: base.currency })}
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="crm-edit-description">{t('opportunity.field.description')}</Label>
        <ReferenceField
          id="crm-edit-description"
          rows={5}
          value={draft.description}
          maxLength={20000}
          organizationId={base.organization.id}
          references={base.references}
          onValueChange={(description): void => set({ description })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {t('opportunity.edit.fixed', {
          organization: base.organization.name,
          currency: base.currency,
        })}
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          disabled={busy}
          onClick={onCancel}
        >
          {tCore('common.action.cancel')}
        </Button>
        <Button
          type="submit"
          className="min-h-11 sm:min-h-9"
          disabled={busy || conflict}
          aria-busy={busy}
        >
          {busy ? tCore('common.state.saving') : t('opportunity.edit.submit')}
        </Button>
      </div>
    </form>
  );
}

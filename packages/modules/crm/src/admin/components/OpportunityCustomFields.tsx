import { useEffect, useId, useState, type ReactNode } from 'react';
import type { CustomFieldDefinitionDto, OpportunityDetail } from '@endora-commerce/contracts';
import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { NO_VALUE } from '../lib/labels.js';

/**
 * Operator-defined fields on an Opportunity (User Story 15).
 *
 * The fields are the kit's `CustomFieldValuesPanel` for the `opportunity` host
 * type — the same component Orders, Organizations, customers and Quote
 * Requests use. The values are the Opportunity's own column, so this module
 * owns the write: the Opportunity's `PATCH` with `If-Match` here, the create
 * request on the create form.
 *
 * **Reading the definitions is `custom_fields`' permission.** The panel asks
 * `custom_fields`' admin API for them, which is gated `custom_fields:read`, so
 * every component below renders nothing — and asks nothing — for somebody
 * who does not hold it. `crm:read` names that code in its `requires`, which
 * is what tells an operator building a Sales Rep's role.
 */
const CUSTOM_FIELDS_READ = 'custom_fields:read';
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=opportunity';

/**
 * The per-field issues of a refused write, keyed by field key — or `null` when
 * the failure is anything other than `CUSTOM_FIELD_VALUE_INVALID`.
 */
export function customFieldIssues(failure: unknown): Record<string, string> | null {
  if (!(failure instanceof ApiError)) return null;
  const { code, details } = failure.envelope.error as { code: string; details?: unknown };
  if (code !== 'CUSTOM_FIELD_VALUE_INVALID' || !Array.isArray(details)) return null;
  const issues: Record<string, string> = {};
  for (const entry of details as Array<{ path?: unknown; issue?: unknown }>) {
    if (typeof entry.path === 'string' && typeof entry.issue === 'string') issues[entry.path] = entry.issue;
  }
  return issues;
}

/**
 * The bag to send for an edit. The panel reports a cleared number, date or
 * choice as `undefined`, which JSON drops — and a key the request does not
 * name keeps its stored value, so the field would silently come back. A value
 * that was stored and is now empty is therefore sent as `null`: "clear this",
 * which the server also holds against a required field.
 */
export function withCleared(
  stored: Record<string, unknown>,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...edited };
  for (const key of new Set([...Object.keys(stored), ...Object.keys(edited)])) {
    if (out[key] === undefined) out[key] = null;
  }
  return out;
}

/** Whether the person on this screen may be shown the fields at all. */
export function useCanSeeCustomFields(): boolean {
  return useAuth().hasPermission(CUSTOM_FIELDS_READ);
}

/**
 * The definitions of the Opportunity's fields, for somebody who may read them
 * — `custom_fields`' own admin API, the one the kit's panel asks. Nothing is
 * asked while `enabled` is false, and a failed read answers no definitions.
 */
export function useOpportunityFieldDefinitions(enabled: boolean): {
  definitions: CustomFieldDefinitionDto[];
  failed: boolean;
} {
  const [definitions, setDefinitions] = useState<CustomFieldDefinitionDto[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    apiClient
      .get<{ data: CustomFieldDefinitionDto[] }>(DEFINITIONS_URL)
      .then((response) => {
        if (alive) setDefinitions(response.data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return (): void => {
      alive = false;
    };
  }, [enabled]);

  return { definitions, failed };
}

/** A field's name in the reader's language — its code when the definition is not known. */
export function customFieldLabel(
  definition: CustomFieldDefinitionDto | undefined,
  key: string,
  language: string,
): string {
  return definition ? (definition.label[language] ?? definition.labelDefault) : key;
}

/**
 * One stored value as a reader sees it: a choice by its option's label, a
 * yes/no in words, several choices as a list. Without the definition the
 * stored value is shown as it is — a choice then reads as its code.
 */
export function customFieldValueLabel(
  definition: CustomFieldDefinitionDto | undefined,
  value: unknown,
  language: string,
  words: { yes: string; no: string },
): string {
  const optionLabel = (stored: string): string => {
    const option = definition?.options.find((candidate) => candidate.value === stored);
    return option ? (option.label[language] ?? option.labelDefault) : stored;
  };
  if (value === undefined || value === null || value === '') return NO_VALUE;
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (Array.isArray(value)) {
    return value.length === 0 ? NO_VALUE : value.map((entry) => optionLabel(String(entry))).join(', ');
  }
  if (typeof value === 'object') {
    return Object.values(value).map((entry) => customFieldValueLabel(undefined, entry, language, words)).join(', ');
  }
  return !definition || definition.valueType === 'select' ? optionLabel(String(value)) : String(value);
}

/** The fields on the Opportunity's Overview: editable for a writer, a list for a reader. */
export function OpportunityCustomFields(props: {
  opportunity: OpportunityDetail;
  canWrite: boolean;
  onChange: (next: OpportunityDetail) => void;
}): ReactNode {
  const { opportunity, canWrite, onChange } = props;
  const { language } = useAppLanguage();
  const visible = useCanSeeCustomFields();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!visible) return null;
  if (!canWrite) return <CustomFieldValuesList values={opportunity.customFieldValues} language={language} />;

  const save = async (values: Record<string, unknown>): Promise<void> => {
    setFieldErrors({});
    try {
      // The version on screen: a status move or another edit since the page
      // was read has already put a newer Opportunity here.
      onChange(
        await crmApi.updateOpportunity(
          opportunity.id,
          { customFieldValues: withCleared(opportunity.customFieldValues, values) },
          opportunity.version,
        ),
      );
    } catch (failure) {
      setFieldErrors(customFieldIssues(failure) ?? {});
      // The panel shows the refusal's sentence; the fields show which.
      throw failure;
    }
  };

  return (
    <CustomFieldValuesPanel
      entityType="opportunity"
      values={opportunity.customFieldValues}
      save={save}
      fieldErrors={fieldErrors}
      language={language}
    />
  );
}

/**
 * The fields inside the create form: no button of their own — the form's
 * submit sends the values with the rest of the Opportunity.
 */
export function NewOpportunityCustomFields(props: {
  onChange: (values: Record<string, unknown>) => void;
  fieldErrors: Readonly<Record<string, string>>;
}): ReactNode {
  const { language } = useAppLanguage();
  if (!useCanSeeCustomFields()) return null;
  return (
    <CustomFieldValuesPanel
      entityType="opportunity"
      values={EMPTY}
      onChange={props.onChange}
      fieldErrors={props.fieldErrors}
      language={language}
    />
  );
}

const EMPTY: Record<string, unknown> = {};

/** The values as a reader sees them: every defined field, in the reader's language. */
function CustomFieldValuesList(props: { values: Record<string, unknown>; language: string }): ReactNode {
  const { values, language } = props;
  const t = useTranslation('crm');
  const headingId = useId();
  const { definitions, failed } = useOpportunityFieldDefinitions(true);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('customFields.loadFailed')}
      </p>
    );
  }
  // No field is defined for Opportunities: no heading, no empty section.
  if (definitions.length === 0) return null;

  const words = { yes: t('customFields.value.yes'), no: t('customFields.value.no') };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-base font-semibold">
        {t('customFields.heading')}
      </h2>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {definitions.map((definition) => (
          <div key={definition.id}>
            <dt className="text-muted-foreground">{customFieldLabel(definition, definition.key, language)}</dt>
            <dd>{customFieldValueLabel(definition, values[definition.key], language, words)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

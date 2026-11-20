import { Fragment, type ReactNode } from 'react';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import { RecordHistoryChangeList } from '@endora-commerce/admin-kit/components';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { auditStateOutcome, isIsoTimestamp } from '../lib/audit-log-view.js';
import { AuditStateView, ErasedValue } from './AuditStateView.js';

/**
 * One audit entry's change, field by field (issue #1555, UX audit SHELL-20):
 * the kit's record-history change list — a field, its old value struck through,
 * an arrow, its new value — instead of two JSON blocks to compare by eye. The
 * stored snapshots stay one disclosure away, as the JSON they are, for the
 * support case that needs the exact record (#844's erased token included).
 */

/** The fields every module's audit state may carry, named in words (`specs/conventions/audit-state.md`). */
const FIELD_LABEL_KEYS: Readonly<Record<string, string>> = {
  changedFields: 'auditLog.field.changedFields',
  changedCustomFields: 'auditLog.field.changedCustomFields',
};

export function AuditEntryDiff({ before, after }: { before: unknown; after: unknown }): ReactNode {
  const t = useTranslation('audit_logs');
  const tc = useTranslation('core');
  const outcome = auditStateOutcome(before, after);
  const recorded = (before ?? null) !== null || (after ?? null) !== null;
  return (
    <div className="space-y-3">
      {outcome.kind === 'changes' ? (
        <RecordHistoryChangeList
          changes={outcome.changes}
          fieldLabel={(field): ReactNode => {
            const key = FIELD_LABEL_KEYS[field];
            return key ? t(key) : <code className="font-mono">{field}</code>;
          }}
          renderValue={(_field, raw): ReactNode => <AuditFieldValue value={raw} />}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {outcome.kind === 'none' ? t('auditLog.diff.none') : t('auditLog.diff.unchanged')}
        </p>
      )}
      {recorded ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('auditLog.diff.raw')}
          </summary>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div>
              <strong>{tc('auditLog.detail.before')}</strong>
              <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                <AuditStateView value={before ?? null} />
              </pre>
            </div>
            <div>
              <strong>{tc('auditLog.detail.after')}</strong>
              <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                <AuditStateView value={after ?? null} />
              </pre>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * A stored value in words: the erased token, *empty*, *yes* / *no*, a date for a
 * timestamp, a list joined by commas; only a nested object stays JSON, compact.
 */
export function AuditFieldValue({ value }: { value: unknown }): ReactNode {
  const t = useTranslation('audit_logs');
  if (value === AUDIT_ERASED_MARKER) return <ErasedValue />;
  if (value === null || value === undefined || value === '') {
    return <span className="italic text-muted-foreground">{t('auditLog.value.empty')}</span>;
  }
  if (typeof value === 'boolean') return value ? t('auditLog.value.true') : t('auditLog.value.false');
  if (isIsoTimestamp(value)) {
    return (
      <time dateTime={value} title={value}>
        {formatDateTime(value)}
      </time>
    );
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object')) {
    if (value.length === 0) return <span className="italic text-muted-foreground">{t('auditLog.value.empty')}</span>;
    return value.map((item, index) => (
      <Fragment key={index}>
        {index > 0 ? ', ' : null}
        <AuditFieldValue value={item} />
      </Fragment>
    ));
  }
  return (
    <code className="font-mono text-xs">
      <AuditStateView value={value} />
    </code>
  );
}

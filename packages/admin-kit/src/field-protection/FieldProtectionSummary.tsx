/**
 * "Which fields on this record are protected", answered without opening each
 * one (feature 091, P4b), together with what the integration says about the
 * record: that it is integration-managed, how the source models it, and when it
 * last synchronised.
 *
 * Renders nothing at all when the owner reports no enabled connection — the
 * same rule as the control itself, and the reason a host needs no condition of
 * its own around the mount.
 */
import type { ReactNode } from 'react';
import { Boxes, Lock, ShieldCheck } from 'lucide-react';

import { describeFieldPath } from './describe-path.js';
import { useFieldProtection } from './use-field-protection.js';
import type { FieldProtectionSource } from './types.js';

export interface FieldProtectionSummaryProps {
  readonly source: FieldProtectionSource;
  readonly className?: string;
}

export function FieldProtectionSummary({
  source,
  className,
}: FieldProtectionSummaryProps): ReactNode {
  const protection = useFieldProtection(source);
  if (!protection.available) return null;

  const t = source.t;
  const synced = protection.lastSyncedAt ? new Date(protection.lastSyncedAt) : null;

  return (
    <div
      className={`rounded-md border border-border bg-muted/30 px-3 py-2 text-xs ${className ?? ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <ShieldCheck size={13} aria-hidden="true" />
          {t('fieldProtection.title')}
          {/* Two connected integrations render two of these cards; without the
              label they are two identical headings. */}
          <span className="opacity-70">{source.sourceLabel}</span>
        </span>
        {protection.integrationManaged ? (
          <span className="text-muted-foreground">{t('fieldProtection.integrationManaged')}</span>
        ) : null}
        {protection.sourceKind ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Boxes size={13} aria-hidden="true" />
            {/* The owner's own vocabulary in the owner's own namespace: the two
                integrations enumerate different structural kinds, and neither
                set is this package's to know. */}
            {t(`fieldProtection.structure.${protection.sourceKind}`)}
            {protection.variantCount > 0 ? (
              <span className="tabular-nums">
                ·{' '}
                {t('fieldProtection.structure.variantCount', { count: protection.variantCount })}
              </span>
            ) : null}
          </span>
        ) : null}
        {synced && !Number.isNaN(synced.getTime()) ? (
          <span className="text-muted-foreground">
            {t('fieldProtection.lastSyncedAt')}:{' '}
            <time dateTime={protection.lastSyncedAt ?? undefined}>{synced.toLocaleString()}</time>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-muted-foreground">{t('fieldProtection.description')}</p>
      {protection.protections.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{t('fieldProtection.summary.none')}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {protection.protections.map((entry) => (
            <li
              key={`${entry.fieldPath}|${entry.languageCode ?? ''}`}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5"
            >
              <Lock size={11} aria-hidden="true" />
              {entry.languageCode === null
                ? describeFieldPath(t, entry.fieldPath, protection.livePricePaths)
                : t('fieldProtection.summary.item.language', {
                    field: describeFieldPath(t, entry.fieldPath, protection.livePricePaths),
                    language: entry.languageCode,
                  })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

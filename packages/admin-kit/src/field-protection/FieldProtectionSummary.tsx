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

import {
  EditorSection,
  type EditorSectionChrome,
  type EditorSectionHeading,
} from '../ui/editor-section.js';
import { useAppLanguage } from '../i18n/app-language-context.js';
import { formatDateTime } from '../lib/format.js';
import { describeFieldPath } from './describe-path.js';
import { useFieldProtection } from './use-field-protection.js';
import type { FieldProtectionSource } from './types.js';

export interface FieldProtectionSummaryProps {
  readonly source: FieldProtectionSource;
  readonly className?: string;
  /**
   * `section` (the default, unless the mount says otherwise): a section of the
   * card it is mounted in — the product editor's tab. `card` where it stands
   * alone on a page (issue #1488, UX audit CAT-06; the DS-03 rule: a frame
   * inside a card is a defect unless it is a field).
   */
  readonly chrome?: EditorSectionChrome;
  /** The heading level: `h2` by default, `h3` under a titled card or section. */
  readonly titleAs?: EditorSectionHeading;
}

export function FieldProtectionSummary({
  source,
  className,
  chrome,
  titleAs,
}: FieldProtectionSummaryProps): ReactNode {
  const protection = useFieldProtection(source);
  const { language } = useAppLanguage();
  if (!protection.available) return null;

  const t = source.t;
  const synced = protection.lastSyncedAt ? new Date(protection.lastSyncedAt) : null;

  return (
    <EditorSection
      title={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <ShieldCheck size={14} aria-hidden="true" />
          {t('fieldProtection.title')}
          {/* Two connected integrations render two of these sections; without the
              label they are two identical headings. */}
          <span className="font-normal text-muted-foreground">{source.sourceLabel}</span>
        </span>
      }
      description={t('fieldProtection.description')}
      {...(chrome ? { chrome } : {})}
      {...(titleAs ? { as: titleAs } : {})}
      {...(className ? { className } : {})}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {protection.integrationManaged ? <span>{t('fieldProtection.integrationManaged')}</span> : null}
        {protection.sourceKind ? (
          <span className="inline-flex items-center gap-1.5">
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
          <span>
            {t('fieldProtection.lastSyncedAt')}:{' '}
            <time dateTime={protection.lastSyncedAt ?? undefined}>
              {formatDateTime(protection.lastSyncedAt, language)}
            </time>
          </span>
        ) : null}
      </div>
      {protection.protections.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('fieldProtection.summary.none')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 text-xs">
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
    </EditorSection>
  );
}

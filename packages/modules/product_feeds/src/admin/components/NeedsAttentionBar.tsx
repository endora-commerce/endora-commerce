import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { DraftField, FieldProblem } from '../template-draft.js';

/**
 * Continuous surfacing of what is wrong — ux-design §3.6, FR-073.
 *
 * Validation problems are shown **while the operator works**, not saved up for
 * the moment they press `Save`. Three levels, and the operator meets them in
 * this order: this bar, the amber chip on the row, and the message under the
 * control that caused it.
 *
 * The counterpart rule lives on the editor's `Save` button: it is never
 * disabled for validation reasons. A disabled primary with invisible reasons is
 * the classic conversion trap — it leaves the operator clicking a dead button
 * with nothing to read.
 */

export interface NeedsAttentionBarProps {
  problems: FieldProblem[];
  fields: DraftField[];
  showOnlyProblems: boolean;
  onToggleShowOnly: () => void;
  /** Selects the field and moves focus to the control that caused the problem. */
  onFocusField: (fieldId: string) => void;
}

export function NeedsAttentionBar(props: NeedsAttentionBarProps): ReactNode {
  const { problems, fields, showOnlyProblems, onToggleShowOnly, onFocusField } = props;
  const t = useTranslation('product_feeds');
  if (problems.length === 0) return null;

  // A `template` problem belongs to the template as a whole. It anchors to the
  // first field only so it has an id at all, so counting it as that column's
  // problem — and offering a link to it — points the operator at the wrong
  // control. State those separately, in their own words.
  const templateProblems = problems.filter((problem) => problem.control === 'template');
  const fieldProblems = problems.filter((problem) => problem.control !== 'template');
  const affected = new Set(fieldProblems.map((problem) => problem.fieldId));
  const names = fields.filter((field) => affected.has(field.id));

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={14} aria-hidden="true" />
        {templateProblems.map((problem) => (
          <span key={problem.messageKey}>{t(problem.messageKey, problem.params ?? {})}</span>
        ))}
        {affected.size > 0 ? (
          <span>
            {affected.size === 1
              ? t('builder.needsAttention.one')
              : t('builder.needsAttention', { count: affected.size })}
          </span>
        ) : null}
        {/* Clicking a name selects the field and moves focus to it — the fix is
            one click from the complaint, never a hunt through the list. */}
        {names.map((field) => (
          <button
            key={field.id}
            type="button"
            className="underline underline-offset-2"
            onClick={(): void => onFocusField(field.id)}
          >
            {field.outputName}
          </button>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={onToggleShowOnly}>
          {showOnlyProblems
            ? t('builder.needsAttention.showAll')
            : t('builder.needsAttention.showOnly')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

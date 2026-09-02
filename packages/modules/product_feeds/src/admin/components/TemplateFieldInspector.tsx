import { useId, useState, type ReactNode } from 'react';
import type {
  FeedFieldSourceCatalogue,
  FeedFieldTransform,
  FeedOutputFormat,
  TaxonomyProviderCode,
} from '@endora-commerce/contracts';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { TemplatePreviewField } from '../api.js';
import type { DraftField, FieldProblem } from '../template-draft.js';
import { encodeSourceValue, FieldSourceCombobox } from './FieldSourceCombobox.js';

/**
 * One field's detail — ux-design §2.7 (L1) / §3.3, FR-071, FR-073.
 *
 * Exactly one field at a time, on purpose: 23 fields × 5 controls on screen at
 * once is Miller's Law taken as a challenge rather than a warning. The
 * inspector is a comprehension device, not a space saver.
 *
 * The reading order is the order a novice needs it in: **what this is for**
 * (the gloss the platform ships for its own templates), then the name the
 * provider sees, then what fills it, then the fallback — in the same place as
 * the binding, because "what if it is empty" is the same thought (FR-071). The
 * transforms are folded away: they are the 5% path and must not tax the 95%.
 */

const TRANSFORMS: FeedFieldTransform[] = [
  'none',
  'upper',
  'lower',
  'trim',
  'truncate',
  'strip_html',
  'absolute_url',
];

export interface TemplateFieldInspectorProps {
  field: DraftField | null;
  catalogue: FeedFieldSourceCatalogue | null;
  outputFormat: FeedOutputFormat;
  taxonomyProviderCode: TaxonomyProviderCode | null;
  providerLabel: string;
  problems: FieldProblem[];
  preview: TemplatePreviewField | null;
  previewSku: string | null;
  sampleValues?: Record<string, string>;
  disabled: boolean;
  disabledTitle?: string | undefined;
  onChange: (next: DraftField) => void;
  /** Rendered as a drawer below 1280 px; the opener passes a close handler. */
  onClose?: () => void;
}

export function TemplateFieldInspector(props: TemplateFieldInspectorProps): ReactNode {
  const {
    field,
    catalogue,
    outputFormat,
    taxonomyProviderCode,
    providerLabel,
    problems,
    preview,
    previewSku,
    disabled,
    disabledTitle,
    onChange,
  } = props;
  const t = useTranslation('product_feeds');
  const errorId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (!field) return null;

  const problemFor = (control: FieldProblem['control']): FieldProblem | undefined =>
    problems.find((problem) => problem.control === control);
  const nameProblem = problemFor('outputName');
  const sourceProblem = problemFor('source');
  const fallbackProblem = problemFor('fallback');

  const patch = (over: Partial<DraftField>): void => onChange({ ...field, ...over });
  const gloss = field.helpKey ? t(field.helpKey) : null;

  return (
    <div className="flex flex-col gap-4" title={disabled ? disabledTitle : undefined}>
      {gloss ? (
        <div>
          <h3 className="text-sm font-medium">{t('builder.inspector.purpose')}</h3>
          <p className="text-sm text-muted-foreground">{gloss}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {field.providerRequired
              ? t('builder.help.requiredBy', { provider: providerLabel })
              : t('builder.help.optionalFor', { provider: providerLabel })}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${errorId}-name`}>{t('builder.inspector.outputName')}</Label>
        <Input
          id={`${errorId}-name`}
          value={field.outputName}
          disabled={disabled}
          aria-invalid={nameProblem ? true : undefined}
          aria-describedby={nameProblem ? `${errorId}-name-error` : undefined}
          onChange={(event): void => patch({ outputName: event.target.value })}
          // Postel: a name pasted out of a provider's documentation routinely
          // arrives with a stray newline. Clean it, do not reject it.
          onBlur={(event): void =>
            patch({ outputName: event.target.value.trim().replace(/\s+/g, ' ') })
          }
        />
        {nameProblem ? (
          <p id={`${errorId}-name-error`} className="text-xs text-destructive">
            {t(nameProblem.messageKey, nameProblem.params ?? {})}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${errorId}-source`}>{t('builder.inspector.source')}</Label>
        <FieldSourceCombobox
          id={`${errorId}-source`}
          catalogue={catalogue}
          value={encodeSourceValue(field.sourceKind, field.sourceKey)}
          outputFormat={outputFormat}
          taxonomyProviderCode={taxonomyProviderCode}
          {...(props.sampleValues ? { sampleValues: props.sampleValues } : {})}
          disabled={disabled}
          ariaInvalid={sourceProblem !== undefined}
          {...(sourceProblem ? { ariaDescribedBy: `${errorId}-source-error` } : {})}
          onChange={(next): void =>
            patch({
              sourceKind: next.sourceKind,
              sourceKey: next.sourceKey,
              // A rebind clears the "does not exist here" flag an import set.
              unbound: false,
              constantValue: next.sourceKind === 'constant' ? (field.constantValue ?? '') : null,
            })
          }
        />
        {sourceProblem ? (
          <p id={`${errorId}-source-error`} className="text-xs text-destructive">
            {t(sourceProblem.messageKey, sourceProblem.params ?? {})}
          </p>
        ) : null}

        {field.sourceKind === 'constant' ? (
          <div className="mt-2 flex flex-col gap-1">
            <Label htmlFor={`${errorId}-constant`}>{t('builder.inspector.constantValue')}</Label>
            <Input
              id={`${errorId}-constant`}
              value={field.constantValue ?? ''}
              disabled={disabled}
              // Whitespace is kept verbatim here: a fixed value is written into
              // the file exactly as typed.
              onChange={(event): void => patch({ constantValue: event.target.value })}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${errorId}-fallback`}>{t('builder.inspector.fallback')}</Label>
        <Input
          id={`${errorId}-fallback`}
          value={field.fallbackValue ?? ''}
          disabled={disabled}
          aria-describedby={`${errorId}-fallback-help`}
          onChange={(event): void =>
            patch({ fallbackValue: event.target.value === '' ? null : event.target.value })
          }
        />
        <p id={`${errorId}-fallback-help`} className="b2b-help">
          {t('builder.help.fallback')}
        </p>
        {fallbackProblem ? (
          <p className="text-xs text-destructive">
            {t(fallbackProblem.messageKey, fallbackProblem.params ?? {})}
          </p>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.providerRequired}
          disabled={disabled}
          onChange={(event): void => patch({ providerRequired: event.target.checked })}
        />
        {t('builder.inspector.required')}
      </label>

      <div>
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          aria-expanded={advancedOpen}
          onClick={(): void => setAdvancedOpen((open) => !open)}
        >
          {t('builder.inspector.advanced')}
        </button>
        {advancedOpen ? (
          <div className="mt-2 flex flex-col gap-2">
            <Label htmlFor={`${errorId}-transform`}>{t('builder.inspector.transform')}</Label>
            <Select
              id={`${errorId}-transform`}
              value={field.transform ?? 'none'}
              disabled={disabled}
              onChange={(event): void =>
                patch({
                  transform:
                    event.target.value === 'none'
                      ? null
                      : (event.target.value as FeedFieldTransform),
                })
              }
            >
              {TRANSFORMS.map((transform) => (
                <option key={transform} value={transform}>
                  {t(`builder.inspector.transform.${transform}`)}
                </option>
              ))}
            </Select>
            {field.transform === 'truncate' ? (
              <>
                <Label htmlFor={`${errorId}-transform-arg`}>
                  {t('builder.inspector.transformArg')}
                </Label>
                <Input
                  id={`${errorId}-transform-arg`}
                  type="number"
                  min={1}
                  value={field.transformArg ?? ''}
                  disabled={disabled}
                  onChange={(event): void =>
                    patch({ transformArg: event.target.value === '' ? null : event.target.value })
                  }
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {preview && previewSku ? (
        <div className="border-t border-border pt-3">
          <h3 className="text-xs uppercase text-muted-foreground">
            {t('builder.inspector.forProduct', { sku: previewSku })}
          </h3>
          <p className="mt-1 break-words text-sm">
            {preview.value ?? t('builder.preview.empty.omitted')}
          </p>
        </div>
      ) : null}

      {props.onClose ? (
        <Button type="button" variant="outline" onClick={props.onClose}>
          {t('builder.inspector.close')}
        </Button>
      ) : null}
    </div>
  );
}

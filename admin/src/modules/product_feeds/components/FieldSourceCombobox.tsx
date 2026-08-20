import { useMemo, useState, type ReactNode } from 'react';
import type {
  FeedFieldSourceCatalogue,
  FeedFieldSourceKind,
  FeedOutputFormat,
  TaxonomyProviderCode,
} from '@b2b/contracts';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useTranslation } from '@/i18n/useTranslation';
import { normalize } from '@/lib/text-normalization';

/**
 * "Filled from" — the guided binding picker (ux-design §3.2, FR-070).
 *
 * One control, grouped in likely-use order rather than alphabetically, over
 * **only what exists on this installation**. The operator never types an
 * internal key, a column name or a path; there is no expression language here
 * and there is not going to be one.
 *
 * Two rules that look like details and are not:
 *
 *  - a source the current output format cannot express, or one that needs a
 *    taxonomy this template does not declare, is rendered **disabled with the
 *    reason** rather than filtered out. Filtering leaves the operator hunting
 *    for something they know exists; disabling teaches them the rule.
 *  - when a sample product is chosen, an attribute option carries that
 *    product's own value under it. Choosing "Marka" is much easier when the row
 *    already says `Makita`.
 */

export type FieldSourceValue = string;

/** `sku`, or `attribute:brand` — one opaque key the combobox can compare. */
export function encodeSourceValue(
  sourceKind: FeedFieldSourceKind,
  sourceKey: string | null,
): FieldSourceValue {
  return sourceKey ? `${sourceKind}:${sourceKey}` : sourceKind;
}

export function decodeSourceValue(value: FieldSourceValue): {
  sourceKind: FeedFieldSourceKind;
  sourceKey: string | null;
} {
  const separator = value.indexOf(':');
  if (separator < 0) {
    return { sourceKind: value as FeedFieldSourceKind, sourceKey: null };
  }
  return {
    sourceKind: value.slice(0, separator) as FeedFieldSourceKind,
    sourceKey: value.slice(separator + 1),
  };
}

export interface FieldSourceComboboxProps {
  catalogue: FeedFieldSourceCatalogue | null;
  value: FieldSourceValue;
  onChange: (next: { sourceKind: FeedFieldSourceKind; sourceKey: string | null }) => void;
  outputFormat: FeedOutputFormat;
  taxonomyProviderCode: TaxonomyProviderCode | null;
  /** The sample product's value per attribute key, when a preview is running. */
  sampleValues?: Record<string, string>;
  disabled?: boolean;
  id?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}

interface SourceOptionMeta {
  group: string;
  first: boolean;
}

export function FieldSourceCombobox(props: FieldSourceComboboxProps): ReactNode {
  const {
    catalogue,
    value,
    onChange,
    outputFormat,
    taxonomyProviderCode,
    sampleValues = {},
    disabled = false,
  } = props;
  const t = useTranslation('product_feeds');
  const [query, setQuery] = useState('');

  const { options, meta } = useMemo(() => {
    const built: ComboboxOption<string>[] = [];
    const metaByValue = new Map<string, SourceOptionMeta>();
    const needle = normalize(query);

    for (const group of catalogue?.groups ?? []) {
      const groupLabel = t(`fieldSource.group.${group.kind}`);
      let first = true;
      for (const source of group.sources) {
        const label = source.label ?? (source.labelKey ? t(source.labelKey) : source.sourceKind);
        const optionValue = encodeSourceValue(source.sourceKind, source.sourceKey);

        const formatBlocked = source.unsupportedInFormats.includes(outputFormat);
        const taxonomyBlocked = source.requiresTaxonomy && taxonomyProviderCode === null;
        const description = formatBlocked
          ? t('fieldSource.disabled.format', { format: outputFormat.toUpperCase() })
          : taxonomyBlocked
            ? t('fieldSource.disabled.taxonomy')
            : source.sourceKind === 'constant'
              ? t('fieldSource.hint.constant')
              : source.sourceKind === 'provider_category'
                ? t('fieldSource.hint.providerCategory')
                : (source.sourceKey ? sampleValues[source.sourceKey] : undefined) ??
                  source.description ??
                  undefined;

        // Filtering is ours (`manualFilter`) so the group headings can be drawn
        // against the visible list rather than the whole catalogue.
        const haystack = `${normalize(label)} ${normalize(groupLabel)} ${normalize(description ?? '')}`;
        if (needle !== '' && !haystack.includes(needle)) continue;

        built.push({
          value: optionValue,
          label,
          description,
          disabled: formatBlocked || taxonomyBlocked,
        });
        metaByValue.set(optionValue, { group: groupLabel, first });
        first = false;
      }
    }
    return { options: built, meta: metaByValue };
  }, [catalogue, query, t, outputFormat, taxonomyProviderCode, sampleValues]);

  return (
    <Combobox<string>
      {...(props.id ? { id: props.id } : {})}
      options={options}
      value={value}
      manualFilter
      onSearchChange={setQuery}
      onChange={(next): void => {
        if (next === null) return;
        onChange(decodeSourceValue(next));
      }}
      clearable={false}
      disabled={disabled}
      placeholder={t('builder.inspector.source')}
      renderOption={(option): ReactNode => {
        const entry = meta.get(option.value);
        return (
          <div className="min-w-0 flex-1">
            {entry?.first ? (
              // Visual grouping only: the group name is not part of the option's
              // accessible name, so a screen reader reads the source, not a
              // heading glued onto it.
              <div aria-hidden="true" className="pb-1 text-[11px] font-medium uppercase text-muted-foreground">
                {entry.group}
              </div>
            ) : null}
            <div className="truncate">{option.label}</div>
            {option.description ? (
              <div className="truncate text-xs text-muted-foreground">{option.description}</div>
            ) : null}
          </div>
        );
      }}
    />
  );
}

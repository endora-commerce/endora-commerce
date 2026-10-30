'use client';

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { FieldLabel, type CustomField, type Field } from '@puckeditor/core';
import {
  PB_FIELD_HINT_CLASS,
  PB_FIELD_INPUT_CLASS,
  PB_FIELD_LABEL_CLASS,
  ToggleSwitch,
  collectAnchors,
  normalizeAnchor,
  type LinkKind,
  type LinkTarget,
  type LinkValue,
} from '@endora-commerce/page-builder-core';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AssetModalFieldControl } from './AssetPickers.js';
import { SingleCategoryFieldControl, SingleProductFieldControl } from './CatalogPickers.js';
import { listPageBuilderLinkPages } from './cms-page-builder-api.js';

/**
 * The one link field of the page builder (`specs/163-page-builder-marketing-pages/`
 * research R-11): a `LinkValue` of kind URL, page, product, category, file or
 * in-page anchor.
 *
 * It generalises the button link picker `cms`' admin carried, which this file
 * replaces (feature 163, T016): the page, product and category kinds keep the
 * pickers editors already know (the page list, and the catalog pickers every
 * catalog block uses), a file opens the asset library, and an anchor offers the
 * sections of the canvas as it is now (`collectAnchors`) or takes free text,
 * normalised to the anchor grammar.
 *
 * `createButtonLinkSlugField` is the old slug-only control, kept for
 * `cms.Button` and `cms.Hero` until their reshape moves them onto
 * `createLinkField`; it renders the same per-kind pickers.
 */

/** The page builder's field input class (feature 163, T116: Puck's own class name went stale in 0.23). */
const inputClassName = PB_FIELD_INPUT_CLASS;

export const LINK_KINDS: readonly LinkKind[] = ['url', 'page', 'product', 'category', 'asset', 'anchor'];

/** Each kind's option label, spelled out so every key is a literal a check can read. */
const KIND_LABEL_KEYS: Record<LinkKind, string> = {
  url: 'pageBuilder.linkField.kind.url',
  page: 'pageBuilder.linkField.kind.page',
  product: 'pageBuilder.linkField.kind.product',
  category: 'pageBuilder.linkField.kind.category',
  asset: 'pageBuilder.linkField.kind.asset',
  anchor: 'pageBuilder.linkField.kind.anchor',
};

/** The value a kind starts from when the editor switches to it. */
function emptyLink(kind: LinkKind, target: LinkTarget | undefined): LinkValue {
  const withTarget = target !== undefined ? { target } : {};
  switch (kind) {
    case 'url':
      return { kind, href: '', ...withTarget };
    case 'page':
    case 'product':
    case 'category':
      return { kind, slug: '', ...withTarget };
    case 'asset':
      return { kind, fileAssetId: '', ...withTarget };
    case 'anchor':
      return { kind, anchor: '' };
  }
}

/** Whether a link leads anywhere yet: a URL, a page, product or category slug, a file or a section. */
function hasDestination(value: LinkValue): boolean {
  switch (value.kind) {
    case 'url':
      return value.href.trim() !== '';
    case 'page':
    case 'product':
    case 'category':
      return value.slug.trim() !== '';
    case 'asset':
      return value.fileAssetId !== '';
    case 'anchor':
      return value.anchor !== '';
  }
}

function targetOf(value: LinkValue): LinkTarget | undefined {
  return value.kind === 'anchor' ? undefined : value.target;
}

function Labelled({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={PB_FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

function usePageOptions(enabled: boolean): { pages: { slug: string; label: string }[]; loading: boolean } {
  const [pages, setPages] = useState<{ slug: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    void listPageBuilderLinkPages()
      .then((list) => {
        if (!cancelled) setPages(list);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [enabled]);

  return { pages, loading };
}

function PageSelect({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string;
  onChange: (slug: string) => void;
  readOnly?: boolean | undefined;
  label?: string;
}): ReactElement {
  const t = useTranslation('core');
  const { pages, loading } = usePageOptions(true);
  return (
    <Labelled label={label ?? t('pageBuilder.linkField.page')}>
      <select
        className={inputClassName}
        disabled={readOnly === true || loading}
        value={value}
        onChange={(e): void => onChange(e.target.value)}
      >
        <option value="">{t('pageBuilder.linkField.selectPage')}</option>
        {pages.map((page) => (
          <option key={page.slug} value={page.slug}>
            {page.label}
          </option>
        ))}
      </select>
    </Labelled>
  );
}

function UrlInput({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string;
  onChange: (href: string) => void;
  readOnly?: boolean | undefined;
  label?: string;
}): ReactElement {
  const t = useTranslation('core');
  return (
    <Labelled label={label ?? t('pageBuilder.linkField.url')}>
      <input
        type="text"
        className={inputClassName}
        readOnly={readOnly === true}
        value={value}
        placeholder={t('pageBuilder.linkField.urlPlaceholder')}
        onChange={(e): void => onChange(e.target.value)}
      />
    </Labelled>
  );
}

function AnchorControl({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (anchor: string) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const t = useTranslation('core');
  const data = usePageBuilderPuck((s) => s.appState.data);
  const anchors = useMemo(() => collectAnchors(data), [data]);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (): void => {
    const normalised = normalizeAnchor(draft);
    setDraft(normalised);
    if (normalised !== value) onChange(normalised);
  };

  return (
    <div className="space-y-2">
      <Labelled label={t('pageBuilder.linkField.anchors')}>
        <select
          className={inputClassName}
          disabled={readOnly === true || anchors.length === 0}
          value={anchors.includes(value) ? value : ''}
          onChange={(e): void => onChange(e.target.value)}
        >
          <option value="">
            {anchors.length === 0 ? t('pageBuilder.linkField.noAnchors') : t('pageBuilder.linkField.selectAnchor')}
          </option>
          {anchors.map((anchor) => (
            <option key={anchor} value={anchor}>
              {`#${anchor}`}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled label={t('pageBuilder.linkField.anchor')}>
        <input
          type="text"
          className={inputClassName}
          readOnly={readOnly === true}
          value={draft}
          onChange={(e): void => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e): void => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Labelled>
      <p className={PB_FIELD_HINT_CLASS}>{t('pageBuilder.linkField.anchorHint')}</p>
    </div>
  );
}

export interface LinkFieldControlProps {
  value: LinkValue | undefined;
  onChange: (value: LinkValue) => void;
  readOnly?: boolean | undefined;
  label: string;
  /** The kinds offered, in order; every kind by default. */
  kinds?: readonly LinkKind[] | undefined;
}

export function LinkFieldControl({ value, onChange, readOnly, label, kinds = LINK_KINDS }: LinkFieldControlProps): ReactElement {
  const t = useTranslation('core');
  const link: LinkValue = value ?? emptyLink(kinds[0] ?? 'url', undefined);
  const target = targetOf(link);

  const setTarget = (blank: boolean): void => {
    if (link.kind === 'anchor') return;
    const { target: _previous, ...rest } = link;
    onChange(blank ? { ...rest, target: '_blank' } : rest);
  };

  let body: ReactElement;
  switch (link.kind) {
    case 'url':
      body = <UrlInput value={link.href} readOnly={readOnly} onChange={(href): void => onChange({ ...link, href })} />;
      break;
    case 'page':
      body = <PageSelect value={link.slug} readOnly={readOnly} onChange={(slug): void => onChange({ ...link, slug })} />;
      break;
    case 'product':
      body = (
        <SingleProductFieldControl
          value={link.slug}
          label={t('pageBuilder.linkField.product')}
          {...(readOnly === true ? { readOnly: true } : {})}
          onChange={(slug): void => onChange({ ...link, slug })}
        />
      );
      break;
    case 'category':
      body = (
        <SingleCategoryFieldControl
          value={link.slug}
          label={t('pageBuilder.linkField.category')}
          {...(readOnly === true ? { readOnly: true } : {})}
          onChange={(slug): void => onChange({ ...link, slug })}
        />
      );
      break;
    case 'asset':
      body = (
        <AssetModalFieldControl
          value={link.fileAssetId}
          label={t('pageBuilder.linkField.file')}
          modalTitle={t('pageBuilder.linkField.selectFile')}
          {...(readOnly === true ? { readOnly: true } : {})}
          onChange={(fileAssetId): void => onChange({ ...link, fileAssetId })}
        />
      );
      break;
    case 'anchor':
      body = <AnchorControl value={link.anchor} readOnly={readOnly} onChange={(anchor): void => onChange({ kind: 'anchor', anchor })} />;
      break;
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <Labelled label={t('pageBuilder.linkField.type')}>
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={link.kind}
          onChange={(e): void => onChange(emptyLink(e.target.value as LinkKind, target))}
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABEL_KEYS[kind])}
            </option>
          ))}
        </select>
      </Labelled>
      {body}
      {/* R17 (T212): the page builder's one true/false control; shown once the link leads somewhere
          (or already opens a new tab, so it can be turned off). */}
      {link.kind !== 'anchor' && (hasDestination(link) || target === '_blank') ? (
        <ToggleSwitch
          size="sm"
          label={t('pageBuilder.linkField.newTab')}
          checked={target === '_blank'}
          readOnly={readOnly === true}
          onChange={setTarget}
        />
      ) : null}
    </div>
  );
}

export interface LinkFieldOptions {
  label?: string;
  kinds?: readonly LinkKind[];
}

/** A Puck field holding one `LinkValue` (research R-11). */
export function createLinkField(options?: LinkFieldOptions): CustomField<LinkValue | undefined> {
  const fallbackLabel = options?.label ?? 'Link';
  return {
    type: 'custom',
    label: fallbackLabel,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? fallbackLabel} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <LinkFieldControl
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          label={field.label ?? fallbackLabel}
          kinds={options?.kinds}
        />
      </FieldLabel>
    ),
  };
}

/**
 * Feature 169 (`specs/169-page-builder-contact-form/` FR-014): the link field's
 * anchor control as a Puck field of its own, holding a bare anchor (no `#`) —
 * the sections of the canvas as it is now, or free text normalised to the
 * anchor grammar when it loses focus. `cms.PageNavigation`'s links use it.
 * Create it once, at module level: a field recreated per render loses focus.
 */
export function createAnchorField(label?: string): CustomField<string | undefined> {
  const fallbackLabel = label ?? 'Anchor';
  return {
    type: 'custom',
    label: fallbackLabel,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? fallbackLabel} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <AnchorControl value={value ?? ''} readOnly={readOnly} onChange={onChange} />
      </FieldLabel>
    ),
  };
}

// ── Compatibility: the slug-only link target of today's Button and Hero ──

function LegacyLinkSlugControl({
  value,
  onChange,
  readOnly,
  label,
  linkTypeProp,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly?: boolean | undefined;
  label: string;
  linkTypeProp: string;
}): ReactElement {
  const linkType = usePageBuilderPuck((s) => {
    const props = s.selectedItem?.props as Record<string, unknown> | undefined;
    const raw = props?.[linkTypeProp];
    return typeof raw === 'string' ? raw : 'url';
  });
  const slug = value ?? '';

  switch (linkType) {
    case 'product':
      return (
        <SingleProductFieldControl value={slug} label={label} {...(readOnly === true ? { readOnly: true } : {})} onChange={onChange} />
      );
    case 'category':
      return (
        <SingleCategoryFieldControl value={slug} label={label} {...(readOnly === true ? { readOnly: true } : {})} onChange={onChange} />
      );
    case 'page':
      return <PageSelect value={slug} readOnly={readOnly} label={label} onChange={onChange} />;
    default:
      return <UrlInput value={slug} readOnly={readOnly} label={label} onChange={onChange} />;
  }
}

/**
 * The slug picker of `cms.Button`'s `linkSlug` and `cms.Hero`'s
 * `buttonLinkSlug`, switched by the sibling `linkType` prop — moved here from
 * `cms`' admin components unchanged in what it stores, so both blocks keep
 * working until their reshape moves them onto {@link createLinkField}.
 */
export function createButtonLinkSlugField(options?: {
  label?: string;
  linkTypeProp?: string;
}): Field<string, Record<string, unknown>> {
  const fallbackLabel = options?.label ?? 'Link target';
  return {
    type: 'custom',
    label: fallbackLabel,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <LegacyLinkSlugControl
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={field.label ?? fallbackLabel}
        linkTypeProp={options?.linkTypeProp ?? 'linkType'}
      />
    ),
  };
}

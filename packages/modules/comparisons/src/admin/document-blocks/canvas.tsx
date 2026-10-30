import type { CSSProperties, ReactElement } from 'react';
import type { ComponentConfig, Config } from '@puckeditor/core';
import { unitPriceDisplayText, type ComparisonDocumentData } from '@endora-commerce/contracts';
import { createColorField } from '@endora-commerce/page-builder-core';
import { useBlockRenderEnvironment, useDocumentSample } from '@endora-commerce/page-builder-core/contributions';

/**
 * The canvas half of the three comparison document blocks
 * (`specs/152-compare-pdf-template/contracts/comparison-document.md` §6).
 *
 * Each draws over the comparison **sample the server serves** for the edited
 * type (`useDocumentSample`) — the same data *Preview PDF* renders (FR-016).
 * The PDF itself is drawn by `comparisons`' backend blocks; these approximate
 * it. Fields, labels and defaults are the manifest declaration's; the entries
 * here only replace a field's editor where a better one exists (booleans as
 * yes/no, colours as a picker).
 */

type Props = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const flag = (v: unknown, fallback: boolean): boolean =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : fallback;
const align = (v: unknown): CSSProperties['textAlign'] => (v === 'center' || v === 'right' ? v : 'left');

function pick(value: Readonly<Record<string, string>>, language: string): string {
  if (value[language] !== undefined) return value[language];
  const primary = language.split('-')[0];
  const sameBase = Object.keys(value).find((key) => key.split('-')[0] === primary);
  return (sameBase ? value[sameBase] : undefined) ?? value['en-US'] ?? Object.values(value)[0] ?? '';
}

const yesNo = (label: string) => ({
  type: 'radio' as const,
  label,
  options: [
    { label: 'Yes', value: true },
    { label: 'No', value: false },
  ],
});

const note: CSSProperties = { color: '#475569', fontSize: 11 };

function Header(props: Props): ReactElement {
  const sample = useDocumentSample<ComparisonDocumentData>();
  const mode = sample?.view.displayMode ?? 'all';
  const caption = str(
    props[mode === 'all' ? 'modeLabelAll' : mode === 'common' ? 'modeLabelCommon' : 'modeLabelDifferences'],
  );
  return (
    <div style={{ textAlign: align(props['align']), marginBottom: num(props['marginBottom'], 12) }}>
      <div style={{ fontSize: num(props['titleSize'], 16) + 2, fontWeight: 700, color: str(props['titleColor'], '#111827') }}>
        {str(props['title'])}
      </div>
      {flag(props['showDate'], true) && sample ? (
        <div style={note}>
          {str(props['dateLabel'])} {sample.generatedAt.slice(0, 10)}
        </div>
      ) : null}
      {flag(props['showDisplayMode'], true) ? <div style={{ ...note, fontStyle: 'italic' }}>{caption}</div> : null}
      {flag(props['showPricedFor'], true) && sample ? (
        <div style={note}>
          {str(sample.view.pricedFor === 'organization' ? props['pricedForOrganizationText'] : props['pricedForChannelText'])}
        </div>
      ) : null}
    </div>
  );
}

function Table(props: Props): ReactElement {
  const sample = useDocumentSample<ComparisonDocumentData>();
  const { language } = useBlockRenderEnvironment();
  const products = sample?.view.products ?? [];
  const rows = (sample?.view.comparableAttributes ?? []).filter(
    (row) => !sample?.hideEmptyRows || row.values.some((value) => value !== null),
  );
  const border = `1px solid ${str(props['borderColor'], '#cbd5e1')}`;
  const cell: CSSProperties = { border, padding: 4, fontSize: num(props['fontSize'], 9) + 2 };
  const empty = str(props['emptyValue'], '—');
  const highlight = flag(props['highlightRows'], true);
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 12 }}>
      <thead>
        <tr style={{ background: str(props['headerBackground'], '#f1f5f9') }}>
          <th style={cell}>{str(props['attributeColumnLabel'])}</th>
          {products.map((product) => (
            <th key={product.id} style={cell}>
              {flag(props['showName'], true) ? <div>{product.name /* 168-shim: Global text */}</div> : null}
              {flag(props['showSku'], false) ? <div style={note}>{product.sku}</div> : null}
              {flag(props['showPrice'], true) ? (
                <div>{product.price ? `${unitPriceDisplayText(product.price.amount)} ${product.price.currency}` : empty}</div>
              ) : null}
              {flag(props['showAvailability'], false) ? (
                <div style={note}>{str(props[product.available ? 'availableText' : 'unavailableText'])}</div>
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            style={
              highlight
                ? { background: str(props[row.rowClass === 'common' ? 'commonColor' : 'differentColor'], 'transparent') }
                : undefined
            }
          >
            <th style={{ ...cell, textAlign: 'left' }}>{pick(row.label, language)}</th>
            {row.values.map((value, index) => (
              <td key={index} style={cell}>
                {value ?? empty}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShareLink(props: Props): ReactElement {
  const sample = useDocumentSample<ComparisonDocumentData>();
  const url = sample?.shareUrl ?? '';
  return (
    <div style={{ textAlign: align(props['align']), margin: '8px 0' }}>
      <div style={note}>{str(props['label'])}</div>
      {flag(props['showUrl'], true) ? <div style={{ color: '#1d4ed8', fontSize: 11 }}>{url}</div> : null}
      {flag(props['showQr'], false) ? (
        <div
          aria-hidden="true"
          style={{ display: 'inline-block', width: num(props['qrSize'], 80), height: num(props['qrSize'], 80), border: '4px dashed #0f172a' }}
        />
      ) : null}
    </div>
  );
}

/** `Config`-typed so the block-name estate counts these names as rendered. */
export const comparisonDocumentCanvas: Config = {
  components: {
    'comparisons.ComparisonHeader': {
      render: Header,
      fields: {
        titleColor: createColorField({ label: 'Title colour' }),
        showDate: yesNo('Show date'),
        showDisplayMode: yesNo('Show display mode'),
        showPricedFor: yesNo('Show whose prices'),
      },
    } as ComponentConfig,
    'comparisons.ComparisonTable': {
      render: Table,
      fields: {
        showImages: yesNo('Images'),
        showName: yesNo('Name'),
        showSku: yesNo('SKU'),
        showPrice: yesNo('Price'),
        showAvailability: yesNo('Availability'),
        highlightRows: yesNo('Highlight same / different rows'),
        commonColor: createColorField({ label: 'Same rows colour' }),
        differentColor: createColorField({ label: 'Different rows colour' }),
        headerBackground: createColorField({ label: 'Header background' }),
        borderColor: createColorField({ label: 'Border colour' }),
        showHiddenNote: yesNo('Note on hidden products'),
      },
    } as ComponentConfig,
    'comparisons.ComparisonShareLink': {
      render: ShareLink,
      fields: { showUrl: yesNo('Show address'), showQr: yesNo('Show QR code') },
    } as ComponentConfig,
  },
};

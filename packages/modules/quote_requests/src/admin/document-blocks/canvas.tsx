import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import type { ComponentConfig, Config } from '@puckeditor/core';
import { supportedLanguageOf, type QuoteRequestDocumentData } from '@endora-commerce/contracts';
import { getBundles, resolve, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { useBlockRenderEnvironment, useDocumentSample } from '@endora-commerce/page-builder-core/contributions';

/**
 * The canvas half of the four quote document blocks
 * (`specs/153-quote-request-pdf-template/contracts/quote-request-document.md` §2).
 *
 * Each draws over the quote **sample the server serves** for the edited type
 * (`useDocumentSample`) — the data *Preview PDF* renders. The PDF is drawn by
 * the module's backend blocks; these approximate it. A label the template
 * leaves empty prints, in the PDF, in the document's language; here it is
 * shown from this module's bundle in the operator's language.
 */

type Props = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const flag = (v: unknown, fallback: boolean): boolean =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : fallback;
const align = (v: unknown): CSSProperties['textAlign'] => (v === 'center' || v === 'right' ? v : 'left');
const note: CSSProperties = { color: '#475569', fontSize: 11 };
const heading: CSSProperties = { fontWeight: 700, marginBottom: 2 };

/**
 * The edited tree's language is the render environment the document-template
 * editor provides around its canvas (`useBlockRenderEnvironment`). When it is
 * the administrator's language the loaded bundle already holds it; otherwise
 * that language's bundle is fetched once per session, and until it arrives the
 * administrator's language stands in. The invoice canvas reads its labels the
 * same way (issue #888).
 */
const treeBundles = new Map<SupportedAdminLanguage, Promise<Bundle>>();

function treeBundle(language: SupportedAdminLanguage): Promise<Bundle> {
  let pending = treeBundles.get(language);
  if (!pending) {
    pending = getBundles(language).then((response) => response.bundles);
    // A failed read is not remembered, so the next canvas tries again.
    pending.catch(() => treeBundles.delete(language));
    treeBundles.set(language, pending);
  }
  return pending;
}

function useTreeLabels(): (key: string) => string {
  const { language: treeLanguage } = useBlockRenderEnvironment();
  const target = supportedLanguageOf(treeLanguage);
  const { language: admin, bundle, fallbackBundle, t } = useTranslationContext();
  const held = target === admin ? bundle : target === 'en' ? fallbackBundle : undefined;
  const [fetched, setFetched] = useState<{ language: SupportedAdminLanguage; bundle: Bundle } | null>(null);
  useEffect(() => {
    if (held) return undefined;
    let live = true;
    treeBundle(target).then(
      (loaded) => {
        if (live) setFetched({ language: target, bundle: loaded });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [held, target]);
  const own = held ?? (fetched?.language === target ? fetched.bundle : undefined);
  const english = admin === 'en' ? bundle : fallbackBundle;
  return (key) => {
    if (own) {
      const result = resolve({
        scope: 'quote_requests',
        key,
        language: target,
        bundle: own,
        ...(english ? { fallbackBundle: english } : {}),
      });
      if (result.outcome !== 'placeholder') return result.value;
    }
    return t('quote_requests', key);
  };
}

function useDate(): (iso: string | null) => string {
  const { language } = useBlockRenderEnvironment();
  return (iso) => {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(language || 'en-US', { dateStyle: 'long' }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  };
}

function Header(props: Props): ReactElement {
  const t = useTreeLabels();
  const sample = useDocumentSample<QuoteRequestDocumentData>();
  const date = useDate();
  const label = (key: string, fallbackKey: string): string => str(props[key], t(fallbackKey));
  const line = (text: string, value: string) => (value ? <div style={note}>{text.trim() ? `${text} ${value}` : value}</div> : null);
  return (
    <div style={{ textAlign: align(props['align']), marginBottom: num(props['marginBottom'], 12) }}>
      <div style={{ fontSize: num(props['titleSize'], 18) + 2, fontWeight: 700 }}>{label('title', 'documentBlocks.header.title')}</div>
      {flag(props['showNumber'], true) ? line(label('numberLabel', 'documentBlocks.header.number'), sample?.quote.businessId ?? '') : null}
      {flag(props['showIssueDate'], true) ? line(label('issueDateLabel', 'documentBlocks.header.issueDate'), date(sample?.generatedAt ?? null)) : null}
      {flag(props['showValidUntil'], true) ? line(label('validUntilLabel', 'documentBlocks.header.validUntil'), date(sample?.quote.expiresAt ?? null)) : null}
      {flag(props['showRevision'], true) && (sample?.quote.revisionNumber ?? 0) > 0
        ? line(label('revisionLabel', 'documentBlocks.header.revision'), String(sample?.quote.revisionNumber))
        : null}
    </div>
  );
}

function Parties(props: Props): ReactElement {
  const t = useTreeLabels();
  const sample = useDocumentSample<QuoteRequestDocumentData>();
  const buyer = sample?.buyer;
  const sections: { title: string; lines: (string | null | undefined)[] }[] = [];
  if (buyer) {
    sections.push({
      title: str(props['buyerHeading'], t('documentBlocks.parties.buyer')),
      lines: [
        buyer.organizationName,
        flag(props['showLegalName'], true) && buyer.legalName !== buyer.organizationName ? buyer.legalName : null,
        flag(props['showTaxId'], true) && buyer.taxId ? `${str(props['taxIdLabel'], t('documentBlocks.parties.taxId'))} ${buyer.taxId}` : null,
        ...(flag(props['showAddress'], true) && buyer.address
          ? [buyer.address.line1, buyer.address.line2, `${buyer.address.postalCode} ${buyer.address.city}`, buyer.address.country]
          : []),
      ],
    });
    if (flag(props['showCustomer'], true)) {
      sections.push({ title: str(props['customerHeading'], t('documentBlocks.parties.customer')), lines: [buyer.customerName, buyer.customerEmail] });
    }
  }
  if (flag(props['showSalesRep'], true) && sample?.salesRep) {
    sections.push({ title: str(props['salesRepHeading'], t('documentBlocks.parties.salesRep')), lines: [sample.salesRep.name, sample.salesRep.email] });
  }
  const stacked = props['layout'] === 'stacked';
  return (
    <div style={{ display: stacked ? 'block' : 'flex', gap: 16, marginBottom: num(props['marginBottom'], 12), fontSize: 12 }}>
      {sections.map((section, i) => (
        <div key={i} style={{ flex: 1, marginBottom: stacked ? 6 : 0 }}>
          {section.title.trim() ? <div style={heading}>{section.title}</div> : null}
          {section.lines.filter((line): line is string => typeof line === 'string' && line.trim() !== '').map((line, j) => (
            <div key={j}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Notes(props: Props): ReactElement | null {
  const t = useTreeLabels();
  const sample = useDocumentSample<QuoteRequestDocumentData>();
  const text = (sample?.quote.headerNote ?? '').trim();
  if (text === '' && !flag(props['showWhenEmpty'], false)) return <div style={{ ...note, fontStyle: 'italic' }}>—</div>;
  const label = str(props['label'], t('documentBlocks.notes.label'));
  return (
    <div style={{ marginBottom: num(props['marginBottom'], 12), fontSize: 12 }}>
      {label.trim() ? <div style={heading}>{label}</div> : null}
      <div style={{ fontStyle: flag(props['italics'], false) ? 'italic' : 'normal' }}>{text}</div>
    </div>
  );
}

function Details(props: Props): ReactElement {
  const t = useTreeLabels();
  const sample = useDocumentSample<QuoteRequestDocumentData>();
  const details = sample?.details ?? [];
  const title = str(props['heading'], t('documentBlocks.details.heading'));
  return (
    <div style={{ marginBottom: num(props['marginBottom'], 12), fontSize: 12 }}>
      {title.trim() ? <div style={heading}>{title}</div> : null}
      {props['layout'] === 'list' ? (
        details.map((d, i) => <div key={i}>{`${d.label}: ${d.value}`}</div>)
      ) : (
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            {details.map((d, i) => (
              <tr key={i}>
                <th scope="row" style={{ textAlign: 'left', paddingRight: 8 }}>
                  {d.label}
                </th>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export const quoteDocumentCanvas: Config = {
  components: {
    'quote_requests.QuoteHeader': { render: Header } as ComponentConfig,
    'quote_requests.QuoteParties': { render: Parties } as ComponentConfig,
    'quote_requests.QuoteNotes': { render: Notes } as ComponentConfig,
    'quote_requests.QuoteDetails': { render: Details } as ComponentConfig,
  },
};

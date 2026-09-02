import type { ReactNode } from 'react';
import { toAbsoluteAssetUrl } from '../lib/asset-url';

/**
 * Feature 002 US3 — Product Attachments list for the PDP.
 *
 * Groups attachments by AttachmentType (Certificate, Tech spec, Product
 * card, PDF, …) so customers can scan by purpose. Each row renders the
 * attachment name, an optional description, and a download anchor that
 * targets the underlying Asset's url (CDN/storage handles the actual
 * download). Host-relative `/assets/file/…` paths are rebased onto the
 * public API origin — the same contract as gallery images — so the
 * browser does not fetch HTML from the storefront and save it as a PDF.
 */

export interface AttachmentItem {
  id: string;
  position: number;
  name: string;
  description: string | null;
  type: { id: string; code: string; name: Record<string, string> };
  asset: {
    id: string;
    kind: string;
    url: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
  };
}

function localizeTypeName(name: Record<string, string>, locale: string): string {
  return (
    name[locale] ??
    name['en-US'] ??
    Object.values(name)[0] ??
    ''
  );
}

export function AttachmentsList(props: {
  attachments: AttachmentItem[];
  locale: string;
}): ReactNode {
  if (props.attachments.length === 0) return null;

  // Group preserving the first-seen order of each type code so attachments
  // appearing earlier in the original (positioned) list also surface their
  // type group earlier — admins can curate ordering through positions.
  const groups = new Map<string, { typeName: string; items: AttachmentItem[] }>();
  for (const att of props.attachments) {
    const existing = groups.get(att.type.code);
    if (existing) {
      existing.items.push(att);
    } else {
      groups.set(att.type.code, {
        typeName: localizeTypeName(att.type.name, props.locale),
        items: [att],
      });
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {Array.from(groups.entries()).map(([code, group]) => (
        <div key={code}>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
            {group.typeName}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {group.items.map((att) => (
              <li key={att.id} className="py-1">
                <a
                  className="text-[13px] text-accent hover:text-accent-hover"
                  href={toAbsoluteAssetUrl(att.asset.url)}
                  rel="noopener"
                  target="_blank"
                  download={att.asset.filename}
                >
                  {att.name}
                </a>
                {att.description ? (
                  <p className="mt-0.5 text-[12px] text-muted">{att.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

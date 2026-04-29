import type { ReactNode } from 'react';

/**
 * Feature 002 US3 — Product Attachments list for the PDP.
 *
 * Groups attachments by AttachmentType (Certificate, Tech spec, Product
 * card, PDF, …) so customers can scan by purpose. Each row renders the
 * attachment name, an optional description, and a download anchor that
 * targets the underlying Asset's url (CDN/storage handles the actual
 * download).
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
    <section className="b2b-attachments">
      {Array.from(groups.entries()).map(([code, group]) => (
        <div key={code} className="b2b-attachments__group">
          <h3 className="b2b-attachments__type">{group.typeName}</h3>
          <ul>
            {group.items.map((att) => (
              <li key={att.id} className="b2b-attachment">
                <a
                  className="b2b-attachment__link"
                  href={att.asset.url}
                  rel="noopener"
                  target="_blank"
                  download={att.asset.filename}
                >
                  {att.name}
                </a>
                {att.description ? (
                  <p className="b2b-attachment__description">{att.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Package, ShoppingCart } from 'lucide-react';
import {
  splitOpportunityReferenceText,
  type OpportunityReference,
} from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export interface ReferenceTextProps {
  /** The stored text, tokens and all. */
  text: string;
  /** The references the server resolved for this text, for this reader. */
  references: readonly OpportunityReference[];
}

const CHIP =
  'mx-0.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 align-baseline text-xs';

/**
 * A description, a note or a message as it is read (User Story 12, FR-045):
 * the text as text, and each `[[product:…]]` / `[[order:…]]` token as a chip.
 *
 * **The text is never interpreted.** Every stretch between tokens is a text
 * node, so markup somebody typed is shown as the characters they typed.
 *
 * A reference the server resolved links to the Product or the Order under its
 * current name or number. One it could not resolve — the target is gone, or
 * this reader may not see it — is a chip that says so, without a link and
 * without the name: an Order of another Organization is not leaked by its
 * number here.
 */
export function ReferenceText(props: ReferenceTextProps): ReactNode {
  const t = useTranslation('crm');
  const resolved = new Map(props.references.map((item) => [`${item.type}:${item.id}`, item]));

  return (
    <>
      {splitOpportunityReferenceText(props.text).map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>;
        const reference = resolved.get(`${part.type}:${part.id}`);
        const Icon = part.type === 'product' ? Package : ShoppingCart;
        if (reference?.available && reference.url && reference.label) {
          return (
            <Link
              key={index}
              to={reference.url}
              className={`${CHIP} bg-muted/50 font-medium text-primary underline-offset-4 hover:underline`}
            >
              <Icon aria-hidden="true" className="size-3" />
              <span className="sr-only">{t(`references.kind.${part.type}`)}</span>
              {reference.label}
            </Link>
          );
        }
        return (
          <span
            key={index}
            className={`${CHIP} border-dashed text-muted-foreground`}
            title={t('references.unavailableHint')}
          >
            <Icon aria-hidden="true" className="size-3" />
            {t(`references.unavailable.${part.type}`)}
          </span>
        );
      })}
    </>
  );
}

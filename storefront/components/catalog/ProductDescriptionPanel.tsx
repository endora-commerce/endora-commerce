import type { ReactNode } from 'react';
import type { ProductPageContentAttribute } from '@endora-commerce/contracts';
import { ProductContent } from './ProductContent';

/**
 * The "Opis" (description) tab's panel (feature 172, FR-030, OR-1): the plain
 * description first — the paragraph the page has always drawn — then each
 * content attribute in the order received, which is the attribute set's
 * position order. Product-level: a selected variant changes nothing here.
 */
export function ProductDescriptionPanel({
  text,
  content,
}: {
  text: string | null;
  content: readonly ProductPageContentAttribute[];
}): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      {text ? (
        <p className="max-w-[70ch] whitespace-pre-line text-[15px] leading-[1.7] text-muted">{text}</p>
      ) : null}
      {content.map((attribute) => (
        <ProductContent
          key={attribute.key}
          attributeKey={attribute.key}
          content={attribute.content}
          language={attribute.language}
        />
      ))}
    </div>
  );
}

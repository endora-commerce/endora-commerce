import type { ReactNode } from 'react';
import Link from 'next/link';
import type { BlogProductCard } from '@endora-commerce/contracts';

export function RelatedProductsStrip({
  products,
}: {
  products: BlogProductCard[];
}): ReactNode {
  if (products.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-2xl font-semibold text-[--ink-700]">Related products</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <Link
            key={product.id}
            href={`/p/${product.slug}`}
            className="group flex flex-col overflow-hidden rounded-lg border border-[--line] bg-[--surface] transition hover:shadow-lg"
          >
            {product.mainImageUrl ? (
              <div className="relative aspect-square overflow-hidden bg-[--surface-alt]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.mainImageUrl}
                  alt=""
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center bg-[--surface-alt] text-[--ink-300]">
                <span className="font-mono text-sm">{product.slug}</span>
              </div>
            )}
            <div className="flex flex-1 flex-col gap-2 p-4">
              <h3 className="text-base font-semibold leading-snug text-[--ink-700] group-hover:text-[--brand-700]">
                {product.name}
              </h3>
              {product.price ? (
                <span className="font-mono text-sm text-[--ink-700]">
                  {product.price.amount} {product.price.currency}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

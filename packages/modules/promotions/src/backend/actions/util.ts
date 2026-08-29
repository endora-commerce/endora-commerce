import type { CartLine } from '@endora-commerce/contracts';

/** Round to 2 decimal places (money). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function cartSubtotal(lines: readonly CartLine[]): number {
  return round2(lines.reduce((acc, l) => acc + l.unitPrice.amount * l.quantity, 0));
}

/** A single purchasable unit expanded from a cart line (one per quantity). */
export interface CartUnit {
  productId: string;
  variantId: string | null;
  price: number;
}

/** Expand cart lines into individual units (one entry per quantity). */
export function expandUnits(lines: readonly CartLine[]): CartUnit[] {
  const units: CartUnit[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i += 1) {
      units.push({ productId: line.productId, variantId: line.variantId, price: line.unitPrice.amount });
    }
  }
  return units;
}

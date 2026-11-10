/**
 * Feature 159 — the layout of a new order's lines
 * (`specs/159-quote-request-item-groups/contracts/orders-api.md` §1–§2,
 * research R-16, R-17; invariants I-O2, I-O3).
 *
 * Pure. `OrderService.placeOrder` asks one of three questions inside its
 * transaction and writes the answer before the order's lines:
 *
 * - {@link carryQuoteGrouping} — the order is the vouched order of an accepted
 *   quote: its lines take the quote lines' groups and order (FR-050, FR-051);
 * - {@link adminLayout} — an administrator created the order with a grouping
 *   (FR-061);
 * - {@link basketLayout} — every other order: no group, the basket's order.
 *
 * A layout names groups by a *source* reference — the quote group's id, or the
 * request's group key — which the writer turns into fresh `order_item_groups`
 * rows. Every group of a layout holds at least one line (D2, I-O2), groups and
 * each section's lines are numbered `0…` (I-O3).
 */

/** A quote line as `quoteRequestReadPort.listItems` answers it, in the quote's display order. */
export interface QuoteLineForCarry {
  readonly productId: string;
  readonly variantId: string | null;
  readonly agreedUnitPrice: string | null;
  /** The quoted (agreed) quantity; absent on a structural stub of the port. */
  readonly quantity?: number;
  /** Absent on a record from a port written before feature 159. */
  readonly position?: number;
  /** Absent as above; `null` = ungrouped. */
  readonly group?: { readonly id: string; readonly name: string; readonly position: number } | null;
}

/** An order line about to be written, in basket order; `key` is the caller's handle on it. */
export interface OrderLineForCarry {
  readonly key: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly unitPrice: string;
  /** Absent: quantity takes no part in the matching. */
  readonly quantity?: number;
}

export interface LaidOutGroup {
  /** The quote group's id, or the request's group key. */
  readonly sourceId: string;
  readonly name: string;
  readonly position: number;
}

export interface OrderLineLayout {
  /** Non-empty groups, in display order, positions `0…g-1`. */
  readonly groups: LaidOutGroup[];
  /** Every order line by key: its group (`null` = ungrouped) and its position within its section. */
  readonly lines: Map<string, { groupSourceId: string | null; position: number }>;
}

/** The contract's name for a carried layout. */
export type CarriedGrouping = OrderLineLayout;

/**
 * The grouping an administrator's creation request carries into placement
 * (`placeOrder`'s `options.lineGrouping`; not on `OrderPlacementPort`).
 */
export interface OrderLineGroupingInput {
  /** In display order. */
  readonly groups: readonly { readonly key: string; readonly name: string }[];
  /**
   * Every request line, in request order. The admin creation seeds one basket
   * line per request line, in this order, and never merges two of them
   * (research N-31), so one product may sit on lines of several groups.
   */
  readonly lines: readonly {
    readonly productId: string;
    readonly variantId: string | null;
    readonly quantity: number;
    readonly groupKey: string | null;
  }[];
}

/** No group; positions in basket order. */
export function basketLayout(order: readonly OrderLineForCarry[]): OrderLineLayout {
  return {
    groups: [],
    lines: new Map(order.map((line, position) => [line.key, { groupSourceId: null, position }])),
  };
}

/**
 * Assemble a layout from each line's section and rank. `groupOrder` lists
 * candidate groups in display order; those receiving no line are dropped and
 * the rest renumbered. Within a section lines sort by rank, ties by basket order.
 */
function assemble(
  order: readonly OrderLineForCarry[],
  groupOrder: readonly { sourceId: string; name: string }[],
  placeOf: (line: OrderLineForCarry, basketIndex: number) => { groupSourceId: string | null; rank: number },
): OrderLineLayout {
  const sections = new Map<string | null, Array<{ key: string; rank: number; basketIndex: number }>>();
  order.forEach((line, basketIndex) => {
    const place = placeOf(line, basketIndex);
    const section = sections.get(place.groupSourceId) ?? [];
    section.push({ key: line.key, rank: place.rank, basketIndex });
    sections.set(place.groupSourceId, section);
  });
  const lines = new Map<string, { groupSourceId: string | null; position: number }>();
  const groups: LaidOutGroup[] = [];
  const known = new Set(groupOrder.map((group) => group.sourceId));
  const write = (groupSourceId: string | null) => {
    const members = sections.get(groupSourceId) ?? [];
    members
      .sort((a, b) => a.rank - b.rank || a.basketIndex - b.basketIndex)
      .forEach((member, position) => lines.set(member.key, { groupSourceId, position }));
  };
  for (const group of groupOrder) {
    if ((sections.get(group.sourceId)?.length ?? 0) === 0) continue;
    groups.push({ sourceId: group.sourceId, name: group.name, position: groups.length });
    write(group.sourceId);
  }
  // A line naming a group the candidates do not hold is ungrouped.
  for (const [section, members] of sections) {
    if (section !== null && !known.has(section)) {
      const ungrouped = sections.get(null) ?? [];
      ungrouped.push(...members);
      sections.set(null, ungrouped);
      sections.delete(section);
    }
  }
  write(null);
  return { groups, lines };
}

/**
 * Pair each order line, in basket order, with one candidate: pass by pass, every
 * line's match under a pass claimed before any line tries the next, so a looser
 * match never takes the candidate another line matches more exactly. Each
 * candidate is claimed once. Answers order line key → candidate index.
 */
function claimInPasses<C>(
  order: readonly OrderLineForCarry[],
  candidates: readonly C[],
  passes: ReadonlyArray<(candidate: C, line: OrderLineForCarry, candidateIndex: number, basketIndex: number) => boolean>,
): Map<string, number> {
  const claimed = new Set<number>();
  const matchOf = new Map<string, number>();
  for (const accept of passes) {
    order.forEach((line, basketIndex) => {
      if (matchOf.has(line.key)) return;
      const index = candidates.findIndex((c, i) => !claimed.has(i) && accept(c, line, i, basketIndex));
      if (index < 0) return;
      claimed.add(index);
      matchOf.set(line.key, index);
    });
  }
  return matchOf;
}

/**
 * The quote's grouping, carried onto the order placed from it (FR-050–FR-051).
 *
 * Each order line, in basket order, claims a quote line: first by product,
 * variant, agreed quantity and agreed unit price, then by product, variant and
 * price, then by product, variant and quantity, then by product and variant
 * alone — every line's closer match claimed before any looser one, so a line
 * whose price or quantity moved cannot take the quote line another line
 * matches exactly (research N-31: one product may sit on several quote lines,
 * in different groups, at one price). A matched line
 * takes its quote line's group and its place in the quote's display order; an
 * unmatched line is ungrouped, after the matched ungrouped lines, in basket
 * order. Quote groups receiving no line are dropped.
 *
 * Records carrying neither `group` nor `position` (a port written before the
 * feature) carry nothing: the basket's order, no group.
 */
export function carryQuoteGrouping(
  quote: readonly QuoteLineForCarry[],
  order: readonly OrderLineForCarry[],
): CarriedGrouping {
  if (quote.every((line) => line.group === undefined && line.position === undefined)) return basketLayout(order);

  const sameItem = (q: QuoteLineForCarry, o: OrderLineForCarry) =>
    q.productId === o.productId && (q.variantId ?? null) === (o.variantId ?? null);
  const sameQuantity = (q: QuoteLineForCarry, o: OrderLineForCarry) =>
    q.quantity !== undefined && o.quantity !== undefined && q.quantity === o.quantity;
  const samePrice = (q: QuoteLineForCarry, o: OrderLineForCarry) =>
    q.agreedUnitPrice != null && Number(q.agreedUnitPrice) === Number(o.unitPrice);
  // Research N-31 — one product split over several quote lines at one price is
  // told apart by its agreed quantity, so the exact pass names it too.
  const matchOf = claimInPasses(order, quote, [
    (q, o) => sameItem(q, o) && sameQuantity(q, o) && samePrice(q, o),
    (q, o) => sameItem(q, o) && samePrice(q, o),
    (q, o) => sameItem(q, o) && sameQuantity(q, o),
    sameItem,
  ]);

  // Candidate groups by their quote position, ties by first appearance.
  const groupOrder: Array<{ sourceId: string; name: string; position: number; seen: number }> = [];
  quote.forEach((line, seen) => {
    if (line.group && !groupOrder.some((group) => group.sourceId === line.group!.id)) {
      groupOrder.push({ sourceId: line.group.id, name: line.group.name, position: line.group.position, seen });
    }
  });
  groupOrder.sort((a, b) => a.position - b.position || a.seen - b.seen);

  return assemble(order, groupOrder, (line, basketIndex) => {
    const index = matchOf.get(line.key);
    if (index === undefined) return { groupSourceId: null, rank: quote.length + basketIndex };
    return { groupSourceId: quote[index]!.group?.id ?? null, rank: index };
  });
}

/**
 * An administrator's grouping applied to the placed lines (FR-061). The basket
 * holds one line per request line in request order (research N-31), so a
 * basket line takes the request line at its own index when product, variant
 * and quantity agree; otherwise, as a safety net, the first unclaimed request
 * line of the same product, variant and quantity, then of the same product and
 * variant. Within a section lines follow the request; a basket line no request
 * line accounts for is ungrouped, last.
 */
export function adminLayout(order: readonly OrderLineForCarry[], grouping: OrderLineGroupingInput): OrderLineLayout {
  const groupOrder = grouping.groups.map((group) => ({ sourceId: group.key, name: group.name }));
  type Requested = OrderLineGroupingInput['lines'][number];
  const sameItem = (r: Requested, o: OrderLineForCarry) =>
    r.productId === o.productId && (r.variantId ?? null) === (o.variantId ?? null);
  const sameQuantity = (r: Requested, o: OrderLineForCarry) => o.quantity === undefined || r.quantity === o.quantity;
  const matchOf = claimInPasses(order, grouping.lines, [
    (r, o, requestIndex, basketIndex) => requestIndex === basketIndex && sameItem(r, o) && sameQuantity(r, o),
    (r, o) => sameItem(r, o) && sameQuantity(r, o),
    sameItem,
  ]);
  const requestSize = grouping.lines.length;
  return assemble(order, groupOrder, (line, basketIndex) => {
    const index = matchOf.get(line.key);
    if (index === undefined) return { groupSourceId: null, rank: requestSize + basketIndex };
    return { groupSourceId: grouping.lines[index]!.groupKey, rank: index };
  });
}

/**
 * Read an administrator's creation request into a {@link OrderLineGroupingInput}:
 * every line kept, in request order. One product and variant may sit on lines
 * of several groups (research N-31, superseding the earlier `group_conflict`).
 */
export function planAdminLineGrouping(
  groups: readonly { key: string; name: string }[],
  items: readonly {
    productId: string;
    variantId?: string | null | undefined;
    quantity: number;
    groupKey?: string | null | undefined;
  }[],
): OrderLineGroupingInput {
  return {
    groups: groups.map(({ key, name }) => ({ key, name })),
    lines: items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      groupKey: item.groupKey ?? null,
    })),
  };
}

/**
 * The layout's shape — `stateAfter.groups` of the `order.place_on_behalf` audit
 * entry (FR-081): each group's line count, in display order. Never its name: a
 * group name is free text, and the audit log carries no tenant value (D-288).
 */
export function layoutShape(layout: OrderLineLayout): Array<{ lineCount: number }> {
  const lines = [...layout.lines.values()];
  return layout.groups.map((group) => ({
    lineCount: lines.filter((line) => line.groupSourceId === group.sourceId).length,
  }));
}

export interface LedgerNumberingLookup {
  numberingModeFor(salesChannelId: string | null): Promise<'endora' | 'vendor'>;
  activeVendorModuleId(): Promise<string | null>;
}

/**
 * Mode B wait: vendor numbering and an active ledger vendor keep the invoice
 * pending so PDF/email wait for applyVendorAssignedNumber.
 */
export async function shouldHoldForVendorNumber(
  routing: LedgerNumberingLookup | undefined,
  salesChannelId: string | null,
): Promise<boolean> {
  if (!routing) return false;
  const [mode, vendor] = await Promise.all([
    routing.numberingModeFor(salesChannelId),
    routing.activeVendorModuleId(),
  ]);
  return mode === 'vendor' && vendor !== null;
}

/**
 * Shared Apple Pay availability (Safari / Apple devices with ApplePaySession).
 * Used to hide `*_apple_pay` methods at checkout when the client cannot pay.
 */

type ApplePaySessionStatic = {
  canMakePayments(): boolean;
  supportsVersion(version: number): boolean;
};

/**
 * An Apple Pay method, by the suffix its code carries rather than by the
 * gateway that seeded it.
 *
 * `specs/134-paid-module-extraction/` T041, ruling O-1(b) — every gateway that
 * seeds an Apple Pay method is a fragment the shop copies into its own
 * storefront, so an allow-list of the ids this tree used to carry would stop
 * hiding the option for exactly the shops that copied one in. The seeded codes
 * are `<adapter>_apple_pay` by convention across every gateway this platform
 * has carried.
 */
export function isApplePayMethodCode(code: string): boolean {
  return code.endsWith('_apple_pay');
}

export function isApplePayAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const AP = (window as Window & { ApplePaySession?: ApplePaySessionStatic }).ApplePaySession;
  if (!AP) return false;
  try {
    return AP.canMakePayments() && AP.supportsVersion(3);
  } catch {
    return false;
  }
}

/**
 * Drop Apple Pay methods until the browser proves support.
 * On the server / first paint we hide them so unsupported devices never see
 * the option; after mount we re-include them when `ApplePaySession` works.
 */
export function filterPaymentMethodsForApplePaySupport<T extends { code: string }>(
  methods: T[],
  applePaySupported: boolean,
): T[] {
  if (applePaySupported) return methods;
  return methods.filter((m) => !isApplePayMethodCode(m.code));
}

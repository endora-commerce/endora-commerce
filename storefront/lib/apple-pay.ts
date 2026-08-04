/**
 * Shared Apple Pay availability (Safari / Apple devices with ApplePaySession).
 * Used to hide `*_apple_pay` methods at checkout when the client cannot pay.
 */

type ApplePaySessionStatic = {
  canMakePayments(): boolean;
  supportsVersion(version: number): boolean;
};

const APPLE_PAY_METHOD_CODES = new Set([
  'payu_apple_pay',
  'stripe_apple_pay',
]);

export function isApplePayMethodCode(code: string): boolean {
  return APPLE_PAY_METHOD_CODES.has(code);
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

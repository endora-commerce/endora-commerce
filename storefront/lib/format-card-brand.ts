/**
 * Pretty-print a stored payment-card brand for account / checkout UI.
 * Accepts raw provider values (`visa`, `mc`, `card`, …) and BIN-detectable
 * masked PANs when the stored brand is generic.
 */
export function formatCardBrand(brand?: string | null, numberOrMask?: string | null): string {
  const normalized = normalizeBrand(brand);
  if (normalized && normalized !== 'Card') return normalized;

  const digits = String(numberOrMask ?? '').replace(/\D/g, '');
  if (digits.length >= 2) {
    const detected = detectFromDigits(digits);
    if (detected) return detected;
  }
  return normalized || 'Card';
}

function normalizeBrand(raw?: string | null): string {
  if (!raw) return '';
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const map: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    master: 'Mastercard',
    mc: 'Mastercard',
    maestro: 'Maestro',
    amex: 'American Express',
    americanexpress: 'American Express',
    diners: 'Diners Club',
    dinersclub: 'Diners Club',
    discover: 'Discover',
    jcb: 'JCB',
    unionpay: 'UnionPay',
    card: 'Card',
    unknown: 'Card',
  };
  if (map[key]) return map[key]!;
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function detectFromDigits(digits: string): string | null {
  if (digits.startsWith('4')) return 'Visa';
  if (digits.startsWith('34') || digits.startsWith('37')) return 'American Express';
  const two = Number(digits.slice(0, 2));
  if (two >= 51 && two <= 55) return 'Mastercard';
  if (digits.length >= 4) {
    const four = Number(digits.slice(0, 4));
    if (four >= 2221 && four <= 2720) return 'Mastercard';
    if (four >= 3528 && four <= 3589) return 'JCB';
  }
  if (two === 50 || (two >= 56 && two <= 69)) return 'Maestro';
  if (digits.startsWith('6011') || digits.startsWith('65')) return 'Discover';
  if (digits.startsWith('62')) return 'UnionPay';
  return null;
}

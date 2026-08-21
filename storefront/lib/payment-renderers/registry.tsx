import type { ReactNode } from 'react';
import type { PaymentMethodSummary } from '../api/methods';
import { PaymentMethodIcon, StripeMark } from './icons';
import { tForLocale } from '../i18n/messages';

/**
 * Storefront payment-method renderer registry (feature 034, FR-016/FR-017).
 *
 * Each payment method may declare a `rendererKey`; an adapter module can
 * register a custom renderer under that key. When a method has no renderer (or
 * the key is unknown), the platform default renderer is used — so every
 * eligible method always renders (the radio-row picker matching
 * `specs/b2b-platform-storefront-ui/examples/checkout/one-step-checkout.png`).
 */
export interface PaymentMethodRenderProps {
  method: PaymentMethodSummary;
  defaultChecked: boolean;
  currency?: string | undefined;
  locale?: string | undefined;
}

export type PaymentMethodRenderer = (props: PaymentMethodRenderProps) => ReactNode;

function pickName(name: Record<string, string>): string {
  return name.default ?? name['en-US'] ?? name.en ?? Object.values(name)[0] ?? '';
}

export const DefaultPaymentMethodRenderer: PaymentMethodRenderer = ({
  method,
  defaultChecked,
  currency,
}) => (
  <label style={{ display: 'flex', alignItems: 'center' }}>
    <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
    <PaymentMethodIcon method={method} />
    {pickName(method.name)}
    {method.additionalPrice > 0 ? (
      <span className="muted">{` +${method.additionalPrice.toFixed(2)}${currency ? ` ${currency}` : ''}`}</span>
    ) : null}
  </label>
);

/**
 * Renderer key for the single collapsed "Stripe" option shown at checkout when
 * the Stripe display mode is `redirect` (feature 049). The concrete payment
 * method (card, BLIK, P24, wallets) is chosen on Stripe's hosted page, so we
 * present one option plus an informational note instead of the sub-methods.
 */
export const STRIPE_REDIRECT_RENDERER_KEY = 'stripe_redirect';
export const TPAY_REDIRECT_RENDERER_KEY = 'tpay_redirect';
export const PAYU_REDIRECT_RENDERER_KEY = 'payu_redirect';
export const AUTOPAY_REDIRECT_RENDERER_KEY = 'autopay_redirect';
export const PAYPAL_REDIRECT_RENDERER_KEY = 'paypal_redirect';

export const StripeRedirectRenderer: PaymentMethodRenderer = ({ method, defaultChecked }) => (
  <label style={{ display: 'block' }}>
    <span style={{ display: 'flex', alignItems: 'center' }}>
      <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          width: 34,
          marginRight: 8,
          verticalAlign: 'middle',
        }}
      >
        <StripeMark />
      </span>
      {pickName(method.name)}
    </span>
    <p className="muted" style={{ margin: '4px 0 0 24px', fontSize: '0.85em' }}>
      After you click “Place order”, you’ll be redirected to Stripe to complete your payment
      securely.
    </p>
  </label>
);

export const TpayRedirectRenderer: PaymentMethodRenderer = ({ method, defaultChecked, locale }) => {
  const t = tForLocale(locale ?? 'en-US');
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center' }}>
        <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
        <PaymentMethodIcon method={method} />
        {pickName(method.name)}
      </span>
      <p className="muted" style={{ margin: '4px 0 0 24px', fontSize: '0.85em' }}>
        {t('tpay.redirect.notice')}
      </p>
    </label>
  );
};

export const PayuRedirectRenderer: PaymentMethodRenderer = ({ method, defaultChecked, locale }) => {
  const t = tForLocale(locale ?? 'en-US');
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center' }}>
        <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
        <PaymentMethodIcon method={method} />
        {pickName(method.name)}
      </span>
      <p className="muted" style={{ margin: '4px 0 0 24px', fontSize: '0.85em' }}>
        {t('payu.redirect.notice')}
      </p>
    </label>
  );
};

export const AutopayRedirectRenderer: PaymentMethodRenderer = ({
  method,
  defaultChecked,
  locale,
}) => {
  const t = tForLocale(locale ?? 'en-US');
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center' }}>
        <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
        <PaymentMethodIcon method={method} />
        {pickName(method.name)}
      </span>
      <p className="muted" style={{ margin: '4px 0 0 24px', fontSize: '0.85em' }}>
        {t('autopay.redirect.notice')}
      </p>
    </label>
  );
};

export const PaypalRedirectRenderer: PaymentMethodRenderer = ({
  method,
  defaultChecked,
  locale,
}) => {
  const t = tForLocale(locale ?? 'en-US');
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center' }}>
        <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
        <PaymentMethodIcon method={method} />
        {pickName(method.name)}
      </span>
      <p className="muted" style={{ margin: '4px 0 0 24px', fontSize: '0.85em' }}>
        {t('paypal.redirect.notice')}
      </p>
    </label>
  );
};

const registry = new Map<string, PaymentMethodRenderer>();

export function registerPaymentMethodRenderer(key: string, renderer: PaymentMethodRenderer): void {
  registry.set(key, renderer);
}

registerPaymentMethodRenderer(STRIPE_REDIRECT_RENDERER_KEY, StripeRedirectRenderer);
registerPaymentMethodRenderer(TPAY_REDIRECT_RENDERER_KEY, TpayRedirectRenderer);
registerPaymentMethodRenderer(PAYU_REDIRECT_RENDERER_KEY, PayuRedirectRenderer);
registerPaymentMethodRenderer(AUTOPAY_REDIRECT_RENDERER_KEY, AutopayRedirectRenderer);
registerPaymentMethodRenderer(PAYPAL_REDIRECT_RENDERER_KEY, PaypalRedirectRenderer);

export function resolvePaymentMethodRenderer(rendererKey: string | null): PaymentMethodRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return DefaultPaymentMethodRenderer;
}

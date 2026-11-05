import type { ReactNode } from 'react';
import { formatMoney } from '../../lib/i18n/money';

/**
 * The Organization cart surfaces' shared presentation (issue #751), for
 * `/organization/carts` and `/organization/carts/[id]`. Server-only markup.
 */

/**
 * The cart's owner as the members page names a member: the name, the e-mail
 * beneath it. The API falls back to the e-mail for an owner with no name, and
 * then it is not repeated.
 */
export function OrgCartOwner({
  name,
  email,
}: {
  name: string;
  email: string | null;
}): ReactNode {
  return (
    <>
      {name}
      {email && email !== name ? <small className="block text-subtle">{email}</small> : null}
    </>
  );
}

/**
 * An amount as stored on the cart's lines — net — labelled so, as the cart
 * page labels its amounts. The API answers no gross for these surfaces, so
 * none is derived here.
 */
export function NetMoney({
  money,
  netLabel,
}: {
  money: { amount: number; currency: string };
  netLabel: string;
}): ReactNode {
  return (
    <>
      {formatMoney(money.amount, money.currency)}
      <span className="ml-[3px] text-[10px] font-normal text-muted">{netLabel}</span>
    </>
  );
}

import type { ReactNode } from 'react';
import {
  createShoppingList,
  deleteShoppingList,
  listShoppingLists,
  setDefaultShoppingList,
} from '../../../lib/api/shopping-lists';
import { getSessionCookie } from '../../../lib/session';
import { StorefrontApiError } from '../../../lib/api/client';
import { DeleteShoppingListButton } from '../../../components/shopping-lists/DeleteShoppingListButton';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale, type MessageKey } from '../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Shopping lists list (T205). Shows every list owned by the current
 * customer with item counts; lets the buyer create new lists and
 * delete old ones.
 */

export default async function ShoppingListsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/shopping-lists');
  const lists = await listShoppingLists(session);
  const params = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <>
      <h2>{t('account.shoppingLists.heading')}</h2>
      <p className="b2b-auth__hint">{t('account.shoppingLists.intro')}</p>
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <form action={createAction} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="new-name" className="text-sm text-fg-soft">
            {t('account.shoppingLists.create.label')}
          </label>
          <input
            id="new-name"
            name="name"
            required
            maxLength={160}
            placeholder={t('account.shoppingLists.create.placeholder')}
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <button type="submit" className="btn btn--primary">
          {t('account.shoppingLists.create.submit')}
        </button>
      </form>

      {lists.length === 0 ? (
        <p className="muted">{t('account.shoppingLists.empty')}</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>{t('account.common.name')}</th>
              <th>{t('account.common.items')}</th>
              <th>{t('account.shoppingLists.col.updated')}</th>
              <th>{t('account.shoppingLists.col.default')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id}>
                <td>
                  <LocalizedLink href={`/shopping-lists/${l.id}`}>{l.name}</LocalizedLink>
                </td>
                <td>{l.items.length}</td>
                <td>{new Date(l.updatedAt).toLocaleString(locale)}</td>
                <td>
                  {l.isDefault ? (
                    <span className="industria-status industria-status--paid">{t('account.shoppingLists.isDefault')}</span>
                  ) : (
                    <form action={setDefaultAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className="btn btn--outline btn--sm">
                        {t('account.shoppingLists.setDefault')}
                      </button>
                    </form>
                  )}
                </td>
                <td>
                  {l.isDefault ? (
                    // The default list can't be deleted — only cleared (from the
                    // list detail page). Keep it as the customer's permanent anchor.
                    <span className="text-subtle">—</span>
                  ) : (
                    <DeleteShoppingListButton
                      listId={l.id}
                      listName={l.name}
                      locale={locale}
                      deleteAction={deleteAction}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** A server action's own refusal, in the page's language. */
async function failure(key: MessageKey): Promise<string> {
  const { locale } = await getServerContext();
  return tForLocale(locale)(key);
}

async function createAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const name = ((formData.get('name') as string) ?? '').trim();
  if (!name) {
    const message = await failure('account.shoppingLists.nameRequired');
    return await localeRedirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  let id: string;
  try {
    const created = await createShoppingList(session, name);
    id = created.id;
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingLists.createFailed');
    return await localeRedirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/shopping-lists/${id}`);
}

async function deleteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await deleteShoppingList(session, id);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingLists.deleteFailed');
    return await localeRedirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/shopping-lists`);
}

async function setDefaultAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await setDefaultShoppingList(session, id);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingLists.setDefaultFailed');
    return await localeRedirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/shopping-lists');
}

import {
  ERROR_CODES,
  type AdminUserReadPort,
  type AdminUserRecord,
  type BlogAuthor,
  type BlogAuthorCandidate,
  type BlogPostAuthorAdmin,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 171 (US7, `specs/171-blog-i18n-authors/` research R10) — a post's author is
 * an administrator, read only through `adminUserReadPort` (Principle I).
 *
 * - An **inactive** administrator is still shown as the author of their posts; a new
 *   assignment must name an active one.
 * - A **deleted** administrator is not shown at all, and nothing of them is kept on
 *   the post (OR-4).
 * - The storefront gets the display name, the avatar URL and the biography — never
 *   the e-mail address, the role or the status. The cached post payload carries the
 *   author's id only and is enriched per request, so a profile edit shows at once.
 */
export class BlogAuthors {
  constructor(
    private readonly admins: AdminUserReadPort,
    /** A library asset's public URL, or `null` (the blog's own resolver). */
    private readonly assetUrl: (assetId: string) => Promise<string | null>,
  ) {}

  /** Refuse naming an administrator who does not exist, is deleted or is inactive. */
  async assertAssignable(adminUserId: string): Promise<void> {
    const admin = await this.admins.findById(adminUserId, { activeOnly: true });
    if (!admin || admin.status !== 'active') {
      throw new HttpError(
        422,
        ERROR_CODES.BLOG_AUTHOR_NOT_FOUND,
        'The author must be an active administrator.',
        [{ path: 'authorAdminUserId', issue: 'no active administrator with this id' }],
      );
    }
  }

  /** The author as the admin editor shows it, with its state. */
  async adminView(adminUserId: string | null): Promise<BlogPostAuthorAdmin | null> {
    if (!adminUserId) return null;
    const admin = await this.admins.findById(adminUserId);
    if (!admin) return { id: adminUserId, name: '', avatarUrl: null, state: 'deleted' };
    return {
      id: admin.id,
      name: displayName(admin),
      avatarUrl: await this.#avatar(admin),
      state: admin.deletedAt ? 'deleted' : admin.status === 'active' ? 'active' : 'inactive',
    };
  }

  /** Who may be named the author: active administrators, by name; `q` narrows by name. */
  async candidates(q?: string): Promise<BlogAuthorCandidate[]> {
    const needle = q?.trim().toLowerCase() ?? '';
    const admins = (await this.admins.listAll({ activeOnly: true }))
      .filter((admin) => admin.status === 'active')
      .filter((admin) => needle === '' || displayName(admin).toLowerCase().includes(needle))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return Promise.all(admins.map(async (admin) => ({ id: admin.id, name: displayName(admin), avatarUrl: await this.#avatar(admin) })));
  }

  /**
   * The storefront authors of these ids, in one read: a deleted administrator is
   * absent from the map. The biography is the request language's, else the channel
   * default's, else `null`.
   */
  async forStorefront(ids: readonly string[], language: string, channelDefault: string): Promise<Map<string, BlogAuthor>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, BlogAuthor>();
    if (unique.length === 0) return out;
    for (const admin of await this.admins.findByIds(unique)) {
      if (admin.deletedAt) continue;
      out.set(admin.id, {
        id: admin.id,
        name: displayName(admin),
        avatarUrl: await this.#avatar(admin),
        bio: pickText(admin.bio, language) ?? pickText(admin.bio, channelDefault),
      });
    }
    return out;
  }

  async #avatar(admin: AdminUserRecord): Promise<string | null> {
    return admin.avatarAssetId ? this.assetUrl(admin.avatarAssetId) : null;
  }
}

function displayName(admin: AdminUserRecord): string {
  return `${admin.firstName} ${admin.lastName}`.trim();
}

function pickText(map: Record<string, string> | null, language: string): string | null {
  if (!map) return null;
  const wanted = language.toLowerCase();
  const found = Object.entries(map).find(([code, text]) => code.toLowerCase() === wanted && text.trim() !== '');
  return found?.[1] ?? null;
}

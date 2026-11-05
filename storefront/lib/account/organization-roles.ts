import type {
  CreateOrganizationRoleRequest,
  DeleteOrganizationRoleRequest,
  UpdateOrganizationRoleRequest,
} from '@endora-commerce/contracts';
import type { MessageKey } from '../i18n/messages';

/**
 * The role screens' vocabulary (`specs/170-organization-roles/`, WP-09): what a
 * role form sends, and what travels from a server action back to the page.
 * Pure, so the pages and the actions share one spelling.
 *
 * **A code travels, never a sentence** — the rule of
 * `lib/account/org-cart-approval.ts`, for the same reason: a redirect's query
 * string is text anyone can put on an administrator's page with a crafted link.
 * The page names a code it knows and reads anything else as `FAILED`. For the
 * same reason no form state travels in a URL: a refused create or edit answers
 * its code as action state ({@link RoleFormState}) and the client form keeps
 * what was typed (`components/account/RoleEditorForm.tsx`). Only the deletion,
 * a plain server form, still redirects with `?error=<code>`.
 */

/** The bounds `createOrganizationRoleRequestSchema` applies (FR-004). */
export const ROLE_NAME_MAX_LENGTH = 80;
export const ROLE_DESCRIPTION_MAX_LENGTH = 500;

const FAILED = 'FAILED';

const ERROR_KEYS = {
  ORGANIZATION_ROLE_NAME_TAKEN: 'account.roles.error.ORGANIZATION_ROLE_NAME_TAKEN',
  ORGANIZATION_ROLE_STALE: 'account.roles.error.ORGANIZATION_ROLE_STALE',
  ORGANIZATION_ROLE_LIMIT_REACHED: 'account.roles.error.ORGANIZATION_ROLE_LIMIT_REACHED',
  ORGANIZATION_ROLE_PROTECTED: 'account.roles.error.ORGANIZATION_ROLE_PROTECTED',
  ORGANIZATION_ROLE_REPLACEMENT_REQUIRED: 'account.roles.error.ORGANIZATION_ROLE_REPLACEMENT_REQUIRED',
  ORGANIZATION_PERMISSION_UNKNOWN: 'account.roles.error.ORGANIZATION_PERMISSION_UNKNOWN',
  NOT_FOUND: 'account.roles.error.NOT_FOUND',
  FORBIDDEN: 'account.roles.error.FORBIDDEN',
  VALIDATION_FAILED: 'account.roles.error.VALIDATION_FAILED',
  [FAILED]: 'account.roles.error.FAILED',
} as const satisfies Record<string, MessageKey>;

export type RoleErrorCode = keyof typeof ERROR_KEYS;

/** Whether `code` is one the role pages can name. */
export function isRoleErrorCode(code: string): code is RoleErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_KEYS, code);
}

/**
 * What a role form's server action answers through `useActionState` when the
 * API refuses the write: the refusal's code, nothing of what was typed — the
 * client form keeps that itself (owner ruling on PR #715). Success navigates.
 */
export interface RoleFormState {
  readonly error: RoleErrorCode | null;
}

/** The sentence for `?error=<code>`, or `null` when there is no error parameter. */
export function roleErrorKey(code: string | undefined): MessageKey | null {
  if (code === undefined || code === '') return null;
  return ERROR_KEYS[isRoleErrorCode(code) ? code : FAILED];
}

/** Whether `?error=<code>` is about the name field, which then carries it (`aria-describedby`). */
export function isNameError(code: string | undefined): boolean {
  return code === 'ORGANIZATION_ROLE_NAME_TAKEN';
}

/** A count from the query string, or `0` for anything that is not a non-negative integer. */
export function countParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' ? value : null;
}

/** The ticked permission codes, each once, in the form's order. */
function permissionsOf(formData: FormData): string[] {
  const codes = formData.getAll('permissions').filter((v): v is string => typeof v === 'string' && v !== '');
  return [...new Set(codes)];
}

function versionOf(formData: FormData): number {
  const n = Number(text(formData, 'expectedVersion'));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** The role id a form names, or `null` when it names none. */
export function roleIdOf(formData: FormData): string | null {
  const id = text(formData, 'id');
  return id && id.trim() !== '' ? id.trim() : null;
}

/** `POST …/roles` — the name trimmed, an empty description left out. */
export function createRoleRequest(formData: FormData): CreateOrganizationRoleRequest {
  const description = text(formData, 'description')?.trim() ?? '';
  return {
    name: text(formData, 'name')?.trim() ?? '',
    ...(description !== '' ? { description } : {}),
    permissions: permissionsOf(formData),
  };
}

/**
 * `PATCH …/roles/:id` at the version the editor read. The *Member* role's form
 * carries no name field, so its save sends the permissions only — the API
 * refuses a name or a description for *Member*. A cleared description is
 * `null`, which clears the stored one.
 */
export function updateRoleRequest(formData: FormData): UpdateOrganizationRoleRequest {
  const name = text(formData, 'name');
  const description = text(formData, 'description');
  return {
    expectedVersion: versionOf(formData),
    ...(name !== null ? { name: name.trim() } : {}),
    ...(description !== null ? { description: description.trim() === '' ? null : description.trim() } : {}),
    permissions: permissionsOf(formData),
  };
}

/** `DELETE …/roles/:id` — the replacement only when the form named one (FR-024). */
export function deleteRoleRequest(formData: FormData): DeleteOrganizationRoleRequest {
  const replacementRoleId = text(formData, 'replacementRoleId')?.trim() ?? '';
  return {
    expectedVersion: versionOf(formData),
    ...(replacementRoleId !== '' ? { replacementRoleId } : {}),
  };
}

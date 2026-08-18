import type { PermissionCatalogueEntry } from './admin.js';

/**
 * `admin_roles` module contracts — the in-process port surface (feature 075,
 * Phase P).
 *
 * The module's HTTP shapes and the shared `PERMISSION_CATALOGUE` live in
 * `admin.ts`; what belongs here is behaviour — the fourteen inbound sites from
 * `admin_users`, `admin_actions`, `blog` and the dev seed.
 *
 * **Not here on purpose:** `AdminPermissionChecker`. `auth`'s guard resolves
 * `permissionService` for one method and the kernel already declares that
 * narrow shape at `src/kernel/ports/require-admin.ts`, because the guard is
 * the kernel's and every module's routes go through it. A second declaration
 * of the same method would be two answers to one question.
 *
 * Plain TypeScript rather than Zod: these describe in-process calls.
 */

/** An admin role as it crosses a module boundary — never the ORM entity. */
export interface AdminRoleRecord {
  id: string;
  code: string;
  name: string;
  /** Permission codes granted by this role. */
  permissions: string[];
  requiresTwoFactor: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAdminRoleInput {
  code: string;
  name: string;
  permissions: string[];
  requiresTwoFactor?: boolean;
}

/**
 * Container name: `adminRolePort`. Owner: `admin_roles`.
 *
 * (It said `adminRoleService` until issue #192. That name is registered — it is
 * the `AdminRoleService` **class**, a plain `di.register` with no presence gate,
 * whose `list()` returns `AdminRole` **entities**. `AdminRole` is structurally
 * assignable to `AdminRoleRecord`, so a consumer that copied the old name got an
 * ungated registration and entities across the boundary, and `tsc` said nothing.
 * Nothing in the tree ever did — `admin_users` resolves `adminRolePort` — but the
 * comment was a standing invitation to.)
 *
 * `admin_users` reads a role to render it beside its user and to enforce the
 * role's `requiresTwoFactor` at login. `remove` refuses a role whose code was
 * registered as system-protected (feature 016 FR-025), and that refusal stays
 * on this side of the port.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `admin_roles` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface AdminRolePort {
  list(): Promise<AdminRoleRecord[]>;
  getById(id: string): Promise<AdminRoleRecord>;
  findByCode(code: string): Promise<AdminRoleRecord | null>;
  upsertByCode(input: UpsertAdminRoleInput): Promise<AdminRoleRecord>;
  remove(id: string): Promise<void>;
}

/**
 * Container name: `systemRoleCodePort`. Owner: `admin_roles`.
 *
 * A **contribution seam**: a module that seeds a role registers its code here
 * so `remove` refuses to delete it. `blog` is the only contributor today, from
 * its own boot hook.
 *
 * It is a contribution rather than a call, so an absent contributor's code is
 * simply not protected — which is the correct answer, because a module that is
 * not installed has no seeded role to protect. That classification must not
 * change: gating the registration would let an operator delete a protected
 * role by switching its owner off for a moment.
 */
export interface SystemRoleCodePort {
  register(code: string): void;
  /** Every protected code, in registration order. */
  list(): readonly string[];
}

/**
 * Container name: `permissionCataloguePort`. Owner: `admin_roles`.
 *
 * (It said `permissionCatalogueService` until issue #192 — the same trap as
 * {@link AdminRolePort}: that name is a plain `di.register` of the
 * `PermissionCatalogueService` class, with no presence gate on it. The gated
 * registration is this one.)
 *
 * The permission codes an operator may actually grant — core
 * `PERMISSION_CATALOGUE` plus every registered module's manifest
 * `permissions`. `admin_users` renders the role editor from it.
 *
 * Synchronous by contract: the catalogue is assembled from manifests at
 * composition time and never queried.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `admin_roles` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface PermissionCataloguePort {
  listAssignable(): PermissionCatalogueEntry[];
}

/**
 * Container name: `permissionService`. Owner: `admin_roles`.
 *
 * The effective permission codes of one admin user, resolved through their
 * role. `admin_actions` reads it to filter the command palette, so an action
 * is never advertised to somebody who would get a 403 opening it.
 *
 * The single-permission check `auth`'s guard makes is deliberately not here —
 * see the file header.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `admin_roles` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface PermissionReadPort {
  listPermissions(adminUserId: string): Promise<string[]>;
}

/**
 * Issue #1279 — the storefront route a federated sign-in button links to
 * (`app/auth/federated/start/route.ts`). A module of its own, importing
 * nothing, so the button component can name it without pulling the route
 * handlers' `next/server` into a render.
 */
export const FEDERATED_SIGN_IN_START_PATH = '/auth/federated/start';

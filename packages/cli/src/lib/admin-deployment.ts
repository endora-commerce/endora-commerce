/**
 * Which deployment admin registry an admin build is built from
 * (`specs/190-overlay-full-modules/` FR-081, FR-084; `contracts/overlay-admin-layer.md` §3).
 *
 * Both trees' `admin/vite.config.ts` call this one function — this repository's and
 * every instance's — so an unset, a blank and a missing deployment mean the same
 * thing in each. The registries themselves are `./admin-artefacts.ts`'.
 *
 * ## The rules
 *
 * - `DEPLOYMENT` is read from the process environment, then from the root `.env`:
 *   the backend's own source, so the admin and the backend of one checkout are
 *   built for the same deployment. A variable the environment sets, even blank,
 *   wins over the file, as it does under `node --env-file`.
 * - Unset or blank selects `deployments/none.generated.ts`: bare core, no overlay.
 * - A named deployment with no registry **refuses the build**, naming the file and
 *   the command that renders it. Falling back to `none` would build an admin with
 *   that deployment's screens missing and no error anywhere.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEnvFile } from '../inputs/env-file.js';
import { DEPLOYMENT_REGISTRY_DIRECTORY, deploymentRegistryFileName } from './admin-artefacts.js';

/** The specifier `admin/src/main.tsx` imports the selected registry by. */
export const DEPLOYMENT_ADMIN_ALIAS = '@endora-commerce-deployment/admin';

/**
 * The packages an overlay admin layer must resolve to the admin project's own
 * copy of (FR-084): a layer under `apps/` sits outside the admin member, whose
 * `node_modules` its imports would otherwise never reach, and a second React is a
 * hook call that throws at render.
 */
export function adminSingletons(scope = '@endora-commerce/'): readonly string[] {
  return ['react', 'react-dom', `${scope}admin-kit`, `${scope}admin-shell`];
}

/** A named deployment the admin has no registry for — the build stops. */
export class DeploymentAdminRegistryError extends Error {
  override readonly name = 'DeploymentAdminRegistryError';
}

export interface DeploymentAdminRegistryInput {
  /** The admin project's source root, where `deployments/` is. */
  readonly adminSourceRoot: string;
  /** The process environment. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The root `.env` the backend reads `DEPLOYMENT` from. */
  readonly envFile: string;
  /** The command that renders the registries in this tree, for the refusal. */
  readonly regenerate: string;
}

export interface SelectedDeploymentAdminRegistry {
  /** `null` for bare core. */
  readonly deployment: string | null;
  /** Absolute path of the registry the alias resolves to. */
  readonly path: string;
}

function deploymentFrom(input: DeploymentAdminRegistryInput): string | null {
  const fromEnv = input.env['DEPLOYMENT'];
  const raw =
    fromEnv !== undefined
      ? fromEnv
      : existsSync(input.envFile)
        ? (parseEnvFile(readFileSync(input.envFile, 'utf8')).get('DEPLOYMENT') ?? '')
        : '';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The registry this build selects, or a refusal when it is not on disk. */
export function selectDeploymentAdminRegistry(
  input: DeploymentAdminRegistryInput,
): SelectedDeploymentAdminRegistry {
  const deployment = deploymentFrom(input);
  const path = join(input.adminSourceRoot, DEPLOYMENT_REGISTRY_DIRECTORY, deploymentRegistryFileName(deployment));
  if (!existsSync(path)) {
    throw new DeploymentAdminRegistryError(
      `${path} is not there, and it is the admin registry of ` +
        `${deployment === null ? 'bare core (DEPLOYMENT is unset)' : `the deployment '${deployment}' (DEPLOYMENT=${deployment})`}. ` +
        `An admin built without it would hold none of that deployment's overlay screens, with no ` +
        `error anywhere. Run \`${input.regenerate}\` — it renders one registry per deployment ` +
        `under apps/ — or correct DEPLOYMENT.`,
    );
  }
  return { deployment, path };
}

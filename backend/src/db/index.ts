/**
 * The ORM bootstrap's **binding** — one call, and nothing else
 * (`specs/110-instance-repository/` T116; `contracts/instance-repository.md`
 * R7.4).
 *
 * `initOrm()` boots MikroORM once and caches it; `getOrm()` returns it;
 * `closeOrm()` disposes it. All three are
 * `@endora-commerce/platform/db`'s since T116 — what is here is the one thing
 * the platform cannot supply itself: *which* configuration this process boots.
 * That answer runs through `./mikro-orm.config.js` to the two committed
 * registries, which are facts about this repository's tree (D-160.3) and which
 * the platform may not name (D-52/D-53).
 *
 * **The path and all three names are kept deliberately.** Twenty-odd files
 * import them — every composition root, the five `module:*` scripts, the test
 * harness, the dev seed and the acceptance probe — so moving the file would be
 * a rewrite whose entire content is a path, while moving the code is this one
 * call. An instance writes the same call against its own configuration.
 *
 * The bootstrap is created **once, at module scope**: the cached `MikroORM` is
 * the process's, and two creations would be two ORMs over one pool.
 */
import { createOrmBootstrap } from '@endora-commerce/platform/db';

import mikroOrmConfig from './mikro-orm.config.js';

const bootstrap = createOrmBootstrap(mikroOrmConfig);

export const initOrm = bootstrap.initOrm;
export const getOrm = bootstrap.getOrm;
export const closeOrm = bootstrap.closeOrm;

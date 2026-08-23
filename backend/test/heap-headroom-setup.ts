/**
 * Setup file — arms the per-file heap reading for every test file of every
 * shard (issue #199). The reasoning is in `test/heap-headroom.ts`; this file
 * exists only so that importing those functions in a unit test does not also
 * register the hook there.
 */
import { watchHeapHeadroom } from './heap-headroom.js';

watchHeapHeadroom();

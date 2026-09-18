/**
 * CI check — a `catch` around a gated-port call may not swallow the module's
 * presence answer (issue #84; the deferred half of feature 072's D-43).
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/port-catches.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This header is still the whole of the reasoning and the relocated
 * file points back at it. What stays here is this repository's population, its
 * module-population floor, its promise-form site floor, and the **ledger** —
 * `PORT_CATCHES_TO_DRAIN` is a set of entries about *these* modules, and it is
 * also what `check:lock-claims` reads `backend/scripts/check-*.ts` for, so moving
 * it into the package would take it out of that check's population with nothing
 * saying so.
 *
 * `lazyPort` resolves the name inside the *forwarded call*, so a switched-off
 * owner surfaces as `ModuleDisabledError` at the call site rather than at
 * wiring time. A `try { … } catch { return null }` around one therefore
 * converts fail-closed into fail-open, and does it silently: the caller answers
 * "no data" where the truthful answer is "this capability is off", and the
 * operator reads a working screen that is lying to them.
 *
 * The measured shape, before this check existed: 51 `try` blocks in `src/**`
 * reached a gated port; 27 already re-threw, and 24 did not. They were not one
 * bug repeated — they were three:
 *
 *   - **defensive** — a `catch` over a port whose own return type already says
 *     "nothing applies" (`resolveLinePrice` → `null`, `taxRateFor` →
 *     `{ rate: 0, source: 'none' }`). The `catch` adds nothing except the
 *     ability to hide a 503. Deleted.
 *   - **a degrade that belongs to the owner** — the caller genuinely wants "no
 *     restriction" or "no data" as an answer, in which case the answer belongs
 *     in the port's return type (`allowedIdsFor(): Promise<string[] | null>` is
 *     the repo's worked example), not in a `catch` at the call site.
 *   - **a narrow tolerance that is correct** — a per-item import failure
 *     recorded as an issue, a compensating cleanup on a rollback path. Those
 *     keep the `catch` and add `rethrowIfModuleDisabled(error)`, because a
 *     presence answer is about the whole operation rather than the one item: an
 *     import that "completed with 4 000 failures" is a worse report than one
 *     that stopped and named the module that is off.
 *
 * ## Two spellings of one rule: `try`/`catch` and `.catch(handler)`
 *
 * The rule is about **absorbing a presence answer**, not about a keyword, and
 * this check read the keyword for its first year: one `ts.CatchClause` and no
 * mention of `.catch` anywhere in it. So
 * `port.remove(id).catch(() => undefined)` was outside the population, and a
 * rule a caller leaves by changing punctuation is not a rule. Both spellings
 * are judged here, by one predicate ({@link bodyHandles}) over one site record,
 * because two implementations of "does this handler re-throw" are two answers
 * waiting to disagree.
 *
 * **`.then(onOk, onErr)`'s second argument is in scope**, stated rather than
 * left to be discovered: it *is* a rejection handler, and reading only
 * `.catch` would leave the identical swallow one keystroke away. `.finally(f)`
 * is **not** in scope, for the opposite reason: it consumes no rejection and
 * re-throws, so there is nothing there to swallow. What a promise-form site
 * guards is its **receiver chain** and nothing else — `p.then(ok, onErr)` does
 * not route `ok`'s own rejection to `onErr`, so a port called in the success
 * arm is not guarded by the arm beside it, while `p.then(ok).catch(onErr)`
 * guards `ok` and needs no special case, `ok` being inside the outer receiver.
 *
 * ### The bound worth knowing, because it is measured and it is not obvious
 *
 * Whether a `.catch` **actually** receives the presence answer depends on an
 * `async` boundary this analysis cannot see, and both answers occur for
 * byte-identical source text. `lazyPort`'s forwarding function is *synchronous*
 * — it reads `ctx.cradle()[name]`, where the transient gate throws — so:
 *
 *   - `proxy.method(x).catch(h)` **escapes the handler**: the throw happens
 *     while the receiver is being evaluated, before `.catch` is reached, and
 *     the error propagates to the caller. Fail-closed, by accident.
 *   - the same port behind anything `async` — a holder built around it (issue
 *     #133), a `this.` method (D-88), a hand-written adapter object, a
 *     decorated registration — turns that throw into a **rejection**, which
 *     `.catch(() => fallback)` swallows. Fail-open.
 *
 * Both were run rather than reasoned about, against the real `lazyPort`. The
 * check reports both, and that is a decision rather than an oversight: the
 * distinction is invisible at the call site, it is not stable under any
 * refactoring (wrapping a port in one `async` method flips it), and it is not
 * even stable under a change to `lazyPort` itself. The direction of the doubt
 * is the one this file takes everywhere else — report it — and the remedy is
 * correct in both worlds, being inert in the first and load-bearing in the
 * second. `orders`' confirmation recipients were the second kind, live, when
 * this widening landed.
 *
 * ## What counts as a gated-port call
 *
 * A gated port is a name registered through `ctx.di.providePort`. Reaching one
 * is spelled several ways, and the check follows the value rather than the
 * literal:
 *
 *   1. the port name itself, read from a cradle or destructured — `taxService`;
 *   2. a **local alias** a module binds to a `lazyPort` proxy —
 *      `const cartService = lazyPort<CartService>(ctx, 'cartService')`;
 *   3. a **deps-object key** or **constructor parameter** the proxy is passed
 *      as — `promotion: lazyPort(ctx, 'promotionService')` reached later as
 *      `this.promotion.applyToCart(…)`. This is the dominant shape by far: 121
 *      of the tree's ~130 `lazyPort` calls are property assignments in a deps
 *      object, so a check that only knew the port's own name would see almost
 *      none of them.
 *   4. a **holder built around it** — `new CartPricingRecompute(em,
 *      lazyPort(ctx, 'pricingService'), cache)` reached later as
 *      `deps.cartPricingRecompute.recompute(…)`. The `catch` wraps the holder,
 *      never the resolution (issue #133).
 *   5. a **name a root contributes** — `registerValues(container, {
 *      shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor() })`,
 *      resolved by the module as an ordinary cradle name. No `lazyPort` literal
 *      appears anywhere on that path (issue #113).
 *
 * Shapes 4 and 5 were one blind spot seen twice: the port arrived by a route the
 * analysis did not walk. Both close with **one** mechanism — the alias table is
 * a *fixpoint over port-carrying values* rather than a scan for `lazyPort`
 * literals. A value carries the gate if it is a resolution, if it is
 * constructed from one, if it is handed to a factory, or if it is a closure
 * whose body reads one; every name such a value is bound to becomes an alias,
 * and that feeds the next round until nothing new appears. Shape 4 is the round
 * that binds the holder; shape 5 is the round that binds a root's registration
 * key. Two shapes, one loop — which is why they are not two checks.
 *
 * What does **not** carry is as load-bearing as what does, and each exclusion
 * paid for itself in false positives when it was missing:
 *
 *   - **a call's result** — `proxy.applyToCart(…)` *is* the gated call, but the
 *     discount it returns is data. Propagating through an arbitrary callee made
 *     an alias of every local downstream of a port, `JSON.stringify` included;
 *   - **an object literal** — a deps bag is a record, not a port. Tainting the
 *     bag made `this.deps.<anything>()` in the receiving class a port call, 39
 *     of them in one run;
 *   - **a field read off a port** — `p.attributeValues[key]` is a value.
 *
 * ## The one hop backwards, and why it is not that propagation (D-88)
 *
 * A **method of the same class** whose body reaches a gated port is itself a
 * carrier *for the purposes of a `catch` around a call to it*. So
 * `try { await this.settlePaid(…) } catch { … }` is judged exactly as
 * `try { await this.receiveHandler.receive(…) } catch { … }` is.
 *
 * The next reader of "a call's **result** does not carry", sitting three lines
 * above a rule that follows calls, will assume one of the two is wrong. They are
 * not, and the difference is **directional**. The excluded rule runs *forward*:
 * from a port, through an arbitrary callee, into every local downstream of the
 * value it returned — which is how `JSON.stringify(x)` became a port and why one
 * run produced 39 false findings. This one runs *backward*: from a **callee's
 * body** to the **call site**, inside one class. Nothing about a value's
 * contents is inferred; the gates the method carries are exactly the gates its
 * body reaches, which is what feeds D-63's `OWNER LOCKED` derivation unchanged.
 *
 * The limit is `this`, and only `this`:
 *
 *   - **same class only** — `this.<name>(…)` where `<name>` is declared in the
 *     enclosing class. Not a free function, not an imported helper, not a method
 *     on an injected collaborator that is not itself a port.
 *   - **transitive through the class** — a private method calling another
 *     private method that reaches a gate carries too, bounded by the same
 *     fixpoint round-cap the alias table uses.
 *
 * What is **not** seen, deliberately: a helper in another file reached through
 * an import, a callback passed in from outside the class, a method on an
 * injected collaborator. Each of those is a value crossing a file boundary,
 * where the check would need whole-program call-graph resolution to stay
 * precise and where "port-carrying" stops being decidable from names. A class is
 * the one scope where the callee's body and the call site are guaranteed to be
 * in the same author's hands, which is why the line is drawn there and not one
 * hop further.
 *
 * The blast radius was measured before the widening landed: **8 sites, 7 of them
 * already correct by hand** — six payment and shipping gateways that each
 * derived the answer themselves and wrote three to five lines of comment
 * justifying it, plus one that re-throws unconditionally — and **one live
 * fail-open**, `organizations/services/org-registration-notifier.ts`, where
 * `onError?.(err)` swallowed a 503 from `admin_notifications` and every
 * organization registration went silently un-notified. That is the shape the
 * hop exists for: a public `handle(payload)`, a `try` around the domain
 * application, and private methods underneath that reach the port. It is the
 * dominant integration skeleton in this tree, which makes it the worst possible
 * place for a check to stop looking.
 *
 * ## Aliases are scoped, and by the scope the binding actually has (issue #278)
 *
 * A `const` is file-scoped, because it is: `catalog` renames its bulk-operation
 * service to `queue` in one file and holds a BullMQ queue under the same
 * spelling in another. A **deps-object key** is module-scoped, because the
 * receiving class reads it as `this.deps.<key>` from another file and a property
 * name is not a lexical binding anybody can shadow. A root's container
 * registration is visible everywhere, because a container name is global by
 * construction. A gated port's own name is global too, *except inside the module
 * that owns it*, where the same identifier normally denotes the module's own
 * instance — `invoices` holds a real `invoiceService` and never resolves its own
 * port.
 *
 * A **constructor or function parameter** is scoped to the file that *declares*
 * it, and this is the correction issue #278 is about. It used to be scoped to
 * the module of the **call site** — which is neither where the parameter is in
 * scope nor, when the callee lives in another module, a place the parameter can
 * be read at all. The cost was measured for real: building `orderTransitionPort`
 * (feature 085, Phase B), an author named a constructor parameter
 * `transitionService`, and an **unrelated local variable of that spelling** in
 * `orders/prompt-tools.ts` became a reported violation with no code change of
 * its own. The author renamed the parameter to clear it, and the rename hid a
 * `catch` that is a genuine fail-open (issue #278) — so the over-approximation
 * did not merely add noise, it *removed* a finding by making an author route
 * around it. A parameter binding is in scope inside its own function or class
 * body, both of which are in the declaring file; scoping it there is strictly
 * more accurate in **both** directions, and it also reaches the class in another
 * module that the call-site rule could never see.
 *
 * On top of that, a **bare identifier is resolved lexically**: when the nearest
 * enclosing binding of that spelling manifestly holds no port, the wider alias
 * does not apply there. That is the general form of the same rule — a name binds
 * a port only where the binding is in scope — and it is what stops a
 * module-scoped deps key from claiming an unrelated local in a sibling file.
 *
 * **"Manifestly" is the load-bearing word**, and getting it wrong costs
 * findings. The carriage analysis under-approximates on purpose (a call's
 * *result* is data), so `carries` answering "no" means either "not a port" or
 * "cannot follow this" — and only the first may shadow. Reading the second as a
 * shadow was tried and measured: `catalog`'s
 * `const customFields = this.#requireCustomFields()` holds `custom_fields`'
 * gated port through a call the analysis cannot follow, and shadowing on it took
 * six `catch` sites in `attribute-commands.ts` out of the population. So
 * {@link manifestlyNotAPort} is a syntactic allow-list — a literal, an object or
 * array of non-ports, a `new` whose arguments are those, a primitive-valued
 * operator — and a call, an identifier, a property access, a closure, a
 * destructuring binding, an import, a `catch` variable and a parameter with no
 * default all leave the wider alias standing. The direction of the doubt is
 * "report it".
 *
 * The shadowing applies to bare identifiers **only**: `x.promotion` reads a
 * property, and a property name has no lexical binding to shadow it, so the
 * receiver shapes (`this.deps.promotion`, `cradle().taxService`) are untouched.
 * A binding the alias table *did* introduce — a `const` bound to a proxy, a
 * parameter the port was passed as — is a carrier and is never a shadow.
 *
 * **The old over-approximation had a safety argument, and it survives where it
 * was actually made.** It was made about {@link Analysis.gatesOf} — merging
 * *gates* by name, which can only add owners and so can only make `OWNER LOCKED`
 * harder to satisfy. `gatesOf` is untouched here, and {@link gatesIn} stays
 * shadow-blind for exactly that reason. The argument was never made about alias
 * **visibility**, and does not transfer to it: a wider alias does not add owners
 * to a site, it invents a site — and a site invented in one module is a site an
 * author deletes by renaming something in another.
 *
 * `PORT_CATCH_WHY=1` prints every alias with the site that introduced it, which
 * is the first question a newly-red site raises.
 *
 * ## What counts as handling it
 *
 * A `catch` passes when it does one of four things:
 *
 *   - re-throws unconditionally (its last statement is a `throw`);
 *   - calls `rethrowIfModuleDisabled(error)` — the kernel's one-line narrowing;
 *   - names `ModuleDisabledError` itself;
 *   - hands the error to a **delegate that re-throws it** — a helper whose last
 *     statement is `throw <its own parameter>` (`toCatalogHttpError(…): never`)
 *     or whose body calls the narrowing on the caller's behalf
 *     (`ReturnEmailNotifier#contained`). Without this the widening reported
 *     eight sites that were already correct.
 *
 * Anything else is a violation, including `catch (err) { if (rare) throw err; }`
 * — a conditional re-throw is exactly the shape that keeps the presence answer.
 * Adding the one-line call is cheaper than teaching a static check to read a
 * condition, and it says at the site what the site decided. `ModuleDisabledError`
 * is an `HttpError`, so a status-code test lets it through by accident rather
 * than by decision, which is why the shape is refused and not merely disliked.
 *
 * The promise form answers the same four ways over the handler's body, plus two
 * that only a reference can express: `.catch(rethrowIfModuleDisabled)` and
 * `.catch(someRethrowingDelegate)`. `.catch((e) => { if (rare) throw e; })` is
 * refused identically — same predicate, same reason.
 *
 * ## `OWNER LOCKED` — the answer the check derives for itself (D-63)
 *
 * A `catch` can only swallow a presence answer that is **reachable**. When
 * every gate the alias carries belongs to a module whose manifest declares
 * `activation.nonDeactivatable`, no **undeclared** absence can produce that
 * state: the orchestrator refuses deactivation, disable and uninstall alike,
 * with no `--force`, and a composition that omits the module refuses to boot
 * (D-101, `assertLockedModulesPresent`). A deployment that **declared** the
 * omission does reach the state, and the deactivation-consequence ledger is
 * where that is recorded — which is what the declaration is read against. The
 * site is reported as `OWNER LOCKED` rather than as a violation to drain, and a
 * ledger entry for one reads **stale** — there is nothing left to repair, so a
 * note saying "drain me" is a debt the tree does not owe.
 *
 * This paragraph said "there is no state in which that gate says no" until
 * D-101. Two states existed even then — a deployment that never shipped the
 * module, and a `module_registrations` row written before D-69 locked it, which
 * the boot reconciler inserts around and never repairs. Both refuse the boot
 * now, so the claim is true again *with the qualifier*, and the qualifier is
 * the part that has to survive the next edit.
 *
 * It is derived from `manifest.ts` on every run rather than written into a
 * reason string, and that is the whole of its safety: an owner who un-locks a
 * module re-reds every site that was resting on that lock, in the same run,
 * with no ledger edit. A hand-written "locked" would go stale in silence, which
 * is the failure mode a two-way ledger exists to prevent.
 *
 * It is **not** "ignore this file". The `catch` still swallows every other
 * error and the check still names the site; what changes is what the reader is
 * being asked to do about it.
 *
 * ## Population floors
 *
 * Two, because the module floor cannot see the second. `refuseVacuousModulePopulation`
 * refuses a walk that came back short of the modules the generated index
 * registers (issue #215) — and it is satisfied by *any* file a module
 * contributes, none of which need hold a promise at all. So a `.catch`
 * recogniser that stopped resolving would leave that floor green and print
 * `violations=0` over a population nothing was judging. The census of
 * **rejection handlers read**, port-reaching or not, is the second floor, and
 * zero is exit 2 — `check:subscribe-seam`'s worker half, one check across.
 *
 * Usage: `tsx scripts/check-port-catches.ts [--list]`
 * Exit 0 = every such site handles it (or is ledgered, or its owners are
 * locked); exit 1 = at least one does not, or a ledger entry is stale; exit 2 =
 * the walk read nothing it was supposed to read.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  checkPortCatches,
  collectPortCatchFiles,
  findPortCatches,
  keyOf,
} from '@endora-commerce/cli/rules/port-catches.js';
import {
  loadManifestActivations,
  type ManifestActivationInput,
} from './lib/switchable-modules.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/port-catches.js';

export const PORT_CATCHES_TO_DRAIN: Readonly<Record<string, string>> = {
  'packages/modules/organizations/src/backend/routes.public.ts:onLogin':
    'LEDGER-PERMANENT (D-70), and the tolerance here is the requirement rather than ' +
    'a swallow somebody forgot to narrow. Feature 037 FR-007/FR-008 and SC-004 say ' +
    'in so many words that a merge failure must not break the login, and the `catch` ' +
    'covers four failure modes of which a presence answer is one: a transient ' +
    'database error, a concurrent merge, a malformed cookie token. Narrowing it with ' +
    '`rethrowIfModuleDisabled` would be worse than deleting it, not a compromise — ' +
    '`setSessionCookie` has already written the session cookie onto the response at ' +
    'routes.public.ts:160, so the 503 would reach a buyer who is authenticated, ' +
    'which is the same argument the `webhooks` entry makes about a delivery already ' +
    'attempted. What makes the site safe is not the shape of the `catch`: `carts` is ' +
    'locked, and the comparison adoption is now **decided** in the root contribution ' +
    '(`composition.ts`, `effectiveState.isPresent("comparisons")`) rather than ' +
    'attempted, so no presence answer reaches this `catch` at all. Two tests hold ' +
    'both halves, and deleting either half fails one of them: ' +
    '`test/contract/auth/customer-login-cart-merge.contract.test.ts:203` goes red if ' +
    'the `catch` goes, and ' +
    '`test/contract/organizations/login-comparisons-off.contract.test.ts` goes red if ' +
    'the probe goes — its third assertion, that no `cart_merge_on_login_failed` line ' +
    'is logged, is what tells a decided adoption from a caught one, because the ' +
    'first two assertions pass with no probe at all. Nothing is: do not drain this.',
  'packages/modules/webhooks/src/backend/services/webhook-delivery-worker.ts:recordDelivery':
    'LEDGER-PERMANENT, and not because nobody has looked (D-60). This is a ' +
    '**self-edge**: `webhooks` resolves its own gated port per call, deliberately, ' +
    'so a job draining mid-flight still meets the gate. The only reachable presence ' +
    'answer is an operator flipping the module off *between* the HTTP attempt and ' +
    'the bookkeeping write, and both alternatives to swallowing it are worse. ' +
    'Re-throwing fails the BullMQ job after the endpoint was called, so the retry ' +
    'delivers the same event twice — the one outcome a webhook consumer must not ' +
    'see. A probe before the attempt cannot help, because the flip happens after ' +
    'it. "The attempt and its record being one write" was the retiring question ' +
    'this entry used to carry; it is a distributed-transaction wish rather than a ' +
    'fix, and it is not what this entry is waiting for. Nothing is: do not drain ' +
    'this by narrowing it.',
  'packages/modules/catalog/src/backend/plugin.ts:svc#promise':
    'A HOLDER WHOSE GATES THIS CALL DOES NOT REACH, and there is no rename that ' +
    'clears it. `bulkOperationService` is constructed with `admin_notifications`, ' +
    "`transactional_emails`, `admin_users` and `search`'s ports (issue #133's holder " +
    'rule, which attributes a value and not a method), so every call through it reads ' +
    'as a port call — including `findPendingIds()`, which is a database read on this ' +
    "module's own manager. The `catch` guards a boot-time re-enqueue of rows left " +
    '`pending`; the only other thing in the chain is `bulkOperationQueue.add`. What the ' +
    'operator sees while any of those four modules is off: exactly what they see today ' +
    '— the rows are enqueued onto the durable queue and the ports are reached later, ' +
    'inside the worker, where `processById` answers the presence question for them. ' +
    '`rethrowIfModuleDisabled` is not available here and would not be an improvement: ' +
    'the chain is `void`ed at boot, so a re-throw is an unhandled rejection rather than ' +
    'an answer to anybody, which is D-62/D-67 verbatim. Retires when the analysis ' +
    "attributes a holder's gates per method rather than per value — not before, and " +
    'not by renaming the binding, because the alias follows the value.',
  'packages/modules/product_feeds/src/backend/services/feed-generation.service.ts:deliverArtefact#promise':
    'AFTER THE FACT — the shape is right, the argument written beside it is not, and ' +
    'this is drainable rather than permanent. The site absorbs a presence answer from ' +
    'the inline (no-Redis) delivery path after the artefact is published and the run ' +
    'row is `finished`. Its comment cites the `webhooks` entry below, and the load-' +
    'bearing half of that argument does not transfer: `webhooks` re-throws into a ' +
    'BullMQ retry that would deliver the same event **twice**, a duplicate side effect ' +
    'the consumer must not see. Nothing is delivered here, so there is no duplicate — ' +
    'what is left is only "do not fail a run that succeeded", which is real and is ' +
    'satisfied by **recording** the refusal rather than by discarding it. What the ' +
    'operator sees today: a published feed, no delivery attempt row, and no reason — ' +
    'they cannot tell an unreachable Redis from a `credentials` module they themselves ' +
    'switched off, which is the disclosure Principle XVII exists for. The entry retires ' +
    'when the inline path writes a delivery attempt whose failure names the absent ' +
    'module, which is this module\'s own attempt history doing the job it already has ' +
    '(`delivery-config.service.ts` keeps that history precisely so "did the partner get ' +
    'last month\'s file?" stays answerable). That is a `product_feeds` product change ' +
    'and not a `catch` somebody forgot to narrow, which is why it is ledgered and not ' +
    'repaired here.',
  'packages/modules/product_feeds/src/backend/index.ts:run':
    'BOOT HOOK, and now a genuine tolerance rather than a swallowed presence ' +
    'answer (issue #147, D-62). The hook asks ' +
    "`effectiveState.isPresent('product_feeds')` first, and outside every `try` — " +
    'outside, because `runBootHooks` does not catch: it re-throws as ' +
    '`ModuleCompositionError` and `index.ts` exits (issue #146, D-67), so a ' +
    '`ModuleDisabledError` raised inside the `try` would either take out the boot ' +
    'or share one silent no-op with a transient failure. With the presence question ' +
    'answered before the work, the only thing left for the `reconcile` helper to ' +
    'absorb is an ordinary failure of the reconcile itself — an unbootable API ' +
    'costing no more than a drifted schedule the next boot repairs. Narrowing it to ' +
    're-throw was tried and reverted: it changed what the harness boots with, and ' +
    'three `product_feeds` taxonomy contract tests went red. Permanent, therefore, ' +
    'with the reason stated: the presence question this entry used to hold has been ' +
    'moved out of the `catch` and is pinned by ' +
    '`test/unit/product_feeds/boot-reconcile-presence.test.ts`.',
};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a): the application's source tree and
  // every module that has become a workspace package.
  const layout = await requireModuleLayout('[port-catches]');
  const files = collectPortCatchFiles(layout.sourceRoots);

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  // The manifest read below refuses a tree whose index went missing, which
  // covers the module directory disappearing whole. It does not cover a
  // **partial** move — index regenerated, half the modules elsewhere — where
  // every remaining `catch` is classified and the count simply drops (issue
  // #215). That needs a per-module floor, from the same index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[port-catches]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  // The locks, read from the manifests rather than listed here (D-63), through
  // the helper `check-entry-presence` reads too (D-68). The same index
  // `check-port-dependencies.ts` derives `neverAbsentOwners` from, so no two of
  // the three can disagree about which modules are locked.
  let manifests: readonly ManifestActivationInput[];
  try {
    manifests = await loadManifestActivations(layout.manifestIndexPath);
  } catch (err: unknown) {
    console.error(
      `[port-catches] the manifest index could not be read (${String(err)}) — every site ` +
        'would read as unlocked, refusing to report a classification nothing was read for',
    );
    process.exit(2);
    return;
  }

  const catchInput = {
    sources,
    manifests,
    hostResidentModules: layout.hostResidentModules,
  };
  // The ledger is passed, never defaulted: a host states which exemptions it is
  // judging against, and `PORT_CATCHES_TO_DRAIN` is this repository's.
  const result = checkPortCatches(catchInput, PORT_CATCHES_TO_DRAIN);
  const result_all = listMode ? findPortCatches(catchInput) : [];

  if (listMode) {
    for (const entry of result_all) {
      const tag = entry.handled
        ? 'HANDLED '
        : entry.ownerLocked
          ? 'LOCKED  '
          : PORT_CATCHES_TO_DRAIN[keyOf(entry)] !== undefined
            ? 'LEDGERED'
            : 'BARE    ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.port} ` +
          `(${entry.form})`,
      );
    }
    console.log('');
  }

  if (result.ownerLocked.length > 0) {
    console.log(
      'OWNER LOCKED — the `catch` stays, and there is nothing to drain: every gate it\n' +
        'carries belongs to a module the platform refuses to switch off, so the presence\n' +
        'answer it would swallow is unreachable. Un-lock an owner and these come back:\n',
    );
    for (const entry of result.ownerLocked) {
      console.log(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] via ${entry.port} ` +
          `— locked by ${entry.gateOwners.join(', ')} (gates: ${entry.gates.join(', ')})`,
      );
    }
    console.log('');
  }

  // The promise form's own floor. `refuseVacuousModulePopulation` above is
  // satisfied by any file a registered module contributes, and a file need hold
  // no promise at all — so a `.catch` recogniser that stopped resolving would
  // leave the module floor green and print `violations=0` over a tree nothing
  // was judging. This is the same refusal `check:subscribe-seam` makes about
  // its worker half, for the same reason.
  if (result.rejectionHandlerSites === 0) {
    console.error(
      '[port-catches] no promise-form rejection handler was read anywhere in ' +
        `${sources.size} files — a tree this size holds \`.catch(h)\` and ` +
        '`.then(ok, onErr)`, so this is the recogniser having gone blind rather than ' +
        'the tree being clean, and a clean line over an unjudged population is the one ' +
        'thing a check may not print',
    );
    process.exit(2);
    return;
  }

  // What was read, in the shared grammar (issue #244). The sites around a gated
  // port are the finer population: every one of them is classified below, so a
  // narrowing that stops recognising a port shows up here as fewer sites rather
  // than as the same reassuring `violations=0`.
  reportReadSize({
    prefix: '[port-catches]',
    files: sources.size,
    sites: result.total,
    coverage: [coverage],
  });
  console.log(
    `[port-catches] guarded-port catches=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `owner-locked=${result.ownerLocked.length} ` +
      `rejection-handlers=${result.rejectionHandlerSites} ` +
      `ledger-size=${Object.keys(PORT_CATCHES_TO_DRAIN).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA `catch` around a gated-port call — `try`/`catch` or `.catch(handler)` —\n' +
        'swallows `ModuleDisabledError`.\n' +
        'Delete it if it was only defensive, move the degrade into the port`s return\n' +
        'type, or keep it and add `rethrowIfModuleDisabled(error)`:\n',
    );
    for (const entry of result.violations) {
      console.error(`  - ${entry.file}:${entry.line}  [${entry.moduleId}] via ${entry.port}`);
    }
  }
  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries (no longer describe a bare catch, or the site is now\n' +
        'OWNER LOCKED and has nothing left to drain — delete them):',
    );
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

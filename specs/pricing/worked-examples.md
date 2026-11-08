# Pricing — worked examples and test vectors

The product owner's three target scenarios (E1–E3) and the cases that chose the precedence (F, S, T, Q vectors), and the cases the owner's rulings of 2026-10-21 decide (C∩, configurable precedence, H, A, K, U, V, D vectors), and the display-mode withholding of issue #491 (W vectors), each as **inputs → expected price → which row wins and why**, under the proposed model, with today's answer where it differs. They are written to become the failing-first tests of the pricing-model feature (Constitution III) and to answer "what should this cost?" without re-deriving the algorithm.

**Verified against** `master` at `b1021c71b` on 2026-10-21; §10.11 re-checked for the P0 read-path hardening (branch `fix/pricing-read-path-hardening` on `fd6255339`) on 2026-10-21; §10.16 re-checked at `e3f456957` on 2026-10-24 (vectors G1–G4). §10.17 written against `2716908b3` on 2026-10-24 (issue #417) and rewritten for the owner's VAT ruling of the same day; §10.16 and §10.17 recomputed and §10.18 written for the four-place unit-price ruling of 2026-10-25 against `ad06079a4` (branch `fix/four-place-unit-prices`); §10.17 extended for issue #428 (refunds outside `payments`, the overpayment, the on-account case, section summaries) against `9e43c3412` on 2026-10-25; §10.19 written for issue #491 against `92dba80a9` on 2026-10-28 (branch `fix/491-display-mode-none-withholds-amounts`); §10.20 written for issue #492 on 2026-10-28 (branch `fix/492-retire-ispublic`); §10.17 R2 and DC1 recomputed for issue #435 on 2026-11-07 (branch `fix/435-invoice-kept-lines`); §10.17 correction rule, L0 and the K1, K2 and P1 vectors written for issues #873 and #885 on 2026-11-08 (branch `fix/873-kept-quantity-from-corrections`); §10.17 return rule, line ceiling and the O1, P2 and P3 vectors written for issues #874 and #875 on 2026-11-08 (branch `fix/874-875-returns-kept-state`). File:line citations are as of `b1021c71b`; re-check them before relying on one.

**The "Today" lines** under each vector record what the **pre-160** engine (the Application rule
and the Default list) answered, as the comparison the model was decided against. Since feature 160
the shipped engine answers the **Expected** column (`current-model.md`); the vectors are its tests
under `backend/test/integration/price_lists/worked-examples/`, and the demo reproduces E1–E3
(`backend/test/integration/price_lists/demo-scenarios.test.ts`).

**Section numbers.** `§N` references follow the numbering of the original analysis, which is split across this directory: §1 → `current-model.md`; §2 → `read-paths-and-performance.md` (its summary table); §3–§9, §11, §12 → `decision-record.md`; §10 → `worked-examples.md`. `read-paths §N` points into `read-paths-and-performance.md`, `peers §N` into `peer-platforms.md`. Path abbreviations: `PL/` = `packages/modules/price_lists/src/`, `CON/` = `packages/contracts/src/`, `CAT/` = `packages/modules/catalog/src/`, `SF/` = `storefront/`.

---

## 10. Worked examples as test vectors

### 10.1 Fixture (shared)

- Channel **CH** "B2B PL", default currency PLN; currency **PLN**.
- Category **Screws**; category **Bolts**.
- Attribute **color**: `select`, `isPriceRule = true`, not language- or channel-scoped.
- Products (own category assignments, own attribute values):
  - **P1** *Screws 0200* — {Screws}, color = red
  - **P2** *Screws 0300* — {Screws}, color = blue
  - **P3** *Bolt 10* — {Bolts}, color = red
- Base book PLN: P1 `1+ : 100.0000`; P2 `1+ : 50.0000`; P3 `1+ : 30.0000`.
- Customer group **VIP**. Organizations: **Acme** *Acme B2B (demo)* (group VIP, no parent),
  **Beta** (group VIP), **Gamma** (no group), **AcmeW** (child of Acme, group VIP). Guest = no org.
- Quantity 1 unless stated. Amounts in PLN; percentages half-up to 4 dp. Percentages are signed
  adjustments (`decision-record.md` §5.1): `percent −10` is a 10 % discount, `percent +20` a 20 %
  surcharge.
- Precedence: §10.2–§10.8 are stated under the **AF** preset (*Audience first*) unless a vector
  names another. Under **HY**, the default preset (N11), every one of them gives the same answer
  except F1 (70.00 instead of 98.00); §10.10 shows every case where the presets differ.
- Audiences are sets of one kind; "audience org Acme" means the set {Acme}.

### 10.2 E1 — category ∩ attribute price for everyone

Config: list **L1** regular, CH, PLN, audience everyone, priority 0. Row **e1**: selection
{category Screws ∩ color = red}, `1+`, fixed `120`.

| Vector | Buyer | Product | Steps | Expected | Winner |
| --- | --- | --- | --- | --- | --- |
| E1.1 | guest | P1 | b = 100; catalogue candidates {e1 (spec 4) = 120} → C = 120; no buyer rows → R = 120; no sale | **120.00** | L1/e1, tier catalogue |
| E1.2 | guest | P2 | e1 no match (blue) → C = b = 50 | **50.00** | base |
| E1.3 | guest | P3 | e1 no match (not in Screws) → C = 30 | **30.00** | base |
| E1.4 | Acme | P1 | C = 120; Acme has no list → R = C | **120.00** | L1/e1 |

Today: e1 as a matrix entry on the Default list resolves **100.00** — the own bracket
(orgRank ∞, specificity 4) outranks the entry (orgRank ∞, specificity 3)
(`matrix-price-resolver.ts:242-251, 205-208`). Working today needs a second list with a non-empty
rule (e.g. `salesChannel = CH`, since `{kind:'all'}` cannot be activated, `price-list-service.ts:566`),
no own bracket for P1, and e1 on it: that list wins at level 4 over Default at level 5 → 120.00.
Q2 ruled that `color` is an `isPriceRule` attribute; if it is also a variant axis, the proposal matches
it on the variant's value (V3, §10.14) — not expressible today, where the engine ignores variants.

### 10.3 E2 — organization × category %, organization × product %

Config (without E1): list **L2** regular, CH, PLN, audience org Acme. Rows **e2a** category Screws
`1+` percent −10; **e2b** product P1 `1+` percent −20.

| Vector | Buyer | Product | Steps | Expected | Winner |
| --- | --- | --- | --- | --- | --- |
| E2.1 | Acme | P1 | C = 100; buyer candidates level 0: e2b (spec 5) = 80, e2a (spec 3) = 90 → e2b | **80.00** | L2/e2b |
| E2.2 | Acme | P2 | C = 50; e2a = 45 | **45.00** | L2/e2a |
| E2.3 | Acme | P3 | no row matches → R = C = 30 | **30.00** | base |
| E2.4 | Beta | P1 | no Beta/VIP list → 100 | **100.00** | base |
| E2.5 | Acme | P1, **with E1 also configured** | C = 120 (e1); e2b = 120 × 0.80 | **96.00** (Q3 ruled: off the catalogue price; "off base" would give 80.00) | L2/e2b |

Today: same answers for E2.1–E2.4 (list L2 with rule `organization = Acme`, entries with
`organization_id = Acme`; reference = Default bracket, `matrix-price-resolver.ts:235-239`). E2.5 today
= 80.00 (reference is the Default list, not L1).

### 10.4 E3 — group × product vs organization × product vs organization × category

Config (fresh, no E1/E2): list **L3** regular, CH, PLN, audience group VIP: **e3a** product P1 `1+`
percent −10. List **L4** regular, CH, PLN, audience org Acme: **e4a** product P1 `1+` percent −5;
**e4b** category Screws `1+` percent −15.

| Vector | Buyer | Product | Candidates (cell, chain depth, amount) | Expected | Winner |
| --- | --- | --- | --- | --- | --- |
| E3.1 | Acme | P1 | e4a (org.product, 0, 95), e4b (org.category, 0, 85), e3a (group.product, —, 90) | **95.00** under every preset | L4/e4a — org.product is the best-ranked cell in AF, SF and HY |
| E3.2 | Beta | P1 | e3a (group.product, —, 90) | **90.00** | L3/e3a |
| E3.3 | Acme | P2 | e4b (org.category, 0, 42.50) | **42.50** | L4/e4b |
| E3.4 | Acme | P2, plus **e3b** VIP product P2 percent −10 | e4b (org.category, 0, 42.50), e3b (group.product, —, 45.00) | **42.50** under AF and HY; 45.00 under SF (§10.10) | L4/e4b |
| E3.5 | Gamma, guest | P1 | none | **100.00** | base |
| E3.6 | AcmeW | P1 | chain [AcmeW, Acme]: e4a (org.product, 1, 95), e3a (group.product, —, 90) | **95.00** | L4/e4a (inherited) |

Tension spelled out: for P1 the three rules agree on 95.00 under both orderings (org × product is
the most specific *and* the nearest audience). The orderings diverge on E3.4, where the
organization's category deal meets the group's product deal; audience-first honours the negotiated
contract (42.50). The mirror failure of audience-first in a single tier (F2 below) is what the
tier split removes.

Today: VIP's "−10 % on P1" is only expressible as an own bracket fixed `90.0000` on a list with rule
`customerGroup = VIP` (product entries need an organization, `CON/price-lists.ts:266-273`; no group
coordinate). L4 = rule `organization = Acme` + entries product×Acme 5 % and category×Acme 15 %. Acme:
L4 (level 1) beats L3 (level 2) → in L4 e4a beats e4b → **95.00**; E3.3/E3.4 → **42.50**; same answers.

### 10.5 Failure cases that chose the precedence

| Vector | Config | Single-tier audience-first | Single-tier specificity-first | **Proposed (tiered, AF)** |
| --- | --- | --- | --- | --- |
| F1 | Acme list: all products −2 %; VIP list: P1 −30 % | 98.00 (Acme pays more than other VIPs) | 70.00 | **98.00** under AF — the HY and SF presets give 70.00 (§10.10); under AF the remedy is a VIP *sale* list (min rule) or an Acme row for P1 |
| F2 | CH everyone list: P1 fixed 90; Acme list: all products −3 % | 97.00 (logging in raises the price) | 90.00 (loses the 3 %) | **87.30** (C = 90, −3 %) |
| F3 | = E3.4 | 42.50 | 45.00 | **42.50** |
| F4 | CH everyone list: P2 fixed 48; Acme list: category Screws −15 % | 42.50 | 48.00 (contract ignored) | **40.80** (C = 48, −15 %) |

### 10.6 Sale

Config E3 + list **L5** sale, CH, PLN, audience everyone: **e5** all products percent −10.

| Vector | Buyer | Product | R | S | Expected | Display |
| --- | --- | --- | --- | --- | --- | --- |
| S1.1 | Acme | P1 | 95 | 90 | **90.00** | compare-at 95.00 |
| S1.2 | Beta | P1 | 90 | 90 | **90.00** | no sale (not strictly lower) |
| S1.3 | guest | P1 | 100 | 90 | **90.00** | compare-at 100.00 |
| S2 | Acme | P1, e5 replaced by fixed P1 98 | 95 | 98 | **95.00** | no sale. **Today: 98.00** (`pricing-service.ts:88-110`) |

### 10.7 Priority

| Vector | Config | Expected |
| --- | --- | --- |
| T1 | E3 + list **L6** regular, org Acme, priority 10, row P1 fixed 97 | Acme P1: e4a (0, 5, prio 0, 95) vs L6 row (0, 5, prio 10, 97) → **97.00** |
| T2 | same, L6 priority 0 | equal priority, equal min qty → lower amount → **95.00** |
| T3 | L6 row is category Screws fixed 97, priority 10 | spec beats priority: e4a (spec 5) → **95.00** |

Today the T1 situation is decided by `modifiedAt` (`price-list-resolver.ts:59-69`); renaming L4
flips it.

### 10.8 Quantity tiers and fall-through

Base P1 changed to `1–9 : 100`, `10+ : 90`.

| Vector | Config | Buyer, qty | Expected |
| --- | --- | --- | --- |
| Q1 | L4 e4a P1 −5 % `1+` | Acme, 10 | C = 90 → **85.50** |
| Q2 | L4 P1: −5 % `1–99`, −8 % `100+` | Acme, 100 | C = 90 → **82.80** |
| Q3 | L4 P1 only fixed 70 `100+`; e4b category −15 % | Acme, 50 | P1 row does not cover 50 → e4b → 90 × 0.85 = **76.50** |
| Q3b | same | Acme, 100 | P1 row (spec 5) → **70.00** |
| Q4 | P4 in Screws with **no base PLN**; e4b | Acme, 1 | e4b needs C, none → skipped → R undefined → **unpriced** (quote path) |

### 10.9 Is *Category ∩ Attribute* needed? (Q7 follow-up)

E1 written without the intersection kind, on list **L1** (regular, CH, PLN, everyone):

| Vector | Config instead of e1 | Guest P1 (red screw) | Guest P2 (blue screw) | Guest P3 (red bolt) | Verdict |
| --- | --- | --- | --- | --- | --- |
| C∩0 | e1 = category Screws ∩ color red, fixed 120 | **120.00** | **50.00** | **30.00** | correct |
| C∩1 | attribute color = red, fixed 120 | 120.00 | 50.00 | **120.00** ✗ (should be 30.00) | the red bolt is repriced |
| C∩2 | category Screws, fixed 120 | 120.00 | **120.00** ✗ (should be 50.00) | 30.00 | the blue screw is repriced |
| C∩3 | product P1, fixed 120 | 120.00 | 50.00 | 30.00 | correct today; a red screw added tomorrow is **not** covered |

Conclusion recorded in `decision-record.md` §5.10: the kind stays, limited to one category and one
attribute value.

### 10.10 Configurable precedence — the cases where the presets differ

Presets (`decision-record.md` §5.6): **AF** audience first, **SF** specificity first, **HY** contract
first, blanket last (**default**, N11), **AF-N** audience first with nearest-organization-first
depth. Toggle **cat>attr** (default) / **attr>cat**.

**N11 evidence — the owner's scenarios under every preset.** "Owner" is the answer the owner's own
wording fixes; a preset is eligible only if it matches every row.

| Vector | Owner's wording | Owner | AF | SF | HY | AF-N |
| --- | --- | --- | --- | --- | --- | --- |
| E1.1 | red in Screws → 120 | 120.00 | 120.00 | 120.00 | 120.00 | 120.00 |
| E1.2 | blue screw keeps its base | 50.00 | 50.00 | 50.00 | 50.00 | 50.00 |
| E1.3 | red bolt keeps its base | 30.00 | 30.00 | 30.00 | 30.00 | 30.00 |
| E2.1 | Screws 0200 −20 % for Acme | 80.00 | 80.00 | 80.00 | 80.00 | 80.00 |
| E2.2 | other screws −10 % for Acme | 45.00 | 45.00 | 45.00 | 45.00 | 45.00 |
| E3.1 | "for Acme, which belongs to VIP, Screws 0200 5 % cheaper, not 10 %" | 95.00 | 95.00 | 95.00 | 95.00 | 95.00 |
| E3.2 | VIP member without own terms: −10 % | 90.00 | 90.00 | 90.00 | 90.00 | 90.00 |
| E3.3 | "products in Screws −15 % for Acme" | 42.50 | 42.50 | 42.50 | 42.50 | 42.50 |
| E3.4 | the same sentence, on a screw VIP has its own −10 % for | 42.50 | 42.50 | **45.00 ✗** | 42.50 | 42.50 |

SF is out (E3.4). Among AF, HY and AF-N the F vectors decide:

| Vector | Config | Buyer / product | AF | SF | HY | AF-N |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Acme list: all products −2; VIP list: P1 −30 | Acme / P1: org.all 98.00 vs group.product 70.00 | 98.00 ✗ | 70.00 | **70.00** | 98.00 ✗ |
| F2 | CH everyone list: P1 fixed 90; Acme list: all products −3 | Acme / P1: catalogue C = 90, only org.all | 87.30 | 87.30 | **87.30** | 87.30 |
| F3 | = E3.4 | | 42.50 | 45.00 | **42.50** | 42.50 |
| F4 | CH everyone list: P2 fixed 48; Acme list: category Screws −15 | Acme / P2: C = 48, only org.category | 40.80 | 40.80 | **40.80** | 40.80 |
| F5 | Acme list: all products −2; VIP list: category Screws −5 | Acme / P2: org.all 49.00 vs group.category 47.50 | 49.00 ✗ | 47.50 | **47.50** | 49.00 ✗ |

✗ in F1/F5 marks the anomaly "an Acme buyer pays more than any other VIP member because Acme has a
small blanket discount". HY is the only preset with no ✗ in either table, hence the default.

F2 and F4 do not depend on the preset: the everyone price is the catalogue tier, below every buyer
cell. The presets only order buyer cells against each other.

Category/attribute toggle (applies in every tier, every preset):

| Vector | Config | Buyer / product | cat>attr | attr>cat |
| --- | --- | --- | --- | --- |
| C1 | Acme list: category Screws −10; attribute color = red −20 | Acme / P1 (red, in Screws) | **90.00** (org.category) | **80.00** (org.attribute) |
| C2 | CH everyone list: category Screws fixed 110; attribute color = red fixed 125 | guest / P1 | **110.00** | **125.00** |

Chain depth (N6):

| Vector | Config | Buyer / product | AF, SF, HY (within cell) | AF-N (nearest organization first) | Today |
| --- | --- | --- | --- | --- | --- |
| H1 | list {AcmeW}: category Screws −7; list {Acme}: product P1 −5 | AcmeW / P1: org.product (depth 1) 95.00 vs org.category (depth 0) 93.00 | **95.00** — the cell outranks the depth | **93.00** — the own organization outranks the cell | 93.00 — the nearest organization's list is picked first (`price-list-resolver.ts:41-52`) |
| H2 | list {AcmeW}: product P1 −7; list {Acme}: product P1 −5 | AcmeW / P1: both org.product | **93.00** (depth 0 beats depth 1) | **93.00** | 93.00 |
| H3 | configuration HY + `nearest_organization_first` | — | — | refused `400 VALIDATION_FAILED` (I5) | — |

### 10.11 Audience sets (Q1)

| Vector | Config | Buyer | Product | Expected | Why |
| --- | --- | --- | --- | --- | --- |
| A1.1 | **L8** regular, CH, PLN, organizations {Acme, Beta}: P1 −12 | Acme | P1 | **88.00** | member |
| A1.2 | same | Beta | P1 | **88.00** | member |
| A1.3 | same | AcmeW | P1 | **88.00** | Acme is in its chain (depth 1) |
| A1.4 | same | Gamma | P1 | **100.00** | not a member |
| A2.1 | **L9** regular, CH, PLN, customer groups {VIP, Gold}: P2 −20 | Beta (VIP), customer without own group | P2 | **40.00** | effective group VIP |
| A2.2 | same | customer *Ola* of Gamma with own group Gold | P2 | **40.00** | effective group Gold (customer's own group wins) |
| A2.3 | same | customer of Beta with own group Silver (no list) | P2 | **50.00** | effective group is Silver, not Beta's VIP — one effective group |
| A3.1 | rep scoped to {Acme}; L10 organizations {Acme} | — | — | editable | all members in scope |
| A3.2 | same rep; L8 {Acme, Beta} | — | — | **not visible** (answers as missing, N3) | a member out of scope |
| A3.3 | same rep; L9 groups {VIP, Gold} | — | — | read-only | not an organization list |
| A3.4 | same rep; a draft organization book naming no organization | — | — | **not visible** (answers as missing) | names none of the rep's organizations; a rep cannot create, duplicate or patch to such an audience (`400`), nor patch their own draft to everyone or groups (`403`) — review finding 4 |
| A4 | create a list with members of two kinds (Acme and VIP) | — | — | refused `400 VALIDATION_FAILED` | one kind per list |

The effective-group rule of A2.1–A2.3 (the customer's own group, else the organization's — one
group, never both) already holds on the **current** model since P0, on every entry point
(`current-model.md` §1.2): the current-model vectors are
`backend/test/integration/price_lists/line-prices-batch.test.ts` (own group wins; an account of
another organization is ignored) and `customer-own-group-every-path.test.ts` (listing, product
detail, `resolved-price`, cart). P1 keeps the rule and moves the audience onto the header.

### 10.12 Channel sets and currency (Q5)

Channels: **CH1** "B2B PL" currencies [PLN]; **CH2** "B2C PL" [PLN, EUR]; **CH3** "EU" [EUR].
List **L11** regular, PLN, everyone, channels {CH1, CH2}: P2 fixed 48.

| Vector | Situation | Request | Expected |
| --- | --- | --- | --- |
| K1.1 | as configured | guest, CH1, PLN, P2 | **48.00** |
| K1.2 | as configured | guest, CH2, PLN, P2 | **48.00** |
| K1.3 | as configured | guest, CH2, EUR, P2, no EUR base row | **unpriced** (no EUR price anywhere) |
| K2 | create a PLN list with channels {CH1, CH3} | — | refused `400 VALIDATION_FAILED` naming CH3 |
| K3.1 | CH2 later drops PLN | guest, CH1, PLN, P2 | **48.00** (CH1 binding unaffected) |
| K3.2 | same | engine asked for (CH2, PLN) | **unpriced** — the channel no longer offers PLN; the guard fails closed; admin shows the CH2 binding *Inactive* |
| K3.3 | CH2 adds PLN back | guest, CH2, PLN, P2 | **48.00** again, with no write to L11 |

### 10.13 Surcharges and amount adjustments (Q6)

| Vector | Config | Buyer / product | Expected |
| --- | --- | --- | --- |
| U1.1 | CH everyone list: attribute color = red percent +20 | guest / P1 | **120.00** |
| U1.2 | same | guest / P3 | **36.00** |
| U1.3 | same | guest / P2 | **50.00** |
| U2.1 | Acme list: product P1 percent +10 | Acme / P1 | **110.00** (C = 100) |
| U2.2 | U2.1 + L5 (sale, everyone, all products −10) | Acme / P1 | S = 90 < R = 110 → **90.00**, compare-at 110.00 |
| U3.1 | CH everyone list: product P2 amount −5 | guest / P2 | **45.00** |
| U3.2 | CH everyone list: product P2 amount −60 | guest / P2 | row result −10 < 0 → row unpriced (flagged) → **50.00** |
| U4 | Acme list: product P1 percent −100 | Acme / P1 | **0.00** (a free line, valid) |

### 10.14 Variants (#377)

Fixture addition: **P5** *Screws 0500*, a configurable product in {Screws}; attribute **color** is a
variant axis (`isVariantAxis`) and `isPriceRule`; variants **P5r** (color red) and **P5b** (color
blue); the product itself carries no color. Base book PLN: P5 `1+ : 80.0000`; variant row P5r
percent +10 (off the parent's base).

| Vector | Config | Buyer / line | Expected | Why |
| --- | --- | --- | --- | --- |
| V1 | base only | guest / P5b | **80.00** | inherits the product's base |
| V2 | base only | guest / P5r | **88.00** | variant base row: 80 × 1.10 |
| V3 | + e1 (Screws ∩ red fixed 120) | guest / P5r | **120.00** | e1 matches through the variant's axis value; catalogue tier beats base |
| V3b | same | guest / P5b | **80.00** | blue |
| V4 | Acme list: product P5 −5 | Acme / P5r | **83.60** | 88 × 0.95 — percentages keep variant differences |
| V4b | same | Acme / P5b | **76.00** | 80 × 0.95 |
| V5 | V4 + Acme list: variant P5r fixed 85 | Acme / P5r | **85.00** | org.variant beats org.product |
| V6 | Acme list: product P5 fixed 70 | Acme / P5r and P5b | **70.00** each | a fixed product price flattens variants (N1) |
| V7 | base book: variant P5b amount +7 | guest / P5b | **87.00** | 80 + 7 |
| V8 | base only | guest, listing card for P5 | "from **80.00**", max 88.00 | `variesByVariant`; sort and range key 80.00 (N8) |
| V9 | V4 | Acme, cart line P5r | **83.60** | resolved with the line's `variant_id`. **Today**: the engine ignores the variant and charges P5's own price, while the PDP picker shows `price_override` (`SF/components/VariantPicker.tsx:83-86`) |

### 10.15 "List price / your price" display (Q8a)

| Vector | `pricing.show_list_price` | Buyer / product (config) | Card shows |
| --- | --- | --- | --- |
| D1 | false (default) | Acme / P1 (E3) | **95.00** only |
| D2 | true | Acme / P1 (E3) | list **100.00** / your price **95.00** |
| D3 | true | Acme / P1 (U2.1, surcharge) | **110.00** only — the list price is shown only when above yours (N4) |
| D4 | true | guest / P1 (no lists) | **100.00** only — list price equals your price |
| D5 | true | Acme / P1 (E3) with a sale of **80.00** charged | list ~~**100.00**~~ / your price **80.00** — two prices only: Acme's regular 95.00 is not shown (owner ruling 2026-10-23) |
| D6 | false | Acme / P1 (E3) with the same sale | ~~**95.00**~~ **80.00** — unchanged: the sale strikes the buyer's own price |

### 10.16 Two-place rounding of an x.xx50 amount

A resolver amount is four places, and since the owner's ruling of 2026-10-25 (§10.18) a **unit
price keeps them**: the cart line, the order line (copied from the cart), the admin order preview and
a quote's reference carry it unrounded, and the card and the product page show it with its
significant places. A surface that has to write it at two — a product feed, and the line value
`unit × quantity` — rounds it **half-up on its decimal digits** (`roundAmountHalfUp`,
`CON/price-book-decimal.ts`; `lineAmountHalfUp`, `CON/money-decimal.ts`).
`Number(amount).toFixed(2)` rounds the binary double and is not this rule: 9.0450 is the double
9.04499…, so it gave 9.04.

| Vector | Config | Buyer / product | Resolver | Cart line, order line, order preview, quote reference | Card, product page | Line of 1, feed |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | everyone catalogue book: product fixed 10.05; everyone sale: product −10 % | any / product | **9.0450** | **9.0450** | **9,045 zł** | **9.05** (`toFixed`: 9.04) |
| R2 | everyone sale: product fixed 1.005 | any / product | **1.0050** | **1.0050** | **1,005 zł** | **1.01** (`toFixed`: 1.00) |

Before the ruling of 2026-10-25 every one of those surfaces held 9.05 and 1.01: the cart rounded the
unit price to two places as it took it in.

Test: `backend/test/integration/price_lists/worked-examples/rounding.test.ts`.

**Gross at two places** (review 2 of release 0.108.0, finding 2). A gross price is computed, not
read: `net × (1 + rate / 100)`, rounded to two places **half-up on the exact decimal product**
(`grossAmountHalfUp`, beside `roundAmountHalfUp`). Gross is the default product-feed presentation,
and the storefront's gross beside a net price is the same function, so the two agree. Rounding the
binary double is not this rule: 29.50 × 1.23 is the double 36.28499…, and
`Math.round(x * 100) / 100` gave 36.28.

| Vector | Net | Rate | Exact product | Gross (feed, storefront) | Binary (`Math.round`) |
| --- | --- | --- | --- | --- | --- |
| G1 | 29.50 | 23 % | 36.2850 | **36.29** | 36.28 |
| G2 | 4.30 | 5 % | 4.5150 | **4.52** | 4.51 |
| G3 | 31.50 | 23 % | 38.7450 | **38.75** | 38.74 |
| G4 | 16.50 | 23 % | 20.2950 | **20.30** | 20.29 (also what `Intl.NumberFormat` showed) |

Tests: `packages/contracts/test/price-book-decimal.unit.test.ts`,
`packages/modules/product_feeds/src/backend/services/feed-gross-price.test.ts`,
`storefront/test/lib/gross-derivation.test.ts`. Tax, totals and the documents an order produces
are §10.17. A gross **unit** price shown beside a sub-cent net is carried to four places instead
(`grossUnitPriceHalfUp`, §10.18): 0.0125 at 23 % is 0.015375, shown 0,0154 zł, where G1–G4 — nets
that show two places — keep two.

### 10.17 Money computed from a price — lines, tax, totals and documents (issue #417)

Every amount computed from a price — a line's net and gross, a tax, a total, a correction, a refund,
an available credit, a discount — is computed in exact decimal arithmetic and rounded half-up (half
away from zero for a negative amount) once, where its rule says (`CON/money-decimal.ts`, beside
`price-book-decimal.ts`).

**One VAT method, everywhere** (owner ruling of 2026-10-24; art. 106e ust. 1 pkt 13–14 of the
Polish VAT Act): **per rate, the VAT is the sum of the net amounts at that rate times the rate,
rounded half-up once; the rate's gross is its net plus its VAT; the totals are the sums of the
rows.** One function computes it, `vatByRate` (`CON/money-decimal.ts`), and every document an order
produces calls it:

| Document | What it computes with `vatByRate` |
| --- | --- |
| Checkout preview, admin preview, placed order | `taxTotal` over the lines' nets; `total` = net + VAT + delivery + surcharge − discount (those three carry no VAT); the payment, the proforma and the credit reservation take that `total`; `orders.vat_method = 'per_rate'` records it |
| Order line (`order_items.line_total`), confirmation, order screens | the line's **own rounding**, `round(net × (1 + rate))` — informational (owner ruling of 2026-10-24): the line grosses may add up to a cent more or less than the total, so no screen adds them up — a line group's summary on the admin and storefront order screens is `vatByRate` over its lines' nets (issue #428) |
| VAT invoice | the per-rate summary and the totals over the lines' nets (delivery, surcharge and discount are 0 % lines), stored as issued in `invoices.vat_summary`; a line's `grossValue` is its own rounding, informational — the law requires the net per line, the gross per line is optional; `paidTotal` is what was paid for the order and kept — what was received (each captured payment attempt, or a paid order's stored total when nothing was captured) less everything refunded, each refund once, never below 0 — never the invoice gross (`invoicePaidPosition`, issue #428: the refunds are what `payments` recorded plus the issued refunds of settled returns it never sees — every credit-limit top-up, and every money refund of an order whose method is not a gateway; an order an operator marked refunded was refunded everything received — its total with nothing captured, what was captured otherwise (a refund settled by hand, e.g. after a gateway refund anomaly; owner ruling on PR #434) — taken as the larger of the refunds already recorded and what was received, never their sum, so a gateway refund on the payment row is not counted twice); an order with something refunded whose refunds equal what was received and cover its whole total is not invoiced (a zero-total order — a 100 % coupon — refunded nothing and is invoiced, even when marked refunded) (`422 INVOICE_ORDER_REFUNDED`, owner ruling of 2026-10-24; automatic issuance skips it and logs why); `amountDue` is `max(0, gross − paidTotal)` and what was paid above the gross is the `overpayment`, `max(0, paidTotal − gross)`, printed as *Nadpłata* |
| Return (default refund) | **cumulative** over the order's **kept state** (issues #874, #875): the `return` cases settled with a refund or a credit — a case rejected, replaced or repaired takes nothing off it, and a complaint, a price reduction of goods the buyer keeps, never enters it. Per group of what the order charged — a rate (`vat_method = 'per_rate'`) or a line (an order placed before) — the amount of everything returned so far (`vatByRate` over the returned nets, or the stored line total in proportion), less the share of the order-level discount it carries (the discount shared over the groups by their amounts), minus what earlier kept-state cases refunded in the group; capped at what remains of the products paid (stored subtotal + tax − discount) less the unabsorbed part of the complaint money (`refundedOutside`: per line, `max(0, min(money, lineValue − Σ stored defaults))`), and a case completing the order refunds exactly what remains. **Recomputed at settlement** under the per-order advisory lock from the cases settled by then (the figure shown at creation also counts the live returns not settled yet, and is bounded by the line ceiling); an approved amount equal to a default settles at the recomputed one, a lower one is kept, a higher one is refused. **Per-line ceiling**: a complaint and the returns of its line together refund at most what the line was paid (`lineValue`, the line's default with nothing else returned): a return after a complaint on its line gets its full default until the ceiling binds, a complaint is always bounded by it, and the stored default stays the goods' value. Cases on one order are created and settled one at a time |
| Correction | **anchored on what the invoice keeps** (issue #873) over the effective (not cancelled) corrections of one invoice issued per rate: per rate, the invoice keeps `Nb` net and `Vb` VAT before the correction (its summary row less what earlier corrections credited there); when `Gb − G` equals `K + round(K × rate)` for `K` the kept quantities at the invoiced unit prices (a default refund, the *quantity path*), the invoice keeps `K` and `round(K × rate)`; otherwise (*gross path*) it keeps the net `netForGrossAtRate` gives `Gb − G` when exact, else the correction credits the net it gives `G` when exact, else the invoice keeps the nearest (owner ruling E1: the money is exact, the rest may be 0.01 off the rule); a `G` above `Gb` is refused (`correction_exceeds_rate_remaining`). A complaint's line is a **price reduction** (issue #885): credited at the approved amount on the gross path, stored with quantity 0, no discount, and it lowers no kept quantity. An invoice issued before is credited per line, cumulatively, the invoiced line net in proportion; the goods at `refund + discount share` and the discount back on a 0 % line, so the correction totals the refund and credits the goods' VAT as charged; capped at what remains of the invoice; a total above the lines' sum is refused, and a correction whose total is not what its lines add up to credits its amounts as goods, with no discount line; a settlement refunds and corrects every line of its case (a line its request leaves out at its stored approved amount), validates its correction before any money moves, and runs under the order's advisory lock, one settlement of an order at a time |
| Quote screens and PDF | the quote has one rate: the summary's VAT on the net total; a line's own VAT column is rounded per line, informational |

A typed money amount has at most two decimal places; more is refused with
`400 AMOUNT_PRECISION_EXCEEDED`, never rounded (`CON/money-input.ts`). Price-book prices keep their
four-place grammar (§10.16), and since the ruling of 2026-10-25 so does a typed unit price (§10.18).

Since the owner's ruling of 2026-10-25 (§10.18) the cart line carries the resolver amount at its
four places and **the line value is the rounding point**: a line's net is `unit × quantity` rounded
half-up once. The vectors below are recomputed under it; the *Cart lines* column is that net (the
line's unit price is the resolver's, 29.4950, 9.0450, 0.6950). Before the ruling the unit price was
rounded to two places first, so 9.0450 × 3 was 9.05 × 3 = **27.15** where it is now 27.135 →
**27.14**, 0.6950 × 5 was 3.50 where it is 3.475 → **3.48**, and 29.4950 × 2 was 59.00 where it is
**58.99**; A1, A3 and V2, whose lines hold one unit, did not change. At 8 % no two-place net has an
exact half cent of tax (8 × cents ÷ 100 never ends in .5), so the binary failures were at 23 % and
5 %. Each order carries a 2.50 payment surcharge and no delivery cost; 102 is a `virtual` product,
which is how one order carries two rates.

| Vector | Lines (resolver × qty, rate) | Cart lines (net) | Order: line gross / VAT / total — = payment, proforma, invoice gross, invoice paid | Invoice rows (net / VAT / gross) | Returns → corrections (gross / net / VAT) | Before #417 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 29.4950 × 1, 23 % | **29.50** | **36.29** / **6.79** / **38.79** | 23 %: 29.50 / 6.79 / 36.29 | all: 36.29 / 29.50 / 6.79 | order line gross 36.28 (`toFixed`) |
| A2 (V3 full) | 9.0450 × 3, 8 % | **27.14** | **29.31** / **2.17** / **31.81** | 8 %: 27.14 / 2.17 / 29.31 | all 3: **29.31** / 27.14 / 2.17 | cart `27.150000000000002`; the default refund was 9.77 × 3 = 29.31 |
| A3 | 0.6950 × 1, 5 % | **0.70** | **0.74** / **0.04** / **3.24** | 5 %: 0.70 / 0.04 / 0.74 | all: 0.74 / 0.70 / 0.04 | VAT 0.03, total 3.23, line gross 0.73 |
| V2 | 29.4950 × 1, 23 % + 0.6950 × 1, 5 % | 29.50, 0.70 | 36.29, 0.74 / **6.83** / **39.53** | 5 %: 0.70 / 0.04 / 0.74; 23 %: 29.50 / 6.79 / 36.29 | all: 37.03 / 30.20 / 6.83 | the order took 6.785 + 0.035 = 6.82 and 39.52; the invoice 6.83 and 39.53 |
| V3 partial | 9.0450 × 3, 8 %; 2 returned, then 1 | 27.14 | as A2 | as A2 | 2 of 3: **19.54** / 18.09 / 1.45; then 1: **9.77** / 9.05 / 0.72 | the default refund was 9.77 × 2 = 19.54 |
| L1 | 29.4950 × 1 + 0.6950 × 5, both 23 % | 29.50, 3.48 | **36.29**, **4.28** (= 40.57) / **7.59** / **43.07** | 23 %: 32.98 / 7.59 / 40.57 | all: 40.57 / 32.98 / 7.59 | the line grosses were the allocated 36.28, 4.31 |
| R2 | 29.4950 × 2, 23 %; 1 returned, then 1 | 58.99 | **72.56** / **13.57** / **75.06** | 23 %: 58.99 / 13.57 / 72.56 | 1: **36.27** / 29.49 / 6.78; then 1: **36.29** / 29.50 / 6.79 | each case alone refunded 36.29, 72.58 against 72.57 paid; until #435 the first refunded 36.29 and the second 36.27 |
| DC1 | 29.4950 × 2, 23 %, 10.00 order discount; 1 returned, then 1 | 58.99 | **72.56** / **13.57** / **65.06** (72.56 − 10.00 + 2.50) | 0 %: −7.50 (discount, surcharge); 23 %: 58.99 / 13.57 / 72.56 | 1: **31.27** (carries 5.00) → 31.27 / 24.49 / 6.78; then 1: **31.29** (5.00) → 31.29 / 24.50 / 6.79 | a full return refunded 72.57 against 62.57 charged for the goods; until #435 the first refunded 31.29 and the second 31.27 |
| C1 | as L1, the 0.6950 × 5 line not returnable; 1 returned, then 5 by a complaint | 29.50, 3.48 | as L1 | as L1 | return: **36.29** / 29.50 / 6.79; complaint: **4.28** / 3.48 / 0.80 | a complaint was outside the cap and could refund on top of what was paid |
| L0 | placed before 0.108.0: 29.50 at 23 % (stored 36.29) + 4.30 at 5 % (4.52); stored VAT 7.00, total 40.80, 40.80 paid | — | as stored | issued now: 23 %: 29.50 / 6.79; 5 %: 4.30 / 0.22 — **7.01**, **40.81**; paid **40.80**, due **0.01** | all: refunds 36.28, 4.52 = **40.80** (what was paid) → **40.80** / **33.79** / **7.01**: 23 % takes the gross path and credits 29.49 / 6.79, so the invoice keeps the cent never paid as 0.01 net and no VAT | the context recomputed what was paid; `paidTotal` was the invoice gross, 40.81; until #873 the correction credited 33.80 / 7.00 and left 0.00 net with 0.01 VAT |
| K1 | 10.0100 × 3, 23 %; 1 returned, then 1, then 1 | 30.03 | **36.94** / **6.91** / **39.44** | 23 %: 30.03 / 6.91 / 36.94 | 1: **12.32** / 10.01 / 2.31 (keeps 20.02 / 4.60); then 1: 12.31 / 10.01 / 2.30; then 1: 12.31 / 10.01 / 2.30 | until #873 the first credited 10.02 / 2.30 and left 20.01 / 4.61 |
| K2 | 10.0100 × 3, 23 % + 4.9950 × 2, 8 %, 5.00 order discount; 1A + 1B, then 1A, then the rest | 30.03, 9.99 | 36.94, 10.79 / **7.71** / **45.23** | 0 %: −2.50 (discount, surcharge); 8 %: 9.99 / 0.80 / 10.79; 23 %: 30.03 / 6.91 / 36.94 | 1: **15.86** / 13.15 / 2.71 (23 %: 10.01 / 2.31; 8 %: 4.99 / 0.40; discount −1.85); then 1A: 11.02 / 8.72 / 2.30; then the rest: 15.85 / 13.15 / 2.70 | until #873 the first credited 13.16 / 2.70 |
| P1 | 10.0100 × 3, 23 %; a complaint refunded 6.15 after invoicing, then 1 returned | 30.03 | as K1 | as K1 | complaint: **6.15** / 5.00 / 1.15, a price reduction (quantity 0, keeps 25.03 / 5.76); then 1: **12.32** / 10.01 / 2.31 (keeps 15.02 / 3.45) | the complaint was credited as 1 unit, lowering the kept quantity; until #874 the return counted the complaint and refunded 12.31 |
| O1 | 10.0100 × 3, 23 %; two cases of 1 opened, the second settled first — or the first rejected | 30.03 | as K1 | as K1 | shown at creation 12.32, then 12.31; settled: the second **12.32**, then the first **12.31** (left paid 24.62, then 12.31); with the first rejected, the second **12.32** | until #875 each case settled at the figure shown when it was opened: the second refunded 12.31 and left 24.63 against a kept invoice of 24.62 |
| P2 | as K2, no delivery or surcharge; a complaint refunded 6.15 on 1A, then all of A, then 2B | 30.03, 9.99 | as K2 | as K2 | complaint 6.15; 3A: default **33.07** (carrying 3.87), ceiling 33.07 − 6.15 = **26.92**, refunded 26.92 and carrying all 3.87; 2B: **9.66** — 42.73 refunded, line A 6.15 + 26.92 = its 33.07 | the arithmetic of the #885 amendment, §4: a complaint takes up returnable quantity, so no case can name all of A after it today. Under the #874 predicate without the ceiling A refunded 6.15 + 33.07 = 39.22 |
| P3 | as P2; a complaint refunded at its default 11.03 on 1A, then 2A, then 2B | 30.03, 9.99 | as K2 | as K2 | complaint **11.03**; 2A: default 22.05 (carrying 2.58), ceiling 33.07 − 11.03 = **22.04**, refunded 22.04; 2B: **9.66** — 42.73 refunded, corrections after invoicing leave 0.00 | line A refunded 33.08, a cent above what it was paid |

**A partial return refunds the drop in the kept goods' value** (issue #435, product-owner ruling
Q1 (c) of 2026-11-07). For an order placed per rate, a case refunds what was left paid in each rate
less what an invoice of the goods still kept charges — VAT per rate on the kept nets, less the
discount the kept part carries — so an invoice issued after the return, which lists only the kept
lines, equals what is left paid to the cent. R2 and DC1 move the cent from the second case to the
first: 3 × 10.01 at 23 % (36.94) refunds **12.32** for one unit, leaving 24.62, which is 20.02 net
plus 4.60 VAT; the returned unit's own value, 12.31, would have left 24.63. An order placed before
0.108.0 (L0) keeps the rule of its day. Tests: `packages/modules/returns/src/backend/domain/cumulative-refunds.test.ts`
and `backend/test/integration/invoices/kept-lines.test.ts`.

**What the buyer keeps is decided at settlement** (issues #874 and #875). The kept state is the
`return` cases settled with a refund or a credit, the cases a kept-lines invoice takes off. A
complaint settled with money is a price reduction of goods the buyer keeps (#885): it never enters
the kept state, and counts against what is left paid and against the line it names. The default
is recomputed when the case is settled, from the cases settled by then, so a case settled out of
the order it was opened in, or after an earlier one was rejected, refunds what leaves the kept-lines
invoice equal to what is left paid (O1); the figure shown at creation is provisional. No line
refunds more than it was paid: on an order of several rates the order-level cap does not bound one
line, so a complaint and the returns of its line are bounded by the line's value (P2, P3). The first
units back get their full default and the last ones absorb the cut (product-owner ruling E-C of
2026-11-07): the platform cannot know which unit came back, and the operator lowers the amount by
hand when it is the one the complaint compensated. Tests: `cumulative-refunds.test.ts` (the vectors,
and 1200 random orders whose returns and complaints are settled in a random order, some rejected,
replaced or reduced: no line refunds more than its value, nothing more than was paid, and the kept
state telescopes) and `backend/test/integration/returns/settlement-recompute.test.ts`.

**A correction leaves what the invoice keeps** (issue #873). The correction of a default-amount
return leaves on the invoice, per rate, `vatByRate` of the kept nets — the figures an invoice issued
after the same return lists — so the invoice less its corrections and the kept-lines invoice of the
same returns agree to the cent, and both equal what is left paid (K1, K2). An operator-reduced amount
takes the gross path: approving 10.00 of 12.32 on K1 credits 8.13 / 1.87 and leaves 21.90 / 5.04.
Where no net carries the remaining gross — 6.00 of 12.32 leaves 30.94, which no net has at 23 % —
the correction credits 4.88 / 1.12 and the invoice keeps 25.15 / 5.79, a cent off the rule at that
rate until the next correction (owner ruling E1 of 2026-11-07). A **complaint refunded after
invoicing is a price reduction** (issue #885, product-owner ruling of 2026-11-07): the buyer keeps
the goods, so the correction credits the approved amount at the line's rate with no discount, on a
line stored with quantity 0 and named *Obniżka ceny (reklamacja RMA-…)*, and it lowers no kept
quantity (P1). Tests: `packages/modules/invoices/src/backend/services/correction-amounts.test.ts`
(the vectors, and properties over random invoices with returns and complaints interleaved),
`corrective-invoice-provider.test.ts` and `backend/test/integration/invoices/correction-kept-state.test.ts`.

V2 is the case the two rules disagreed on: the order summed every line's exact tax across all rates
and rounded once, the invoice rounded each line's gross and took a rate's VAT as Σ gross − Σ net, so
the invoice's gross and its recorded paid amount were a cent above what the buyer paid. Under the one
method it is one figure, 39.53, on every document. L1 was written for the cent the owner accepted on
2026-10-24: each line shows its own rounding, and the lines may add up to a cent more or less than the
total — with lines of 29.50 and 3.50 at 23 % they show 36.29 + 4.31 = 40.60 beside a 40.59 total
(the `vatByRate` unit tests in `packages/contracts/test/money-decimal.unit.test.ts` hold such a case). Recomputed under §10.18 its lines are 29.50 and
3.48, whose grosses, 36.29 + 4.28, happen to add up to the 40.57 total. The same order of 29.50 at 23 % and 4.30 at 5 % is
6.79 + 0.22 = **7.01** VAT and **40.81** gross, and three lines of 0.02 at 23 % carry **0.01** VAT
(0.06 × 0.23 = 0.0138), where rounding each line gave 0.00.

Before #417 every invoice of a VAT-payer order also read the order line's **gross** `line_total` as
its net and taxed it again (D1): 100.00 net at 23 % was invoiced at 123.00 net, 151.29 gross.
Invoices issued before the fix are not rewritten or corrected (owner ruling of 2026-10-24); they are
shown with the per-rate summary derived from their stored lines, as they were issued
(`readModelVatSummary`, decided by `invoices.vat_summary` being `null`). An order placed before is
read from what it stored (`orders.vat_method` `null`): L0. **The refund is the money charged**: a
case completing such an order refunds the stored products total even where the stored line totals
add up to a cent more or less, and the correction credits exactly that refund — at most what
remains of the invoice. An invoice whose gross was below what was paid shows nothing due and the
excess as its overpayment (until issue #428 it showed a negative amount due); one whose gross was
above (a pre-upgrade invoice of a VAT payer, D1) keeps the uncredited rest.

**What an invoice records as paid when part of the order was on account** (issue #428). On credit
terms the on-account part is unpaid by arrangement when the invoice is issued, so it is never
counted as paid — the invoice states it as due. Take an order of 100.00: 40.00 captured by card,
60.00 on account. Card part captured and kept: paid 40.00, due 60.00. Card part captured and then
refunded in full before invoicing: the buyer has kept nothing paid and still owes the 60.00, so
**paid 0.00, due 100.00** is right, and since the refunds (40.00) do not cover the order it is
invoiced. The whole order on account with a return credited back to the credit limit: paid 0.00 —
the credit reduces nothing that was paid, and paid is never negative. Checkout takes one payment
method per order, so it does not produce this split today; `invoice-paid.test.ts` and
`decimal-amounts.test.ts` pin the rule so that it holds wherever the split arises.

Tests: `backend/test/integration/price_lists/worked-examples/money-agreement.test.ts` (A1–A3, V2,
V3 full and partial, L1, R2, DC1, C1, L0, K1, K2, P1, every document, and the identity of the payment, the proforma, the
order total and the invoice's gross and paid total); `packages/contracts/test/money-decimal.unit.test.ts`
(`vatByRate`, `allocateHalfUp`, `netForGrossAtRate`) and `money-input*.unit.test.ts`;
`packages/modules/orders/src/backend/services/order-money.test.ts` and `order-return-context.test.ts`;
`packages/modules/invoices/src/backend/services/vat-summary.test.ts` and `correction-amounts.test.ts`;
`packages/modules/returns/src/backend/domain/cumulative-refunds.test.ts` (1200 random sequences of
returns and complaints, with and without an order discount, never over-refund, a complete return
refunds exactly what was paid, and the discount carried adds up to the order's);
`backend/test/integration/returns/concurrent-cases.test.ts`, `settlement-scope.test.ts`, `settlement-ordering.test.ts` and `settlement-recompute.test.ts`;
`backend/test/integration/invoices/decimal-amounts.test.ts` (D1, V2, the refusal to invoice an order refunded in full, the refunds of settled returns outside `payments`, the overpayment, and the on-account case); `packages/modules/invoices/src/backend/services/invoice-paid.test.ts`; `backend/test/unit/invoices/auto-issue-reactor.test.ts`.

**Charges by rate — the allocation, not yet applied** (issue #904, Phase A). Delivery and the
payment surcharge are to take the VAT rate of the goods they accompany (owner ruling of
2026-11-07), and their prices stay **gross**, what the buyer pays (owner ruling E-904-T3 of
2026-11-08). The allocation is `chargesByRate` (`CON/money-decimal.ts`). **Nothing calls it yet**:
placement still writes `vat_method = 'per_rate'` with the charges at 0 %, as the table above says,
and that row holds until the placement switch (Phase B). The columns it will fill,
`orders.charge_lines` and `invoice_lines.line_kind`, exist. Every new invoice and proforma line
already records its kind (`goods`, `delivery`, `payment_surcharge`, `discount`), the 0 % charge
lines included. The rules:

1. A rate's weight is the sum of the goods nets at it; the order-level discount is not taken off.
2. Each charge's gross is split in cents, `floor(G × W_r ÷ ΣW)` per rate, and the cents left over go
   to the largest remainders, a tie to the higher rate. The parts add up to the charge exactly; a
   part of 0.00 is dropped.
3. When every goods line is priced at 0.00, the whole charge goes to the highest goods rate.
4. A part's net is set by the **row target**: the net that makes the rate's row gross equal the
   goods' row gross plus the charges placed there so far, `netForGrossAtRate`, less the row's net so
   far. Where no net produces that gross, the row is 1 grosz off and so is the total (owner ruling
   E-904-6 of 2026-11-08).

The VAT is then `vatByRate` over the goods and the parts together; the money rule is unchanged.

| Vector | Goods (net @ rate) | Charges (gross) | Parts (gross → net) | Rows (net / VAT / gross) | Total vs goods gross + charges |
| --- | --- | --- | --- | --- | --- |
| M1 | 100.00 @ 23 %, 50.00 @ 5 % | delivery 15.99 | 5 %: 5.33 → 5.08; 23 %: 10.66 → 8.67 | 5 %: 55.08 / 2.75 / 57.83; 23 %: 108.67 / 24.99 / 133.66 | **191.49** = 191.49 |
| M2 | 29.50 @ 23 % | delivery 15.99, surcharge 2.50 | 23 %: 15.99 → 13.00; 2.50 → 2.04 | 23 %: 44.54 / 10.24 / 54.78 | **54.78** = 54.78 (the surcharge's net on its own, 2.03, would give 54.77) |
| M3 | 40.00 @ 23 %, 30.00 @ 8 %, 30.00 @ 5 % | delivery 19.99 | 5 %: 6.00 → 5.71; 8 %: 6.00 → 5.56; 23 %: 7.99 → 6.50 | 5 %: 35.71 / 1.79 / 37.50; 8 %: 35.56 / 2.84 / 38.40; 23 %: 46.50 / 10.70 / 57.20 | **133.10** vs 133.09: no net makes the 23 % row 57.19 |
| M6 | 100.00 @ 0 % (intra-EU supply) | delivery 15.99 | 0 %: 15.99 → 15.99 | 0 %: 115.99 / 0.00 / 115.99 | **115.99** = 115.99 |

Tests: `packages/contracts/test/money-decimal.unit.test.ts` (`chargesByRate`: M1–M3, M6, the
tie-break, `ΣW = 0`, and a sweep in which every part sums to its charge and every reachable row
lands on goods row gross + charges), `backend/test/integration/invoices/issue-invoice.test.ts`
(the line kinds) and `backend/test/integration/orders/per-rate-charges-schema.test.ts`.

### 10.18 Four-place unit prices — the line value is the rounding point (owner ruling of 2026-10-25)

A price book stores `numeric(14,4)` and takes four places, so a screw can cost 0.0125. Until this
ruling the cart rounded the resolved price to two places as it took it in, and every unit-price
column after it was `numeric(12,2)`: 0.0125 was charged as 0.01, so **10 000 pieces cost 100.00
instead of 125.00**, and 0.0150 was charged as 0.02 — 33 % too much. Magento does exactly this
(`peer-platforms.md` §*How prices are stored and rounded*); the target model is commercetools'
high-precision prices.

**The ruling.**

- A **unit price keeps up to four places, unrounded**, from the price book through the cart line
  (`cart_items.unit_price`, `recomputed_unit_price`, `agreed_unit_price`), the order line
  (`order_items.unit_price`), the quote request lines (`quote_request_items.desired_unit_price`,
  `agreed_unit_price`, `reference_unit_price`) and the invoice line (`invoice_lines.unit_net_price`,
  already `numeric(14,4)`). Every one of those columns is `numeric(14,4)`; widening was lossless.
  In code a unit price is written by `unitPriceHalfUp` (`CON/money-decimal.ts`), which normalises
  it to four places and rounds nothing a price book can hold.
- **Only the line value is rounded**: `line net = round_half_up(unit × quantity)` to two places,
  exactly, by `lineAmountHalfUp`. VAT is unchanged from §10.17 — per rate, on the sum of the rounded
  line nets, rounded once (`vatByRate`); a line's informational gross is its own rounding,
  `round(line net × (1 + rate))`. Refunds and corrections work from what was stored and charged, as
  in §10.17, and so agree with the order and the invoice.
- **A typed unit price takes up to four places** (`fourDecimalUnitPrice`, `CON/money-input.ts`): a
  quote's desired or agreed price. A fifth is refused with `400 UNIT_PRICE_PRECISION_EXCEEDED`
  ("A unit price may have at most four decimal places."), never rounded. A typed money **amount** —
  a delivery cost, a surcharge, a refund, a minimum order value — still takes two
  (`twoDecimalAmount`, `400 AMOUNT_PRECISION_EXCEEDED`).
- **Display**: a unit price shows two places when its third and fourth are zero, otherwise its
  significant places, up to four — `0,0125 zł`, `1,50 zł`, `1,505 zł` (`unitPriceFractionDigits`,
  used by every formatter: the admin's and the storefront's `formatMoney(…, { unitPrice: true })`,
  the document values, the invoice PDF's unit net price column, the e-mails). A line value and a
  total always show two. A gross unit price beside a sub-cent net is carried to four places
  (`grossUnitPriceHalfUp`: 0.0125 at 23 % is 0.015375, shown `0,0154 zł`); beside a net that shows
  two it keeps two (§10.16 G1–G4).
- A **product feed** writes two places, the grammar its consumers read — and since issue #430 it
  rounds no unit price to get there: a price with a third or fourth significant place is published
  as the exact price of a pack of N, the smallest power of ten that makes it exact (0.0125 → 100 at
  1.25; on a gross feed the gross of that pack's net, 1.54 at 23 %), with N in the template's pack
  fields (`g:multipack`); a template with none leaves the item out with
  `sub_cent_price_without_pack_field`. Tests: `packages/modules/product_feeds/src/backend/services/feed-sub-cent-pack.test.ts`,
  `backend/test/integration/product_feeds/sub-cent-pack.test.ts`, and R1/R2 in
  `backend/test/integration/price_lists/worked-examples/rounding.test.ts` (the feed: 90.45 and 10.05
  for 10).

Each order carries a 2.50 payment surcharge and no delivery cost, as in §10.17. Products: 101 at
**0.0125** (`simple`), 102 at **0.0150** (`virtual`), 103 at **1.5050** (`simple`); the rate per
product type is stated per vector.

| Vector | Lines (unit × qty, rate) | Cart line = order line = invoice line: unit / net / gross | Order: VAT / total — = payment, proforma, invoice gross, invoice paid | Invoice rows (net / VAT / gross) | Returns → refund = correction (gross / net / VAT) | At two places on intake |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 0.0125 × 10 000, 23 % | 0.0125 / **125.00** / 153.75 | **28.75** / **156.25** | 23 %: 125.00 / 28.75 / 153.75 | all: **153.75** / 125.00 / 28.75 | 0.01 × 10 000 = 100.00; VAT 23.00 |
| U2 | 0.0150 × 3, 23 % | 0.0150 / **0.05** (0.045 half-up) / 0.06 | **0.01** / **2.56** | 23 %: 0.05 / 0.01 / 0.06 | all: **0.06** / 0.05 / 0.01 | 0.02 × 3 = 0.06 |
| U3 | 0.0125 × 10 000 and 1.5050 × 7 at 23 %, 0.0150 × 333 at 8 % | 0.0125 / 125.00 / 153.75; 1.5050 / **10.54** (10.535) / 12.96; 0.0150 / **5.00** (4.995) / 5.40 | 23 %: 135.54 × 0.23 = 31.1742 → 31.17; 8 %: 0.40 — **31.57** / **174.61** | 8 %: 5.00 / 0.40 / 5.40; 23 %: 135.54 / 31.17 / 166.71 | all: **172.11** / 140.54 / 31.57 | 100.00 + 10.57 + 6.66 = 117.23 net |
| U4 | a quote agreed at **0.0125** for 10 000 (the buyer accepts, converts to a basket, orders) | quote, cart line, order line: 0.0125; line net **125.00** | — | — | — | the agreed price was refused unless two places; at 0.01, 100.00 |
| U5 | 0.0150 × 333, 23 %; 111 returned, then 222 | 0.0150 / **5.00** / 6.15 | **1.15** / **8.65** | 23 %: 5.00 / 1.15 / 6.15 | 111: **2.05** / 1.67 (1.665) / 0.38; then 222: **4.10** / 3.33 / 0.77 — together 6.15, what was charged | 0.02 × 333 = 6.66 |

U5 is a return of part of a sub-cent line: the first case refunds what 111 pieces are worth,
`round(0.0150 × 111) = 1.67` net and its VAT, and the second, completing the order, refunds the rest
of what was charged — the refund and the correction agree on both, and together they are the 6.15
the order took. The U vectors run through the same documents as §10.17: the cart, the admin and
checkout previews, the placed order, the payment it opens, its proforma, the VAT invoice (its lines,
the per-rate summary, the totals and the amount recorded as paid) and cumulative refunds credited by
corrections. U4 runs through the quote, its basket and the order.

Tests: `backend/test/integration/price_lists/worked-examples/money-agreement.test.ts` (U1, U2, U3,
U5 and every §10.17 vector recomputed), `backend/test/integration/quote_requests/conversion.test.ts`
(U4), `backend/test/integration/price_lists/worked-examples/unit-price-columns.test.ts` (every
unit-price column is `numeric(14,4)`), `backend/test/integration/price_lists/worked-examples/rounding.test.ts`
(§10.16 under the ruling), `packages/contracts/test/unit-price.unit.test.ts` (the arithmetic, the
display rule and the typed-input refusal), `packages/platform/src/http/error-envelope-amount-precision.test.ts`,
`admin/test/admin-kit/money-unit-price.test.ts` and `storefront/test/lib/money.test.ts` (the formatters).

### 10.19 Display mode `none` withholds every amount (issue #491)

A display mode decides whether a price is shown, and `none` — "price on request" — means the server
sends no amount at all, not that the page hides one it was sent. Fixture: the §10.1 shape on one
product **PV** on `pl_retail`, priced **88.00** for everyone (catalogue tier) and **10.00** for
Acme's buyer (buyer tier), with a sale for everyone at **80.00** and `pricing.show_list_price` on —
so a guest's priced answer carries four figures: price 80.00, compare-at 88.00, sale 80.00, list
88.00. "Withheld" below means: listing and product page `price` `null`, no `compareAtPrice`,
`resolvedPrice { basePrice: null, salePrice: null, displayMode: 'none' }` and no `listPrice`;
product links and comparison `price` `null`; the resolved-price endpoint with no book, bracket,
sale, source or compare-at; search hits and suggestions alike; no 88 or 80 anywhere in the body.

| Vector | Configuration | Viewer | Answer |
| --- | --- | --- | --- |
| W0 | none of the below | guest | **80.00**, compare-at 88.00, list 88.00 — the control |
| W1 | `unauthenticated_display_mode = none` | guest | **withheld** on every surface |
| W2 | W1, `default_display_mode = net_only` | Acme | **10.00** (`net_only`) — a priced signed-in mode is untouched |
| W3 | product override PV `none` | guest, Acme | **withheld** for both: the product step precedes the viewer's tail |
| W4 | category override (a category of PV) `none` | guest | **withheld** |
| W5 | W1 and product override PV `gross_only` | guest | **80.00** — the product step decides before the unauthenticated setting |
| W6 | product override PV `none` | Acme, *Add to cart* | `400 CART_PRODUCT_QUOTE_ONLY`, no amount in the body |

Price sort and range (feature 086's fixture: Acme sees ALPHA 10, DELTA 55, BETA 90; GAMMA unpriced):

| Vector | Configuration | Request | Answer |
| --- | --- | --- | --- |
| W7 | product override BETA `none` | Acme, `sort=price` | ALPHA, DELTA, then {BETA, GAMMA} in the unpriced tail |
| W8 | as W7 | Acme, `sort=-price` | DELTA, ALPHA, then the tail — BETA does not lead |
| W9 | as W7 | Acme, `minPrice=80&maxPrice=100` | nothing — a range never brackets a withheld price |

**Today** (before #491) W1, W3 and W4 sent every figure and the storefront hid them; W7–W9 ranked
BETA at 90.00 (spec 086, clarification 2).

Tests: `backend/test/integration/price_lists/worked-examples/display-mode-withheld.test.ts` (W0–W6),
`backend/test/integration/search/display-mode-withheld-in-search.test.ts` (W1–W3 on search),
`backend/test/integration/catalog/price-sort-withheld.test.ts` (W7–W9),
`backend/test/integration/price_lists/price-surface-targeted-refresh.test.ts` (a product or category
override marks its products, and `none` takes them off the surface),
`packages/modules/price_lists/src/backend/services/book-pricing.withheld.test.ts` (the mapping and
the surface's omission) and
`packages/modules/catalog/src/backend/services/catalog-org-price-decorator.withheld.test.ts` (the
external catalogue API).

### 10.20 A former non-public channel, after the flag is retired (issue #492)

A sales channel's `isPublic = false` withheld prices from every viewer, signed-in buyers included.
The flag is retired: the migration gives every such channel `pricing.unauthenticated_display_mode =
none` as its own value (unless it has one already) and drops the column, and no consumer reads the
channel to decide whether to price. Fixture: §10.19's probe product **PV** on `pl_retail`, priced
**88.00** for everyone and **10.00** for Acme's buyer, no sale; `pl_retail` is made a former
non-public channel by recreating the column, marking it `false` and running the migration.

| Vector | Configuration | Viewer | Answer |
| --- | --- | --- | --- |
| P1 | the migrated channel | guest | **withheld** on the listing, product page, product links and comparison |
| P2 | as P1 | Acme | **10.00** (`gross_only`) everywhere — the behaviour change: the flag used to withhold it |
| P3 | as P1 | guest / Acme, `sort=price` | `400 PRICE_ORDERING_UNAVAILABLE` / served |
| P4 | P1 and product override PV `gross_only` | guest | **88.00** — the product step precedes the channel's guest setting (owner ruling of 2026-10-28) |

The migration's own vectors: a channel with `is_public = false` and no value of its own gets `none`
(M1); one with a value of its own keeps it (M2); a channel with `is_public = true` gets nothing (M3);
the column is gone (M4); a database with a non-public channel and no registered setting is refused
rather than migrated into showing prices (M5); `down` restores `false` where the channel's guest
value is `none` (M6).

**Today** (before #492) P2 sent no amount to the buyer, and P3 refused the buyer as well.

Tests: `backend/test/integration/price_lists/worked-examples/retired-is-public.test.ts` (P1–P4),
`backend/test/integration/sales_channels/retire-is-public-migration.test.ts` (M1–M6) and
`backend/test/unit/sales_channels/is-public-retired.test.ts` (no code names the flag or the column).

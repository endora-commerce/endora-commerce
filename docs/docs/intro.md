---
sidebar_position: 1
---

# B2B Platform — Introduction

Welcome. This site documents the **B2B Platform** — a Supplier-operated commerce product that supports both **Quote Request (RFQ)** and **direct-purchase** workflows on a single codebase, with Customer Organizations, multi-user Roles, Credit Limit settlement, a permissioned Admin Panel, and an open API + webhook layer for third-party ERP / PIM / WMS / CRM integrations.

## Who this is for

- **Developers** extending the platform — each module's section below describes its domain, contracts, services, and tests with enough depth to contribute without reverse-engineering the code.
- **Product Owners and end users** — the "Usage" page of each module is written to be understood without reading TypeScript.

Both audiences read the same tree. Sections marked _Developers_ vs _Usage_ let you skip the parts that are not for you.

## Where things live

| Artifact | Location |
| --- | --- |
| Governance source of truth | [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) in the repository |
| Per-feature specs, plans, tasks, contracts | `specs/###-feature-name/` in the repository |
| Dev + prod runbook + hardware requirements | `README.md` at the repository root |
| Module documentation (you are here) | This site |

## Quick links

- Spec-Kit feature **001 — B2B Platform Foundation** — the spec, plan, and tasks that define the whole platform: `specs/001-b2b-platform-foundation/` in the repository.
- Live OpenAPI (when the backend is running): [http://localhost:3001/api/v1/_openapi.json](http://localhost:3001/api/v1/_openapi.json).

## Status

This site is **scaffolded**. Module sections (catalog, quote requests, orders, …) are filled in as their implementation phases complete, per the constitution's Documentation Requirements (PRs that add or change a module MUST update the relevant page in the same commit range).

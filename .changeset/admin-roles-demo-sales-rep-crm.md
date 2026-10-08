---
'@endora-commerce/mod-admin-roles': patch
---

The demo's `sales_representative` role also holds `crm:read` and `crm:write`. A demo Sales Rep
can now open and move the Sales Opportunities assigned to them, and is offered when a colleague
assigns an Opportunity or mentions a person with `@`. Only the demo data changes: roles on an
instance that selling for real has are untouched.

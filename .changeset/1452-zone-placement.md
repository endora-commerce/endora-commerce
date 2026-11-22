---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
---

Admin zone contributions now choose a tab or a sidebar by naming the zone for that place (issues #1452 and #1526). Four zones are new: `organization.detail.sales` is the body of the organization's Sales tab, after the sales representatives, and carries `{ organizationId }` with no save session; `order.detail.sidebar`, `quote_request.detail.sidebar` and `opportunity.detail.sidebar` are sidebar cards, and each contribution is a section of the card. The order and quote request screens draw their sidebar only while something fills it. The organization's Sales tab is shown to someone who may assign sales representatives or who sees one of its panels. CRM opportunities and projects moved from the organization's Commerce tab to its Sales tab. The linked opportunity, the project and the tasks moved from the end of the order, quote request and opportunity screens into their sidebars. No zone was removed or renamed: contributions to the `.detail.after` zones keep working unchanged.

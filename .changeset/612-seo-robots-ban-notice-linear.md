---
'@endora-commerce/mod-seo': patch
---

The Admin robots.txt preview's "closes the site to every crawler" notice (`closesSiteToEveryCrawler`) now takes time proportional to the text. Before, a group of many consecutive `User-agent` lines was quadratic: the group's agent list was copied for every line and searched for every rule. The answer is unchanged.

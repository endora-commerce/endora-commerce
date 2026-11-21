---
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-meta-ads': patch
'@endora-commerce/mod-linkedin-ads': patch
---

The Google Analytics custom events, Meta Ads custom events and LinkedIn Ads conversion mappings screens now share one layout (issue #1537). Each list shows the storefront action as the row's link, the sales channel by name and the status as a word, and has one row menu with Edit and a Delete that asks for confirmation. An empty list shows an empty state that holds the create button. In each editor, Save sits in the sticky bar beside Cancel and Delete is in the header's "More" menu. A required field left empty is flagged when you press Save, and Enabled is a switch. The Google Analytics editor now offers sales channels from a list, where before you typed the code. Its storefront actions use the same wording as the other two screens ("Added to cart"). The three packages declare `lucide-react` as an optional peer dependency.

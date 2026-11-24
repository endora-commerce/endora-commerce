---
'@endora-commerce/mod-newsletter': patch
---

Newsletter automations now enrol subscribers (issue #1833). Before this, an active automation never
started: `NewsletterAutomationService.enrol()` had no production caller.

A committed subscribe or double opt-in confirmation now enrols the subscriber into every active
automation it newly matches, through the new `NewsletterAutomationService.enrolMatching()`:
trigger `all` when the subscriber becomes `active`, trigger `tag` / `tag_list` when an active
subscriber carries one of the trigger's tags on becoming active, or is given one by a later
subscribe. A `pending` subscriber, a suppressed address and a paused automation enrol nobody, and
a rolled-back write enrols nobody because enrolment runs after the commit.

Activating an automation does not back-fill the subscribers that already match it. An operator who
expected the existing list to receive a sequence that was activated before this release should
send it as a campaign; those subscribers are not enrolled retroactively.

`NewsletterSubscriberService` takes an optional `enrolAutomations` dependency, which the module's
own composition wires to the automation service. A composition that builds the service by hand and
leaves it out enrols nobody, as before.

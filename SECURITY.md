# Security policy

> **The reporting channel is GitHub's private vulnerability reporting, from the day this
> repository is public — and there is deliberately no e-mail address.** A published mailbox is a
> mailbox somebody has to keep watching, and one nobody is watching is worse than none at all.
>
> **This file ships before that switch is flipped.** Private vulnerability reporting has to be
> **enabled on the repository**, which happens with the migration, so until then the *Security*
> tab this file points at does not exist yet. If it is not there when you look: **do not file a
> suspected vulnerability anywhere public.** Contact the maintainers privately through whatever
> route you already have and wait for a reply.

## Reporting a vulnerability

**Do not open a public issue, a public discussion or a pull request for a suspected
vulnerability.** A public report is a disclosure, and it is a disclosure made before anybody
running this software has had a chance to update.

**Use GitHub's private vulnerability reporting**: the repository's **Security** tab →
*Report a vulnerability*. It opens a private advisory that only you and the maintainers can read,
it keeps the whole conversation and the eventual fix in one place, and it needs no address from
either of us — which is the point. There is **no security e-mail address for this project**, and
that is a decision rather than an omission: an address is a mailbox somebody has to keep watching,
and a published one that nobody watches is worse than none.

**If the Security tab does not offer it**, the switch has not been flipped yet — see the note at
the top of this file. Do not report publicly in the meantime.

**What to include**, in as much of this shape as you have:

- what the weakness is, and which component it is in — the backend, the admin application, the
  storefront, a specific module package, or the CLI;
- the version or commit you found it on;
- how to reproduce it: the smallest sequence of steps, requests or inputs that demonstrates it;
- what an attacker gets — data they should not read, a write they should not be able to make, a
  tenant boundary they cross, an escalation of privilege;
- anything you already know about mitigation.

A report that is only *"component X looks wrong"* is still worth sending. A report you are not
sure about is still worth sending.

**What happens next.**

1. **Acknowledgement within 72 hours.** This is a **receipt, not a verdict**: it confirms a human
   has your report and is reading it, and nothing more. It is the one number in this file you can
   hold us to, and it is deliberately the only one.
2. **Assessment.** We reproduce it, decide whether it is a vulnerability, and tell you which way
   it went and why. A report judged not to be a vulnerability gets that answer in writing rather
   than silence.
3. **Repair**, on a private branch, with a test that fails before it and passes after — the same
   rule every other change in this repository is held to (Principle III).
4. **Release and disclosure.** The fix ships, and the advisory follows. You are credited unless
   you ask not to be.

**There is no committed remediation timeline, and the absence is deliberate.** Nobody has decided
one, and a number invented to fill the gap would be the same error as an invented address: a
promise made by whoever wrote the file rather than by whoever has to keep it. What you are owed is
the 72-hour receipt and an assessment in writing; after that you are told what is happening and
when, in the advisory thread, by a human who knows.

## Scope

**In scope**: this repository's code and the packages published from it — the platform, the
contracts, the CLI, the admin application, the storefront and every module package under
`packages/modules/`.

**Out of scope, and each for a reason rather than by convention:**

- **A deployment's own configuration.** A weak secret, an exposed port, a database reachable from
  the internet or a missing TLS certificate in somebody's installation is that operator's, not
  this project's — unless what led them there is a default this repository ships or a document
  here that told them to do it. If it is, that *is* in scope, and say so in the report.
- **Third-party dependencies**, which belong to their own maintainers. Report them upstream. If a
  dependency's advisory affects this project in a way its own advisory does not describe — a
  default we set, a code path only this repository takes — that part is ours and is in scope.
- **A finding produced only by a scanner.** A tool's output with no demonstrated impact is a
  starting point, not a report. Show what an attacker gets.

## Supported versions

Endora Commerce is in a `0.x` series and has not made its first public release. **The supported
version is the latest published one**, and there is no backport line: a fix lands on the default
branch and ships in the next release.

This section acquires a table when there is more than one line to support. It does not have one
today because there is not, and a table with a single row would imply a policy nobody has
written.

## Why this file exists and where it sits in this project's rules

This repository keeps a register of known, unfixed defects, and **a defect whose subject is an
exploitable weakness never becomes a public issue**, whatever else is true of it. It is marked as
security and routed here instead. That rule is absolute and it is not a judgement call made per
entry: every comparable project routes security off its public tracker, and an entry that is
*"probably not exploitable"* is exactly the one that should travel by this route rather than the
other.

So this file is the one route, and the register's security class has nowhere else to go. That is
why enabling private vulnerability reporting is a **precondition of this repository being public**
rather than a setting somebody gets to later: a route that is not switched on is not a route, and
this file is a promise somebody has to keep.

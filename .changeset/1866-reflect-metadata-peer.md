---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

MikroORM 7 (issue #1866). The platform declares `reflect-metadata` (`^0.2.2`) as a peer, and
`endora new instance` writes it beside `@mikro-orm/decorators`. `@mikro-orm/decorators/legacy`
imports it at load time while its own manifest calls that peer optional, so an instance that
installed the platform's other peers and not this one could not import the platform's kernel.

---
'@endora-commerce/mod-product-feeds': patch
---

Development dependency `basic-ftp` raised from 6.2.1 to 6.2.4, the release that fixes GHSA-5pm8-86m8-9m6r (an MLSD listing fact named `__proto__` failed the listing) and GHSA-r4jh-29pc-gfqr (control characters in a password or resumed-download path could terminate the process; a rejected `PASS` error included the password). The peer range stays `^6`; a host that installs `basic-ftp` itself should resolve 6.2.4 or later.

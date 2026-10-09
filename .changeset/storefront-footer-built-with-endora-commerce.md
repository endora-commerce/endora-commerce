---
'@endora-commerce/cli': patch
---

The storefront `endora new` writes credits the platform in its footer: "Built with ❤️ using Endora
Commerce", where the product name links to `https://commerce.endora.software`. The link carries
`utm_source=storefront`, `utm_medium=referral`, `utm_campaign=built-with` and `utm_content=footer`,
and the URL is exported from `components/Footer.tsx` as `BUILT_WITH_URL`.

A storefront that already exists keeps the source it was created with and does not gain the line.
To remove it from a new one, delete the `<span>` that renders it in `components/Footer.tsx`.

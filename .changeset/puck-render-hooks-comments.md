---
'@endora-commerce/cms-components': patch
'@endora-commerce/email-components': patch
---

Comments only — no exported symbol, type or behaviour changes.

Four `ComponentConfig.render` functions gain an `eslint-disable-next-line
react-hooks/rules-of-hooks` and the sentence explaining it: Puck mounts `render` as a React
component, so the hook call inside it obeys the rules of hooks, and the linter objects to the
field's name rather than to the call. It is recorded here because `tsc` does not strip
comments, so the emitted `dist` differs.

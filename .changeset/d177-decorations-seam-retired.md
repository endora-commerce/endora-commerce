---
---

The per-deployment `decorations/` seam is retired (D-177). No package's published surface
moves: `@endora-commerce/platform` changes two doc blocks and nothing else —
`ForeignDecorationError`'s explanation of why a deployment overlay may wrap anything the
container holds no longer rests its argument on a second, file-based mechanism, and
`ErrorEnvelopeOptions` now points a deployment at `ctx.di.decorate` for the
`adminI18nService` override it describes. Every exported symbol, signature and runtime
behaviour is identical.

The mechanism that was removed lived entirely in `backend/`, which is in `ignore`.

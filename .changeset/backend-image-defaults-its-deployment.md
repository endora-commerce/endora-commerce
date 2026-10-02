---
'@endora-commerce/cli': patch
---

The `deploy/Dockerfile.backend` that `endora new instance` writes now defaults its `DEPLOYMENT` build argument to the instance's own deployment (`ARG DEPLOYMENT=<the directory under apps/>`). A blank `DEPLOYMENT` is bare core, so an image built without `--build-arg DEPLOYMENT=…` composed none of the overlay modules its own tree carries, and nothing said so. Passing the argument still overrides it, and an empty value still builds bare core. An instance written earlier keeps its old Dockerfile: add the default to its `ARG DEPLOYMENT` line by hand.

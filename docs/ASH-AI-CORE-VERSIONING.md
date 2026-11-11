# ASH AI Core versioning

Current version: **1.0.0** in `packages/ash-ai-core/package.json`.

## Policy

- The canonical package version changes only when reusable behavior changes.
- A product records the version in its workspace registry after `link-core`.
- Patch updates may fix a provider bug without changing public function names.
- A new major version is required if a public function is removed or a routing rule starts selecting paid models.
- ASH Chat and a copied core can differ until someone deliberately exports again.
- Do not publish this package to a public registry from this repository unless the owner asks.

`CHANGELOG.md` in the package is the history. Git tags are not created until the foundation freeze conditions are met.

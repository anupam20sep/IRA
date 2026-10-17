# Curated hire gallery catalog

Operator checklist when adding or updating entries:

1. **Schema** — Each manifest under `manifests/` MUST parse as YAML/JSON and validate against `HireManifestSchema` (`packages/core/src/hire/schema.ts`). Use `schemaVersion: hireManifest/v1` and allowlisted fields only.
2. **Index hash** — After editing a manifest, recompute SHA-256 of the file bytes and set the matching `manifestSha256` on the corresponding row in `index.json`.
3. **No secrets** — Do not embed API keys, tokens, or credentials in manifests or persona bodies.
4. **No executable payloads** — Manifests are data documents only; no shell hooks, scripts, or binary blobs in catalog files.
5. **Trust copy** — Keep `trustHint: "curated_catalog"` on index entries; gallery import still uses the standard untrusted-import review path (OD-018).

Override the catalog location with `SUPERSPEC_HIRE_GALLERY` pointing at a directory that contains `index.json` and referenced manifest paths.

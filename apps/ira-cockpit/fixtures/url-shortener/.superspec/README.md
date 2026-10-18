# SuperSpec workspace metadata

This directory holds **repo-level** SuperSpec scaffolding — not per-feature artifacts.

| Path | Purpose |
|------|---------|
| `templates/` | Reference copies of tier templates (spec, plan, design, …) and `models.example.yaml` |
| `models.yaml` | Optional model routing overrides (only if created via `--with-models` or by hand) |
| `README.md` | This file |

Per-feature forge state lives under each spec directory: `specs/<feature>/.superspec/state.json` (gitignored).
Per-feature FR status is committed at `specs/<feature>/status.md`.

Do **not** store feature specs here. Use `specs/<feature>/` at the repository root.

# Feature Specification: ira-hire-gallery

**Feature Branch**: `005-ira-hire-gallery`

**Created**: 2026-09-06

**Status**: Draft

**Type**: product

**Input**: Parent requirements HR-* from `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`; program row P-005 in `program.md`. Hire manifests, review-before-spawn, capability tags, skills consent, `list-personas` integration, hire scoring.

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED production invariants OD-018 (hire confirm/cancel, warning copy); supersedes conflicting P-005 design text |
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` §6.5, §8.1, §8.5, §9.2 | HR-* source, hire manifest model, hire journey |
| `docs/superspec/specs/ira-prior-art-reuse-map.md` | Reuse map — prefer adapt Munder hire modules |
| `program.md` (P-005) | Program placement and priority |
| `specs/001-ira-command-plane/spec.md` | GOD routing, roster, HITL escalation for untrusted imports |
| `content/templates/constitution.md` | Traceability spine FR ↔ task ↔ test |
| https://munderdiffl.in/blog/how-to-hire-from-the-agent-gallery/ | Gallery UX and hire-as-manifest flow |
| Munder Difflin `src/main/hire.ts`, `src/shared/hire.ts`, `src/shared/hireQueue.ts` (MIT) | Prior art to adapt — manifest parse, review queue, spawn gate |

## Prior Art / Reuse

Prefer **adapting** (not greenfield) from Munder Difflin hire pipeline:

| Concern | Upstream reference |
|---------|-------------------|
| Manifest parse & validation | `src/shared/hire.ts` |
| Review queue / spawn gate | `src/shared/hireQueue.ts`, `src/main/hire.ts` |
| Untrusted-input posture | Munder hire gallery blog + security posts on manifest import |
| Persona discovery | SuperSpec `packages/core/src/persona-discovery.ts` + MCP `list-personas` |

Do **not** copy LimeZu pixel assets. Preserve MIT attribution when adapting code.

## Parent Requirements Crosswalk

| Parent ID | Feature FR | Summary |
|-----------|------------|---------|
| HR-001 | FR-001, FR-002 | Hire specialist via gallery or manifest |
| HR-002 | FR-002, FR-010 | Manifest fields: identity, goal, capability tags, engine, model tier, budget, skills/MCP allowlists |
| HR-003 | FR-003, FR-013 | Never auto-spawn; Operator reviews then confirms (curated gallery included) |
| HR-004 | FR-004, FR-011, FR-013 | Network manifests are untrusted; allowlisted fields only; no executable payload; curated entries same review path |
| HR-005 | FR-005 | Installed personas discoverable by `list-personas` |
| HR-006 | FR-006 | Skills install with consent and optional security scan |
| HR-007 | FR-007 | Route by capability tags, not display name alone |
| HR-008 | FR-008 | Score hires; surface demotion hints |
| GD (§5.3) | FR-003, FR-011, FR-013 | Untrusted hire import escalates to HITL before spawn (curated catalog uses same path) |
| SS-005 | Assumption | Worktree isolation default for code-writing hires |
| NFR-002 | FR-004, FR-006, FR-010 | Default-deny skills/MCP; no secrets in manifests |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review and confirm hire from manifest (Priority: P1)

Operator receives or selects a hire manifest (file or gallery entry). The system pre-fills a review form with identity, goal, capability tags, suggested engine, model tier, token budget, and allowed skills/MCP. Operator edits fields as needed, then explicitly confirms spawn. The hire appears on the roster and its persona is discoverable by existing persona listing.

**Why this priority**: Core HR-001/002/003/005 flow; without review-before-spawn the feature violates Ira security posture.

**Independent Test**: Import a sample iOS-developer manifest, edit engine and budget on the review form, confirm spawn, then verify the new persona appears in persona listing and roster without any agent process starting before confirmation.

**Acceptance Scenarios**:

1. **Given** a valid hire manifest, **When** Operator opens it for import, **Then** a review form shows all manifest fields editable and no worker is spawned.
2. **Given** a completed review form, **When** Operator confirms spawn, **Then** portable persona files are written and the hire appears on the roster with the confirmed engine, model tier, and budget.
3. **Given** a spawned hire, **When** Operator runs persona listing, **Then** the new hire appears alongside existing project and home personas.
4. **Given** a review form open, **When** Operator cancels or closes without confirming, **Then** no persona files are written and no roster entry is created.

---

### User Story 2 - Safe handling of untrusted manifests (Priority: P1)

Operator imports a manifest from the network (gallery URL, shared file, or paste). The system treats all external content as untrusted: validates schema version, strips or rejects disallowed fields, refuses executable payloads, and requires explicit Operator confirmation before any spawn.

**Why this priority**: HR-004 and program HITL policy; a hire gallery without untrusted-input guards is unsafe.

**Independent Test**: Submit manifests containing disallowed executable references, oversized fields, and unknown schema keys; verify rejection or sanitization and that spawn never occurs without confirmation.

**Acceptance Scenarios**:

1. **Given** a manifest with an executable payload or script block, **When** Operator attempts import, **Then** import fails with a clear error and nothing is spawned.
2. **Given** a manifest with unknown or non-allowlisted keys, **When** import runs, **Then** unknown keys are dropped or rejected and the Operator sees what was removed.
3. **Given** a manifest from a remote gallery entry, **When** import completes parsing, **Then** the review form is shown and Ask-Me / approval state reflects untrusted-import HITL until Operator confirms.
4. **Given** a malformed manifest (invalid schema version or missing required fields), **When** Operator attempts import, **Then** import fails with field-level validation errors and no partial spawn.

---

### User Story 3 - Browse gallery and pre-fill hire (Priority: P2)

Operator browses a hire gallery (curated catalog of specialist manifests) searchable by capability, role name, or tags. Selecting an entry pre-fills the same review form as file import; Operator still must confirm before spawn.

**Why this priority**: HR-001 gallery path; improves discoverability but depends on manifest + review core from P1.

**Independent Test**: Search gallery for `ios`, select a match, verify review form pre-fill, confirm spawn, verify roster entry — without auto-spawn on selection alone.

**Acceptance Scenarios**:

1. **Given** a gallery with multiple entries, **When** Operator searches by capability tag `ios`, **Then** matching specialists are listed with name, tags, and suggested defaults visible.
2. **Given** a gallery entry, **When** Operator selects it, **Then** the review form opens pre-filled and no agent is spawned until confirmation.
3. **Given** gallery source unavailable, **When** Operator opens gallery, **Then** Operator sees a clear error and can still import a local manifest file.

---

### User Story 4 - Install skills with consent (Priority: P2)

When a hire manifest or Operator action requests skills, the system shows which skills will be installed, obtains explicit consent, optionally runs a security scan, and only then writes skill files to allowed locations.

**Why this priority**: HR-006; skills expand agent capability and must follow default-deny + consent.

**Independent Test**: Offer a hire with two skills; decline one and accept one; verify only consented skill is installed and scan results are shown when enabled.

**Acceptance Scenarios**:

1. **Given** a hire manifest listing skills, **When** Operator reaches the skills step, **Then** each skill is shown with source and consent is required per skill or as a batch before install.
2. **Given** security scan enabled, **When** a skill fails scan, **When** Operator proceeds, **Then** Operator must acknowledge the finding or the skill is not installed.
3. **Given** Operator declines all skills, **When** hire spawn confirms, **Then** persona is still created with an empty or default-deny skills allowlist.

---

### User Story 5 - Route work by capability tags (Priority: P2)

Ira assigns tasks to hires based on capability tags (e.g. `ios`, `qa`, `security`) declared on the manifest and roster entry, not on display name alone. Tasks may declare required capabilities; GOD prefers matching idle hires.

**Why this priority**: HR-007; hiring is only valuable if work routes to the right specialist.

**Independent Test**: Spawn two hires with different capability tags; enqueue tasks tagged `ios` and `qa`; verify each task assigns to the matching hire when idle.

**Acceptance Scenarios**:

1. **Given** a task requiring capability `ios` and an idle hire tagged `ios`, **When** Ira routes the task, **Then** the task assigns to that hire.
2. **Given** two hires with overlapping tags, **When** Ira routes, **Then** routing uses tag match first and documented tie-break (e.g. lower current load or higher hire score).
3. **Given** no hire matches required capabilities, **When** Ira routes, **Then** task remains unassigned or escalates per Command Plane policy with a clear missing-capability reason.

---

### User Story 6 - Hire performance scoring (Priority: P3)

Over time, the system records hire outcomes (task pass rate, cost vs budget, review failures) and computes a score per hire. Low-performing hires surface demotion hints (reassign work, reduce tier, or retire) without automatic demotion.

**Why this priority**: HR-008 SHOULD; operational improvement after core hire flow is stable.

**Independent Test**: Simulate a hire with high review-failure rate; verify score decreases and demotion hint appears; verify no automatic roster change without Operator action.

**Acceptance Scenarios**:

1. **Given** a hire completing multiple tasks, **When** outcomes are recorded, **Then** a score reflects pass rate, spend, and review failures.
2. **Given** a hire score below configured threshold, **When** Operator views roster or hire detail, **Then** a demotion hint is shown with supporting metrics.
3. **Given** a demotion hint, **When** no Operator action is taken, **Then** the hire remains on roster and routing unchanged (hints only).

---

### Edge Cases

- What happens when Operator re-imports a manifest for an hire name that already exists? System MUST prompt merge vs replace vs cancel; MUST NOT silently overwrite active roster config.
- What happens when manifest suggests an engine or model tier that is not installed? Review form MUST flag unavailable defaults before spawn.
- What happens when capability tags are empty? System MUST warn Operator and routing falls back to explicit assignment only.
- What happens when gallery entry hash differs from cached copy? System MUST treat as fresh untrusted import and require review again.
- What happens when skills consent is partial? Only consented skills enter allowlist; spawn MAY proceed if persona requirements are met.
- What happens on import of extremely large manifest fields? System MUST reject or truncate per size limits with visible errors.
- What happens if Operator confirms spawn but disk write fails? No partial roster entry; Operator sees rollback error.
- What happens when `list-personas` runs mid-spawn? Eventual consistency acceptable within a few seconds; SC-003 bounds this.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow the Operator to initiate a hire from a manifest file or from a gallery catalog entry. *(HR-001)*
- **FR-002**: System MUST represent every hire as a versioned manifest containing at minimum: display name, goal or briefing text, capability tags, suggested engine, suggested model tier, token or cost budget, and allowlists for skills and MCP integrations with default-deny when omitted. *(HR-002)*
- **FR-003**: System MUST NOT spawn or start any worker agent on manifest import, gallery selection, or parse completion; spawn MUST occur only after explicit Operator confirmation on the review form. *(HR-003)*
- **FR-004**: System MUST treat manifests from network or shared sources as untrusted input: validate schema version, enforce allowlisted fields, reject executable payloads, and sanitize or reject unknown keys. *(HR-004)*
- **FR-005**: On confirmed spawn, system MUST install or update portable persona definitions in standard agent locations so existing persona listing discovers the hire across supported harnesses (project and home agent directories). *(HR-005)*
- **FR-006**: System MUST require explicit Operator consent before installing any skill referenced by a hire; system SHOULD support an optional pre-install security scan with visible results. *(HR-006)*
- **FR-007**: Ira MUST route dispatchable work to hires by matching task capability requirements to hire capability tags before falling back to display name or manual assignment. *(HR-007)*
- **FR-008**: System SHOULD compute and persist a hire performance score from task outcomes (pass rate, cost vs budget, review failures) and SHOULD surface demotion hints when score falls below threshold without automatically changing roster state. *(HR-008)*
- **FR-009**: System MUST expose hire flows through Command Plane API (CLI and MCP) so the same review-and-confirm behavior is available without Command Center UI.
- **FR-010**: System MUST default to deny-all for skills and MCP unless explicitly allowlisted on the manifest or confirmed by Operator during review.
- **FR-011**: System MUST classify untrusted hire import as HITL-critical: pending imports appear in Ask-Me or equivalent approval surface until Operator confirms spawn via `hire-spawn-confirm`, cancels via `hire-spawn-cancel`, or resolves Ask-Me with `action: "acknowledge"` on `reasonClass: "untrusted_import"`, which MUST cancel the review (same effect as cancel: no persona, no roster row) and MUST NOT spawn. *(OD-018)*
- **FR-012**: Operator MUST be able to edit engine, model tier, budget, goal, capability tags, and allowlists on the review form before spawn; confirmed values become the roster entry source of truth.
- **FR-013**: Curated gallery entries and remote or shared manifests MUST use the same review path: schema validation, allowlisted fields, executable-payload rejection, a visible sanitization report of equal scope and detail, and explicit Operator confirmation before spawn. A curated entry MUST NOT skip sanitization or HITL. The warning banner string MUST be the single constant `Untrusted import — review all fields before spawn.` for file, URL, paste, and gallery; `approvalCopyVariant: "curated_catalog"` MUST NOT change that string. A curated entry MAY show a separate `trustHint` label (e.g. “curated catalog”); `trustHint` MUST NOT replace or shorten the warning banner. A different warning returns `HIRE_WARNING_LENGTH_MISMATCH` and confirm MUST NOT run. The sanitization report MUST still appear on the review form. A hash or content change MUST be treated as a new untrusted import. *(HR-003, HR-004, §5.3, OD-008, OD-018)*
- **FR-014**: `hire-spawn-confirm` MUST be the only command that writes portable persona files and upserts a hire roster row (`origin: "hire"`). Ask-Me or any other tool with `action: "acknowledge"` on `untrusted_import` MUST NOT perform spawn writes and MUST return a result that callers treat as cancel (`HIRE_ACK_CANCELS`). Confirm attempted from any path other than `hire-spawn-confirm` returns `HIRE_SPAWN_CONFIRM_REQUIRED`. Until doctor reports `sliceAValidated: true`, `hire-spawn-confirm` MUST no-op with `SLICE_A_ONLY` and perform no persona or roster write. *(OD-018, OD-020)*

### Key Entities

- **HireManifest**: Versioned import document — name, goal, capability tags, suggested engine, suggested model tier, suggested budget, skills allowlist, MCP allowlist; no executable payload.
- **HireReview**: Pending import state — parsed manifest, sanitization report, Operator edits, consent records for skills, approval status.
- **RosterEntry**: Spawned hire on the floor — links to persona paths, confirmed engine/model/budget, capability tags, allowlists, status, optional score.
- **GalleryEntry**: Catalog metadata pointing at a manifest — title, description, capability tags, source URI, trust hint; selection produces a HireReview, not a spawn.
- **HireScore**: Aggregated metrics — pass rate, spend, review failure count, computed score, demotion hint flag.
- **SkillConsent**: Per-skill decision — skill id, source, scan result, accepted or declined.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operator can complete hire from manifest or gallery through review to confirmed spawn in under three minutes for a standard specialist template.
- **SC-002**: Zero percent of imports result in agent spawn before explicit Operator confirmation, including curated gallery entries per FR-013 (verified by automated and manual tests).
- **SC-003**: After confirmed spawn, new hire appears in persona listing output within five seconds under normal local conditions.
- **SC-004**: When at least one idle hire matches a task’s required capability tag, at least ninety-five percent of routable dispatches in test scenarios assign to a matching hire.
- **SC-005**: One hundred percent of test manifests containing executable payloads or disallowed content are rejected without roster or persona changes.
- **SC-006**: Operators can identify why a hire received a demotion hint from visible score breakdown without reading raw logs.

## Assumptions

- Gallery v1 is a curated catalog (local index with optional remote entries), not an unmoderated marketplace; moderation policy is out of scope except untrusted-input handling at import.
- Command Center UI (P-002) consumes the same hire API as CLI/MCP; this spec defines behavior, not visual design.
- Worktree isolation for code-writing hires follows parent SS-005 as default roster policy set at spawn.
- Hire scoring v1 uses ledger and forge outcome data already recorded by Command Plane and token features; no new manual Operator data entry.
- Reuse implementation adapts Munder hire modules where compatible; SuperSpec-specific persona paths and MCP tools remain authoritative.
- Duplicate hire names, engine availability checks, and tag normalization rules are finalized in architect/refine unless marked below.
- Gallery trust tiers (OD-008): resolved in FR-013 — same sanitization, HITL, and warning banner for curated and remote imports; only an optional `trustHint` label may differ.
- Command Center hire mutations (when exposed on the loopback board) follow parent OD-017 bearer token on POST/PUT/PATCH/DELETE; hire behavior in this spec is unchanged aside from that mutation gate.

## Clarifications

### Session 2026-10-15

- Q: Gallery trust tiers — should curated gallery entries skip full sanitization warnings or always use the same untrusted-import review path? (OD-008 / FR-013) → A: Same review path for curated catalog entries and remote or shared manifests: schema validation, allowlisted fields, executable-payload rejection, visible sanitization report, and explicit Operator confirmation before spawn. Curated entries MUST NOT skip sanitization or HITL. Banner and sanitization report parity for curated vs remote were locked in Session 2026-10-16 (OD-018). Hash or content change MUST be treated as a new untrusted import.

### Session 2026-10-16

- Q: After `ira-architecture-amendment-2026-10-16`, does Ask-Me `acknowledge` on `untrusted_import` confirm spawn? (OD-018 / FR-011, FR-014) → A: No. `acknowledge` on `reasonClass: "untrusted_import"` cancels the hire review with the same disk effects as `hire-spawn-cancel` (no persona, no roster). Only `hire-spawn-confirm` writes persona and roster. Result payload includes `HIRE_ACK_CANCELS` so UIs do not treat acknowledge as spawn.
- Q: May curated gallery entries use a shorter trust banner or abbreviated sanitization report? (OD-008 / FR-013, OD-018) → A: No. Warning banner is identical for every `sourceKind`, including gallery: `Untrusted import — review all fields before spawn.` Curated entries MAY add a separate `trustHint` label only; they MUST NOT shorten the banner or the sanitization report. Mismatch returns `HIRE_WARNING_LENGTH_MISMATCH`.
- Q: Do Command Center hire actions bypass loopback auth? (OD-017 / FR-009) → A: No. Mutating hire controls on the loopback board use the same OD-017 bearer token as other board mutations; CLI and MCP hire tools remain available locally without that header when not routed through the bridge.

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->

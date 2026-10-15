# Feature Specification: Ira Command Center

**Feature Branch**: `002-ira-command-center`

**Created**: 2026-09-06

**Status**: Draft

**Type**: product

**Input**: User description: "Web Command Center for Ira (GOD board). Consumes Command Plane (P-001). Sci-fi animated tech UI; visual language OPEN. Views: Tasks kanban, Fleet, Activity, Memory/patterns, Spend, Ask-Me, Triggers, Morning brief. Adapt Munder Command Center IA. Voice is P3 / OPEN."

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` | Parent requirements — UI-*, CP-002, GD-008, TK-004, journeys, OPEN-001/003, NG3/NG6 |
| `docs/superspec/specs/ira-prior-art-reuse-map.md` | Reuse-first map — adapt Munder Command Center panels before inventing IA |
| `program.md` | Program P-002 row, OD-001 (visual), OD-003 (voice), OD-004 (prefer adapt) |
| `specs/001-ira-command-plane/spec.md` | Upstream dependency — Command Plane is the only system of record this board consumes |
| `content/templates/constitution.md` | Governance — Test-First and FR ↔ task ↔ test traceability for later plan tasks |
| `docs/explanation/lifecycle.md` | SuperSpec spine this board oversees; UI must not replace spec → plan → forge → validate → ship |

## Prior Art (reuse / inspiration)

Prefer **adapting** the Munder board information architecture over inventing a new one. Formal FRs stay WHAT/WHY; paths below guide later `architect` / `forge`. Do not copy LimeZu pixel assets. Do not lock cinematic art direction (OD-001 remains open).

### Reuse first — Munder Difflin (MIT)

Repo: https://github.com/chaitanyagiri/munder-difflin

Guide: https://munderdiffl.in/blog/command-center-guide/

| Ira board concern | Adapt from |
|-------------------|------------|
| Command Center shell / panel IA | `src/renderer/src/components/CommandCenterPanel.tsx` |
| Dependency-aware Tasks kanban | `src/renderer/src/components/TasksKanban.tsx` |
| Ask-Me / approvals inbox | `src/renderer/src/components/AskMeTab.tsx`; `askMeOrder.ts` |
| Fleet / workers | `src/renderer/src/components/WorkersTab.tsx` |
| Spend / cost attention | `CostHud.tsx`; `costStore.ts`; `src/main/costLedger.ts`; `src/main/realtimeCost.ts` |
| Memory / patterns panels | `MemoryPanel.tsx`; `MemoryGraphPanel.tsx`; `src/main/memory.ts` |
| Floor vs board attention | https://munderdiffl.in/blog/command-center-guide/ — floor for one agent, **board for the fleet** |

### Inspiration only — sci-fi ops surfaces (do not clone)

| Source | URL | What to take |
|--------|-----|--------------|
| NEXUS-7 HUD | https://github.com/nael-awadallah/nexus-hud | Holographic glass, layered HUD density — **inspiration**, not a kit lock-in |
| Sentient-OS | https://github.com/gestas666/Sentient-OS | KITT-style mission-control attention over multiple engines |
| KITT / Knight Rider mission control | cultural reference (parent §12 OPEN-001) | Calm vehicle-ops presence; clipped status; not a franchise replica |
| Arc-reactor / holographic presence | parent §3.2 / §12 | Presence and depth cues; must remain SuperSpec-original |
| Mission Control | https://github.com/0x-nyk/mission-control | Ops panel set (tasks, tokens) as a secondary IA check |
| Hermes Studio | https://github.com/JPeetz/Hermes-Studio | Multi-agent studio layout ideas only |
| MIRA / Vesper | https://github.com/mkr-infinity/MIRA ; https://github.com/Souvikkundu0901/Vesper-assistant | HUD motif research; do not ship a Jarvis clone |

### Explicitly do not copy

- Munder pixel “office / Sims” floor as the **primary** product surface (NG3).
- Any Marvel / JARVIS likeness, catchphrase, or forced “sir” address.
- Ruflo’s full tool surface or neural stack as a UI dependency.

## User Scenarios & Testing *(mandatory)*

Operator-facing journeys for Ira’s web Command Center. Each story is independently demonstrable. The Command Center **consumes** the Command Plane (P-001); it does not own hive, ledger, or learning stores.

### User Story 1 - Open Ira's GOD board (Priority: P1)

An Operator opens the web Command Center and immediately sees Ira’s management board: a shell that can reach Tasks, Fleet, Activity, Memory/patterns, Spend, Ask-Me, and Triggers. Each view shows Command Plane state, or a truthful empty/degraded state if that store has nothing yet.

**Why this priority**: The program’s first success test is overseeing SuperSpec work without reading raw terminal scrollback. A board that cannot be opened and navigated delivers no Command Center.

**Independent Test**: With Command Plane state available (or deliberately empty), open the Command Center and visit every GOD view. Confirm each view is reachable and never invents tasks, agents, spend, or approvals.

**Acceptance Scenarios**:

1. **Given** the Command Plane is reachable and has at least one feature’s tasks and roster, **When** the Operator opens the Command Center, **Then** the board shell is available and the Operator can open Tasks, Fleet, Activity, Memory/patterns, Spend, Ask-Me, and Triggers without using a terminal.
2. **Given** the Command Plane is reachable but a view’s store is empty (no patterns, no spend events, no triggers), **When** the Operator opens that view, **Then** the view shows an empty state that says nothing is recorded yet — not a fake fleet or fake spend.
3. **Given** the Command Plane is unreachable, **When** the Operator opens the Command Center, **Then** the board shows a degraded state and does not display invented work.

---

### User Story 2 - Steer work from the Tasks kanban (Priority: P1)

An Operator uses the Tasks view as a dependency-aware kanban and steers the floor: dispatch, pause, abort, and reassign. Ready work is visually distinct from work waiting on unmet dependencies.

**Why this priority**: Oversight without steer still leaves the Operator in the terminal for every intervention. Kanban + steer is the board’s primary control surface (Munder IA).

**Independent Test**: Seed a small task ledger (one ready, one blocked on a dependency, one in progress). Demonstrate dispatch, pause, abort, and reassign from the board and confirm Command Plane status matches what the board shows.

**Acceptance Scenarios**:

1. **Given** a task whose dependencies are satisfied and whose status is ready, **When** the Operator views Tasks, **Then** that task is visually distinguishable from tasks still waiting on unmet dependencies.
2. **Given** a ready or in-progress task on the board, **When** the Operator dispatches, pauses, aborts, or reassigns it from the Command Center, **Then** the Command Plane records the same action and the kanban reflects the new status without the Operator using a CLI.
3. **Given** a task that is waiting on an unmet dependency, **When** the Operator views Tasks, **Then** the board does not present that task as ready to start.

---

### User Story 3 - Clear the Ask-Me inbox (Priority: P1)

An Operator sees critical human-in-the-loop items in Ask-Me and answers them from the board. Routine automation does not appear as inbox spam.

**Why this priority**: Ira’s contract is “interrupt only for critical class.” If Ask-Me is missing, the Operator is forced back into terminals and chat.

**Independent Test**: Seed one critical Ask-Me item and one routine auto-routed event. Open Ask-Me only. Answer the critical item from the board and confirm the Command Plane records the answer.

**Acceptance Scenarios**:

1. **Given** the Command Plane has at least one open critical Ask-Me item, **When** the Operator opens Ask-Me (or the board chrome that surfaces unread escalations), **Then** that item is visible with enough context to answer it.
2. **Given** an open Ask-Me item, **When** the Operator submits an answer from the Command Center, **Then** the Command Plane records the answer and the item leaves the open inbox (or is marked answered) without a terminal.
3. **Given** only routine automation has occurred (next-task pick, idle wake, pattern retrieve), **When** the Operator opens Ask-Me, **Then** those routine events are not presented as items requiring an answer.

---

### User Story 4 - Brief Ira from the board (Priority: P1)

An Operator submits a goal brief — outcome, constraints, budget, deliverable — to Ira from the Command Center and sees that Ira accepted it (staffing / task ledger update, or a clear “working on it” acknowledgement bound to Command Plane state).

**Why this priority**: Program success begins with “brief a feature and watch it progress on a Command Center board.” The board is a briefing surface, not only a monitor.

**Independent Test**: Submit a brief from the Command Center with no CLI. Confirm the Command Plane has the brief and the board shows acknowledgement or resulting tasks.

**Acceptance Scenarios**:

1. **Given** the Command Plane can accept a goal brief, **When** the Operator submits outcome, constraints, budget, and deliverable from the Command Center, **Then** Ira’s Command Plane records that brief and the board shows acknowledgement tied to that record.
2. **Given** the Operator omits a required brief field (outcome or deliverable), **When** they try to submit, **Then** the board refuses the submit and sends nothing to the Command Plane.
3. **Given** a brief was accepted, **When** the Operator returns to Tasks or the morning brief, **Then** newly staffed or attached work from that brief is visible once the Command Plane exposes it.

---

### User Story 5 - Read the morning brief (Priority: P2)

An Operator reads Ira’s morning/status brief: done, blocked, spend, quota when known, open escalations, and next triggers — lead-with-numbers, in Ira’s clipped voice.

**Why this priority**: This is the daily attention contract (UI-004). It is independently valuable even if the Operator never opens every other panel that day.

**Independent Test**: Seed done, blocked, spend, one escalation, and one upcoming trigger. Open only the brief. Confirm each number/item is present and matches Command Plane state.

**Acceptance Scenarios**:

1. **Given** Command Plane state includes completed tasks, at least one blocked task, spend, an open escalation, and a next trigger, **When** the Operator opens the morning/status brief, **Then** the brief reports done count, blocked count, spend, the escalation, and the next trigger.
2. **Given** quota/subscription signal is unknown, **When** the Operator opens the brief, **Then** the brief still reports the other fields and shows quota as unknown rather than a guessed percentage.
3. **Given** there are no open escalations, **When** the Operator opens the brief, **Then** the brief states that nothing needs the human.

---

### User Story 6 - Inspect the fleet (Priority: P2)

An Operator uses Fleet to see each worker: identity, status (idle / busy / blocked / offline), assigned engine and model when known, capability tags, current task, and a context-window (or remaining-capacity) gauge when measurable.

**Why this priority**: Fleet is how the Operator judges who is working, who is stuck, and who is near context exhaustion — Munder Workers tab IA.

**Independent Test**: Seed two workers (one busy with a measurable context ratio, one idle/offline). Open only Fleet. Confirm cards match Command Plane roster fields.

**Acceptance Scenarios**:

1. **Given** a roster with at least two workers in different statuses, **When** the Operator opens Fleet, **Then** each worker shows identity, status, and current task (or idle).
2. **Given** the Command Plane provides a context-used ratio for a busy worker, **When** the Operator views that worker card, **Then** a context-window (or equivalent remaining-capacity) gauge is visible.
3. **Given** engine or model is unknown for a worker, **When** the Operator views that card, **Then** those fields show unknown/unset rather than a fabricated engine name.

---

### User Story 7 - Inspect spend and budgets (Priority: P2)

An Operator uses Spend to see token and estimated cost versus budgets, and to notice circuit-breaker attention (steer / constrain / stop) when the Command Plane exposes it.

**Why this priority**: Spend is a GOD-level view (UI-001). The Operator cannot keep a fleet honest from terminals alone.

**Independent Test**: Seed spend events and a budget in constrain or stop. Open only Spend. Confirm totals and breaker state match the Command Plane.

**Acceptance Scenarios**:

1. **Given** the Command Plane has spend events for at least one agent and one feature, **When** the Operator opens Spend, **Then** the view shows cost (or token totals) rolled up per agent and per feature.
2. **Given** a budget is in constrain or stop, **When** the Operator opens Spend, **Then** that attention state is visible without opening a terminal.
3. **Given** no spend events exist yet, **When** the Operator opens Spend, **Then** the view is empty/zero and does not invent currency figures.

---

### User Story 8 - Follow the activity stream (Priority: P2)

An Operator uses Activity to read the append-only event stream: dispatches, completions, failures, escalations, and other hive events in time order.

**Why this priority**: Activity is the audit surface when the Operator asks “what just happened?” without scrolling a terminal.

**Independent Test**: Append three distinct events via the Command Plane. Open only Activity. Confirm order and that the board does not rewrite history.

**Acceptance Scenarios**:

1. **Given** three events recorded in the Command Plane log, **When** the Operator opens Activity, **Then** those events appear in the same order the Command Plane recorded them.
2. **Given** a new event is recorded while the Operator has Activity open, **When** the Command Plane accepts that event, **Then** the stream shows it without the Operator performing a full restart of the Command Center.
3. **Given** the event log is empty, **When** the Operator opens Activity, **Then** the view shows an empty log, not sample/demo events.

---

### User Story 9 - Inspect memory and patterns (Priority: P2)

An Operator uses Memory/patterns to see persisted learnings the Command Plane (and later P-003) exposes — success and failure lessons that survive chat compaction.

**Why this priority**: Durable learning is a primary Ira goal. The board must make patterns inspectable even when the store is still empty.

**Independent Test**: Seed zero patterns, then one pattern. Open only Memory. Confirm empty then populated states; the board never claims a pattern the Command Plane does not have.

**Acceptance Scenarios**:

1. **Given** the pattern store is empty, **When** the Operator opens Memory/patterns, **Then** the view states that no patterns are stored yet.
2. **Given** at least one pattern exists on the Command Plane, **When** the Operator opens Memory/patterns, **Then** the Operator can read its summary and kind (success or failure lesson) without opening files by hand.
3. **Given** chat context for a worker was compacted or cleared, **When** the Operator opens Memory/patterns, **Then** stored patterns are still listed (compaction does not empty this view).

---

### User Story 10 - Inspect triggers and schedules (Priority: P2)

An Operator uses Triggers to see idle-wake and night/away schedules the Command Plane will honor, and which fire next.

**Why this priority**: Night/away and idle-wake are how Ira works when the Operator is not watching. The board must make those commitments visible (UI-001).

**Independent Test**: Seed one idle-wake rule and one night/away trigger (or none). Open only Triggers. Confirm the view matches Command Plane schedules.

**Acceptance Scenarios**:

1. **Given** at least one trigger or schedule exists, **When** the Operator opens Triggers, **Then** each item shows what will fire and when (or on which condition).
2. **Given** no triggers exist, **When** the Operator opens Triggers, **Then** the view shows that nothing is scheduled — not a hidden night loop.
3. **Given** a trigger is disabled or exhausted, **When** the Operator views it, **Then** that state is visible so the Operator does not assume it will fire.

---

### User Story 11 - Sci-fi ops surface without locked art direction (Priority: P2)

An Operator experiences the Command Center as an animated, technical, sci-fi operations surface that is original to SuperSpec — not a stock cinematic-assistant clone and not a pixel office. Exact visual language stays open.

**Why this priority**: UI-002 is in vision for this feature, but OD-001 forbids silently locking art direction during scope. The story is independently reviewable as spirit and originality, not as a finished style guide.

**Independent Test**: Review the running board (or a visual prototype of the shell) against the non-clone / non-office rules. No requirement that a named aesthetic be implemented.

**Acceptance Scenarios**:

1. **Given** the Command Center is open, **When** a reviewer assesses the surface, **Then** the board is recognizably animated and technical (motion, depth, or living status — not a static unstyled form dump).
2. **Given** the same review, **When** the reviewer compares the surface to a stock cinematic-assistant HUD or a pixel office floor, **Then** the Command Center is not a replica of either.
3. **Given** OD-001 is still open, **When** this story is accepted, **Then** no palette, typeface, or franchise look is treated as the locked product identity.

---

### User Story 12 - Voice to Ira (Priority: P3)

An Operator may speak a brief, ask for status, or approve an Ask-Me item by voice. Voice never silently spends, spawns, or performs destructive actions.

**Why this priority**: UI-007 is in product vision; OD-003 defers timing and speech approach. Voice must not gate any P1 journey.

**Independent Test**: If voice is not built, this story is demonstrated as absent-but-specified (P1 journeys complete by pointing and typing). If a voice path exists, demonstrate status, brief, and approve — and demonstrate that a spoken spend/spawn is refused without confirmation.

**Acceptance Scenarios**:

1. **Given** voice is not enabled, **When** the Operator uses the Command Center, **Then** every P1 journey still completes by pointing and typing.
2. **Given** voice is enabled, **When** the Operator speaks a request for status or a brief, **Then** Ira responds with a board-visible result (brief or status), not an unattended side effect.
3. **Given** voice is enabled, **When** the Operator’s speech would spend over budget, spawn a hire, or perform a destructive action, **Then** the system refuses silent execution and requires an explicit confirmation the Operator can still cancel.

---

### Edge Cases

- What happens when the Command Plane goes unreachable after the board was already showing live data? The board MUST mark data stale/degraded and MUST NOT continue to present it as current.
- How does the board handle a very large activity log? The view MUST remain usable (Operator can see recent events first) and MUST NOT drop the append-only order of what it does show.
- What happens if the Operator steers from the board while a CLI operator also records a result on the same task? The board MUST reconcile to Command Plane state (last recorded Plane state wins) and MUST NOT keep a contradictory local status.
- How does Fleet treat a worker whose status is unknown? The card MUST show unknown/offline-equivalent, not busy.
- What happens when Spend exists but budgets do not? The view MUST show spend and MUST show budgets as unset.
- What happens when Memory is requested before P-003 ships? The view MUST use the empty/unavailable state; it MUST NOT embed a second pattern store.
- How does Ask-Me behave when a new critical item arrives while the Operator is on Tasks? The board MUST make the new escalation noticeable without silently answering it.
- What happens if the Operator aborts a task that is already done? The board MUST refuse or no-op with an explanation; it MUST NOT rewrite a completed result as aborted unless the Command Plane allows that transition.
- What happens if the Operator reassigns to an offline worker? The board MUST warn and MUST NOT present the reassignment as a successful dispatch.
- How does the morning brief behave with zero work in the ledger? It MUST say nothing is in flight (zero done, zero blocked) rather than failing to open.
- What happens if voice is misheard as approve? The system MUST NOT treat an ambiguous utterance as approval of spend, spawn, or destructive work.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Operator MUST be able to open a web Command Center that presents Ira’s GOD-level management board over Command Plane state (parent CP-002).
- **FR-002**: Command Center MUST provide a Tasks view that shows work as a dependency-aware kanban, distinguishing ready, waiting-on-dependency, in-progress, blocked, and done (parent UI-001).
- **FR-003**: Command Center MUST provide a Fleet view of the worker roster including identity, status, current task, capability tags, and assigned engine/model when the Command Plane provides them (parent UI-001).
- **FR-004**: Command Center MUST provide an Activity view of the append-only event log in recorded order (parent UI-001, HV-004).
- **FR-005**: Command Center MUST provide a Memory/patterns view of persisted learnings the Command Plane exposes, including a truthful empty state when none exist (parent UI-001).
- **FR-006**: Command Center MUST provide a Spend/budgets view of token use and estimated cost versus budgets, and MUST surface circuit-breaker attention (steer / constrain / stop) when the Command Plane exposes it (parent UI-001).
- **FR-007**: Command Center MUST provide an Ask-Me/approvals inbox for critical human-in-the-loop items and MUST make those escalations visible on the board (parent UI-001, GD-003, GD-008).
- **FR-008**: Command Center MUST provide a Triggers/schedules view of idle-wake and night/away commitments the Command Plane will honor (parent UI-001).
- **FR-009**: Command Center MUST provide a morning/status brief that summarizes done, blocked, spend, quota when known, open escalations, and next triggers (parent UI-004).
- **FR-010**: Operator MUST be able to dispatch, pause, abort, and reassign work from the Command Center (parent UI-005).
- **FR-011**: Operator MUST be able to answer Ask-Me items from the Command Center without using a terminal (parent UI-005).
- **FR-012**: Operator MUST be able to submit a goal brief (outcome, constraints, budget, deliverable) to Ira from the Command Center (parent GD-001, journey 9.1).
- **FR-013**: While the Command Center remains open, presented state MUST stay current with the Command Plane so the Operator does not need a full restart to see new status (parent UI-003, NFR-003).
- **FR-014**: Fleet worker cards MUST show a context-window (or equivalent remaining-capacity) gauge when the Command Plane provides a measurement (parent TK-004).
- **FR-015**: Command Center MUST treat the management board as the primary fleet surface; a spatial or ambient “floor” view MAY exist later and MUST NOT replace the board (parent UI-006).
- **FR-016**: Command Center MUST present an animated, sci-fi, technical operations surface that is original to SuperSpec (not a stock cinematic-assistant clone and not a pixel office). Exact visual language is [NEEDS CLARIFICATION: OD-001 / OPEN-001 — Operator has not locked art direction; KITT / arc-reactor / holographic-glass inspiration is allowed; do not treat any kit or franchise look as the product identity].
- **FR-017**: Command Center MUST identify Ira (Intelligent Resource Automation) as the GOD floor director in chrome and brief copy, using the callsign **Ira** (title case), never all-caps IRA in UI chrome.
- **FR-018**: Command Center MUST consume the same Command Plane state an operator can read without the UI, and MUST NOT become a second system of record for tasks, roster, spend, patterns, or approvals (parent CP-002, Option D).
- **FR-019**: Command Center MUST remain fully usable with neither Hermes nor OpenClaw installed (parent INT-003).
- **FR-020**: When the Command Plane is unreachable or a view’s store is empty, Command Center MUST show a degraded or empty state and MUST NOT fabricate tasks, agents, spend, patterns, triggers, or approvals.
- **FR-021**: Operator MAY brief Ira, request status, and approve Ask-Me items by voice. Voice MUST NOT silently spend, spawn a hire, or perform destructive actions. Delivery timing and speech approach are [NEEDS CLARIFICATION: UI-007 / OD-003 — voice is in product vision; speech-to-text, speech synthesis, and wake-word are unset; treat as P3 and do not block P1 journeys].
- **FR-022**: Command Center MUST use a Munder-like board information architecture (shell + GOD panels) as the default layout; the Operator MUST NOT be required to learn a novel IA to reach Tasks, Fleet, Ask-Me, Memory, or Spend.
- **FR-023**: Routine automation events MUST NOT appear as Ask-Me items that require an answer (parent §5.3 routine vs critical).
- **FR-024**: Morning brief copy MUST lead with numbers (done / blocked / spend / quota-or-unknown / what needs the human) in Ira’s calm, clipped voice; address defaults to Operator and MUST NOT force a cinematic “sir.”
- **FR-025**: SuperSpec CLI/MCP workflows MUST remain usable with the Command Center closed (parent SS-001); this feature MUST NOT require the board in order for forge work to proceed.

### Parent requirement crosswalk

| Parent ID | Command Center FR | Notes |
|-----------|-------------------|-------|
| CP-002 | FR-001, FR-018 | Web board consumes Command Plane; no second ledger |
| UI-001 | FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008 | Seven GOD views |
| UI-002 | FR-016 | Visual spirit required; art direction OPEN |
| UI-003 | FR-013 | Live board while open |
| UI-004 | FR-009, FR-024 | Morning/status brief |
| UI-005 | FR-010, FR-011 | Steer + answer Ask-Me |
| UI-006 | FR-015 | Board primary; floor optional later |
| UI-007 | FR-021 | Voice = P3 / OPEN |
| GD-001 | FR-012 | Brief from the board |
| GD-003 | FR-007, FR-011, FR-023 | Ask-Me inbox, not terminal spam |
| GD-008 | FR-007 | Escalations visible on the board |
| HV-004 | FR-004 | Activity driven by append-only log |
| TK-004 | FR-014 | Context-window gauge on worker cards |
| INT-003 | FR-019 | No Hermes / OpenClaw required |
| SS-001 | FR-025 | Lifecycle works without the UI |
| NG3 / NG6 | FR-015, FR-016 | No pixel-office primary UX; no silent art lock |

Related parent IDs **not** specified here (sibling features own them): CP-001, HV-*, LR-*, TK-001–003 and TK-005–009 write path, HR-*, EN-* adapters, INT-001/002/004/005, DX-001–002. This board **displays** spend, patterns, engines, and triggers when the Command Plane exposes them.

### Key Entities

- **Command Center board**: Operator-facing shell Ira presents; hosts GOD views; never the system of record.
- **GOD view**: One of Tasks, Fleet, Activity, Memory/patterns, Spend, Ask-Me, Triggers, plus the morning/status brief.
- **Task card**: One ledger item on the kanban — identity, feature, dependency readiness, status, assignee, steer actions.
- **Worker card**: One roster entry — identity, status, engine/model when known, capabilities, current task, context gauge when known.
- **Activity event**: One append-only log record shown in time order.
- **Pattern record**: One persisted learning (success or failure lesson) shown in Memory; owned by the Command Plane / P-003.
- **Spend snapshot**: Token and estimated-cost totals vs budgets, plus breaker attention when present; owned by the Command Plane / P-004.
- **Ask-Me item**: One critical HITL question or approval; answerable from the board.
- **Trigger**: One idle-wake or night/away commitment with condition/time and enabled state.
- **Morning brief**: Number-led status Ira shows the Operator (done, blocked, spend, quota-or-unknown, escalations, next triggers).
- **Goal brief**: Operator-submitted outcome + constraints + budget + deliverable Ira expands into staffing/tasks on the Command Plane.
- **Ira presence**: GOD persona chrome and copy (Intelligent Resource Automation; callsign Ira).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An Operator who has never opened a terminal for the session can name current done, blocked, and in-progress work from the board in under 30 seconds when Command Plane state exists.
- **SC-002**: All seven GOD views (Tasks, Fleet, Activity, Memory/patterns, Spend, Ask-Me, Triggers) plus the morning/status brief are reachable from the board shell in one sitting.
- **SC-003**: After a Command Plane state change, the open board shows the new state within 2 seconds on a local machine (parent NFR-003 target).
- **SC-004**: An Operator can complete dispatch, pause, abort, reassign, and answer Ask-Me from the board with the CLI closed (5 of 5 actions).
- **SC-005**: A morning brief drawn from seeded state always includes done count, blocked count, spend, escalations (or explicit “none”), and next triggers (or explicit “none”); quota is a number or explicit unknown (never a guessed value).
- **SC-006**: In 100% of unreachable-Plane and empty-store cases exercised, the board shows degraded or empty UI and invents zero tasks, agents, spend lines, patterns, or approvals.
- **SC-007**: 100% of P1 acceptance scenarios pass with voice disabled or absent.
- **SC-008**: A visual review records that the board is animated and technical, and that it is not a stock cinematic-assistant clone and not a pixel office; no art-direction lock is claimed while OD-001 is open.
- **SC-009**: 100% of open critical Ask-Me items present on the Command Plane are visible from the board (inbox or equivalent chrome) before the Operator is forced to a terminal.
- **SC-010**: With the Command Center closed, an Operator can still run the SuperSpec lifecycle from CLI/MCP (board not a required control).

## Assumptions

- This feature **depends on P-001 (ira-command-plane)**. The board reads and steers only through Command Plane state; it does not implement hive, GOD routing, or ledgers.
- **Information architecture** adapts Munder `CommandCenterPanel` (shell + Tasks / Workers / Ask-Me / Memory / Cost panels), adding Activity, Triggers, and the morning brief rather than inventing a new IA.
- **Visual language stays OPEN** (OD-001). Scope records spirit and non-clone rules only. Refine/design must not silently pick a final look.
- **Voice is P3 / OPEN** (OD-003, UI-007). P1/P2 journeys are pointer-and-keyboard complete.
- **Access model**: v1 is a local, single-Operator board (localhost-class). Shareable teammate URLs and multi-user auth are P-007 / OPEN-007, out of scope here.
- **No Electron requirement**. A browser-opened local web Command Center satisfies CP-002.
- **Mobile layout** is out of scope for v1; a desktop-width board is sufficient.
- **Spatial / ambient floor** is out of scope for v1 (UI-006 MAY later).
- **Hire gallery, engine adapters, pattern-store internals, and budget-enforcement logic** belong to P-005, P-006, P-003, and P-004. This board displays what those planes expose and offers empty states when they do not.
- Changing numeric budgets, installing skills, and importing hires are not required P1 actions on this board.
- Abort and critical approvals require an explicit Operator confirmation; pause and dispatch of **ready** work do not.
- Default address in copy is **Operator** (configurable later). Never force “sir.”
- Last-used GOD view MAY be remembered; the morning brief remains reachable without hunting.
- Telemetry of prompts/code stays off by default (parent DX-003).
- Hermes and OpenClaw are unused (P-007 deferred).
- MIT attribution is preserved when Munder/Ruflo modules are later adapted; LimeZu pixel assets are never copied.

## Non-goals

- Replacing Claude Code, Cursor, or Codex as the code-writing runtime (NG1).
- A general personal assistant (calendar, home IoT) (NG2).
- A pixel office / Sims floor as the primary UX (NG3).
- Locking cinematic art direction in this spec (NG6, OD-001).
- Requiring Hermes or OpenClaw (NG5, INT-003).
- Owning Command Plane APIs, hive protocol, learning pipeline, or engine adapters (P-001, P-003, P-004, P-006).

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->

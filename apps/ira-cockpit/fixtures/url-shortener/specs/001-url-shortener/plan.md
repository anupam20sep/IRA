# Implementation Plan: URL Shortener

**Feature Branch**: `001-url-shortener`

**Input**: Design documents from `spec.md` and `design.md`

**Prerequisites**: spec.md (required), design.md (required)

## Global Constraints

- Runtime: Node >= 20
- Dependencies: no new runtime deps
- Testing: Kind code tasks use red-green

## Phase 1: Foundational Tasks

### Task T001: Failing acceptance tests

**Implements:** FR-001, FR-003, FR-004

**Depends on:** none

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Recipe tests for known contracts.

**Files:**
- Create: `tests/shortener.test.js`

**Interfaces:**
- Produces: failing tests for shorten/redirect/invalid URL

- [ ] **Step 1: Write the failing test.** Add `tests/shortener.test.js` covering FR-001/003/004.
- [ ] **Step 2: Confirm fail.** Run `node --test tests/shortener.test.js` — Expected: FAIL
- [ ] **Step 3: Minimal impl.** Stub app until green path exists.
- [ ] **Step 4: Confirm pass.** Expected: PASS
- [ ] **Step 5: Commit.**

### Task T002: In-memory store

**Implements:** FR-001, FR-002

**Depends on:** T001

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Pure store with exact AC.

**Files:**
- Create: `src/store.js`

**Interfaces:**
- Produces: `createStore()` with shorten/resolve/list

- [ ] **Step 1: Write the failing test.** Cover code uniqueness + invalid URL.
- [ ] **Step 2: Confirm fail.** Expected: FAIL
- [ ] **Step 3: Minimal impl.** Implement Map store + base64url codes.
- [ ] **Step 4: Confirm pass.** Expected: PASS
- [ ] **Step 5: Commit.**

### Task T003: HTTP handlers

**Implements:** FR-001, FR-002, FR-003, FR-004, FR-005

**Depends on:** T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multiple routes and status codes.

**Files:**
- Create: `src/app.js`, `src/server.js`

**Interfaces:**
- Consumes: `createStore`
- Produces: HTTP handler for shorten/redirect/list/health

- [ ] **Step 1: Write the failing test.** Integration tests via ephemeral server.
- [ ] **Step 2: Confirm fail.** Expected: FAIL
- [ ] **Step 3: Minimal impl.** Wire routes.
- [ ] **Step 4: Confirm pass.** Expected: PASS
- [ ] **Step 5: Commit.**

### Task T004: Validate + sync

**Implements:** FR-005

**Depends on:** T003

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Run suite and sync-status.

**Files:**
- Modify: `specs/001-url-shortener/status.md`
- Create: `specs/001-url-shortener/validation-report.md`

**Interfaces:**
- Consumes: green test suite
- Produces: validation evidence for Ira ship

- [ ] **Step 1: Run checks.** `node --test tests/shortener.test.js` — Expected: PASS
- [ ] **Step 2: Capture evidence.** Write validation-report.md
- [ ] **Step 3: Sync status.** Ira `sync-status` / lifecycle advance to ship

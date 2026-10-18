<!-- Adapted from SK: templates/tasks-template.md (MIT) and SP: skills/writing-plans/SKILL.md (MIT). See /NOTICE. -->

# Implementation Plan: 001-url-shortener

**Feature Branch**: `[###-feature-name]`

**Input**: Design documents from `spec.md` and `design.md`

**Prerequisites**: spec.md (required), design.md (required)

## Global Constraints

[Project-wide requirements — version floors, dependency limits, naming rules — one line each]

- Runtime: [e.g. Node >= 20]
- Dependencies: [e.g. no new runtime dependencies without approval]
- Naming: [e.g. files kebab-case, exported symbols PascalCase/camelCase per language convention]
- Testing: **Kind: code** tasks require a failing-test step before implementation; other kinds use type-appropriate proof per constitution Principle 1

## Task Format

Each task below follows this shape:

- **Implements**: the functional requirement ID(s) from spec.md this task satisfies
- **Depends on**: task IDs that must land first, or `none`
- **Kind**: `code` (red-green-refactor) | `verify` (run checks, capture evidence) | `provision` (infra/env setup) | `signoff` (human gate) | `doc-sync` (update docs/specs)
- **Complexity**: `mechanical` | `moderate` | `complex` — classify with the quality-first rubric in `superspec-plan` (when between two labels, pick the higher; never label `mechanical` if design choices are still open)
- **Complexity rationale**: one line citing which decision test applied (design decided? blast radius? reasoning depth? bug-fix shape? kind bias?)
- **Machine contracts**: `Implements:` may use `FR-002 (slice)` — bare `FR-###` are extracted for the matrix; set `**Kind:**` or `[Kind: …]` in the heading; code tasks need failing-test + green verify (`Expected: PASS` / `verify pass` OK)
- **Files**: exact paths to create, modify, and test
- **Interfaces**: what the task consumes from other tasks and what it produces for them
- Numbered steps: `code` tasks use five TDD steps (failing test → confirm fail → minimal impl → confirm pass → commit); other kinds use type-appropriate proof steps (see constitution Principle 1)

## Phase 1: Foundational Tasks

### Task T001: Slug Normalizer

**Implements:** FR-001

**Depends on:** none

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Design decided in design.md; single pure function with exact AC — recipe execution (decision tests 1–3).

**Files:**
- Create: `src/slug.ts`
- Test: `test/slug.test.ts`

**Interfaces:**
- Consumes: a raw title string from the caller
- Produces: `normalizeSlug(title: string): string`, a lowercase hyphenated slug with no leading/trailing hyphens, exported for use by the routing layer (Task T002)

- [ ] **Step 1: Write the failing test.** Add `test/slug.test.ts`:

  ```ts
  import { normalizeSlug } from "../src/slug";

  test("normalizeSlug lowercases and hyphenates", () => {
    expect(normalizeSlug("  Hello, World!  ")).toBe("hello-world");
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.** Run `npx jest test/slug.test.ts`. Expected failure, since `src/slug.ts` does not exist yet:

  ```
  Cannot find module '../src/slug' from 'test/slug.test.ts'
  ```

- [ ] **Step 3: Write the minimal implementation.** Create `src/slug.ts`:

  ```ts
  export function normalizeSlug(title: string): string {
    return title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  ```

- [ ] **Step 4: Run the test again to verify it passes.** Run `npx jest test/slug.test.ts`. Expected output:

  ```
  PASS test/slug.test.ts
    ✓ normalizeSlug lowercases and hyphenates
  ```

  Make sure it passes before moving to the next task — do not proceed on a red test.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/slug.ts test/slug.test.ts
  git commit -m "feat: add normalizeSlug for FR-001"
  ```

## Phase 2: [Next Phase Name]

[Add further `### Task Txxx: [Name]` blocks here, following the exact shape modeled above: Implements/Depends on/Kind/Complexity/Complexity rationale/Files/Interfaces, then numbered steps matched to Kind — `code` tasks use the five TDD steps shown above; `verify`/`provision`/`signoff`/`doc-sync` tasks use type-appropriate proof per constitution Principle 1. Every task in this plan must be filled out this completely before implementation begins.]

## No Empty Placeholders

This plan must ship with every task fully specified — no stand-in text left for "later," no step that just says a future engineer will figure it out, no requirement description that trails off before naming the real files and interfaces involved.

Concretely, before this plan is considered ready:

- Every `### Task` block names real file paths under **Files**, not bracketed descriptions.
- Every task shows an actual failing test with real assertions, not a comment describing what the test should someday check.
- Every task shows the real command used to confirm the test fails, and the real output that command produced.
- Every task shows real implementation code, not a comment claiming that error handling belongs there while leaving it unwritten, and not a comment claiming that some other task's code should simply be copied.
- Every task shows the real command used to confirm the test passes on the second run, and the real output that command produced.
- Every task ends with a real `git commit` command and a message describing what actually changed.

If a task cannot yet be written this completely, it does not belong in this plan yet — describe it as an open question in `spec.md` instead and return to it once the missing details are known.

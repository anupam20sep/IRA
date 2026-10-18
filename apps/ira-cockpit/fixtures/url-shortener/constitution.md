# SuperSpec Constitution

**Mode**: full

## Core Principles

### Principle 1: Test-First for code tasks (NON-NEGOTIABLE)

Every task with **Kind: code** in a plan.md must follow the red-green-refactor cycle: a failing test is written first and verified to fail, then a minimal implementation is written and verified to pass, then the implementation is refactored if needed. Tests are never optional, never deferred, never added retroactively for code tasks. Tasks with **Kind: verify**, **provision**, **signoff**, or **doc-sync** do not use red-green-refactor; they must instead produce type-appropriate proof (command output, provisioning receipts, signed gate records, or updated doc diffs) as defined in the task plan. This principle reverses the common industry default of treating tests as optional or secondary; in SuperSpec projects, verifiable evidence is mandatory for every task kind.

### Principle 2: Traceability Spine (NON-NEGOTIABLE)

Every functional requirement (FR-###) must map to at least one task in a task list and at least one passing test in the test suite. The coverage matrix must remain complete at all times; no FR may exist without a covering task, and no task may complete without a covering test passing. This traceability is what makes "spec-driven and TDD-driven" verifiable rather than aspirational—it is the binding contract between specification and implementation.

### Principle 3: Simplicity (YAGNI)

[Customize this principle: e.g., "Avoid premature abstraction. Build only what is explicitly required by specification. Defer generalization until the pattern is proven across multiple use cases."]

### Principle 4: Observability

[Customize this principle: e.g., "Structured logging and error visibility are mandatory. Every failure point must surface actionable context to operators and developers."]

### Principle 5: Versioning & Breaking Changes

[Customize this principle: e.g., "Use semantic versioning (MAJOR.MINOR.PATCH). Breaking changes require major version bumps and documented migration paths."]

## Governance

Principles 1 (Test-First for code tasks) and 2 (Traceability Spine) are fixed, non-negotiable foundations of SuperSpec and cannot be amended away by a project adopting SuperSpec. They define what makes a project "SuperSpec-compliant." Principles 3, 4, and 5 are editable and customizable per project; each adopting team must write their own concrete guidance for simplicity, observability, and versioning standards.

**Version**: {{VERSION}} | **Ratified**: {{DATE}} | **Last Amended**: {{DATE}}

<!-- Structure adapted from SK: templates/constitution-template.md (MIT). Principles 1 (Test-First) and 2 (Traceability Spine) are fixed, non-negotiable additions unique to SuperSpec — see docs/SOURCES.md. See /NOTICE. -->

# Feature Specification: URL Shortener

**Feature Branch**: `001-url-shortener`

**Created**: 2026-10-18

**Status**: Active

**Type**: product

**Input**: Build a minimal URL shortener with create-link and redirect, driven by Ira + Cursor.

## Required Reading

| Path | Reason |
|------|--------|
| `constitution.md` | Test-first and traceability |
| `AGENTS.md` | Cursor team roles |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shorten a URL (Priority: P1)

Operator pastes a long URL and receives a short code they can share.

**Why this priority**: Core value of the product.

**Independent Test**: POST a URL, receive a code, GET the code redirects to the original.

**Acceptance Scenarios**:

1. **Given** a valid https URL, **When** the operator shortens it, **Then** a non-empty short code is returned
2. **Given** a short code from create, **When** a client opens `/r/<code>`, **Then** they are redirected to the original URL
3. **Given** an unknown code, **When** a client opens `/r/<code>`, **Then** the API returns 404

### User Story 2 - List recent links (Priority: P2)

Operator can see the most recent shortened links for debugging.

**Why this priority**: Operability without a database UI.

**Independent Test**: After creating links, GET `/api/links` returns them newest-first.

**Acceptance Scenarios**:

1. **Given** at least one shortened URL, **When** listing links, **Then** each item has `code` and `url`

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a URL via POST `/api/shorten` with JSON `{ "url": "..." }`
- **FR-002**: System MUST return `{ "code": "...", "url": "..." }` for successful shorten
- **FR-003**: System MUST redirect GET `/r/:code` to the stored URL with HTTP 302
- **FR-004**: System MUST reject non-http(s) URLs with HTTP 400
- **FR-005**: System MUST expose GET `/api/links` returning recent links

### Key Entities

- **Link**: `{ code, url, createdAt }`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Unit tests cover shorten + redirect + invalid URL (pass in CI)
- **SC-002**: A link created in-process is immediately redirectable
- **SC-003**: Ira snapshot stage for this feature reaches `ship` after validate

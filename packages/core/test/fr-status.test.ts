import { describe, it, expect } from "vitest";
import { buildStatusSnapshot, renderStatusMarkdown } from "../src/fr-status.js";
import { initState, recordResult, markInProgress } from "../src/forge-loop.js";
import type { Task } from "../src/types.js";

const specText = `
**FR-001**: Shorten URLs
**FR-002**: Resolve codes
`;

const tasks: Task[] = [
  { id: "T001", title: "validator", frRefs: ["FR-001"], dependsOn: [], complexity: "mechanical", kind: "code" },
  { id: "T002", title: "store", frRefs: ["FR-002"], dependsOn: ["T001"], complexity: "mechanical", kind: "code" },
];

const planText = `
### Task T001: validator
**Implements:** FR-001
**Depends on:** none

### Task T002: store
**Implements:** FR-002
**Depends on:** T001
`;

describe("fr status", () => {
  it("derives FR done when all covering tasks are done", () => {
    const state = initState(tasks);
    recordResult(state, "T001", true, { maxReviewFailures: 3 });
    const snap = buildStatusSnapshot(specText, planText, state, "url-shortener");
    expect(snap.frRows.find((r) => r.fr === "FR-001")?.status).toBe("done");
    expect(snap.frRows.find((r) => r.fr === "FR-002")?.status).toBe("pending");
  });

  it("marks FR in progress when a covering task is in progress", () => {
    const state = initState(tasks);
    markInProgress(state, "T001");
    const snap = buildStatusSnapshot(specText, planText, state, "url-shortener");
    expect(snap.frRows.find((r) => r.fr === "FR-001")?.status).toBe("in_progress");
  });

  it("marks FR done when remaining covering tasks are blocked (deferred)", () => {
    const multi: Task[] = [
      { id: "T001", title: "slice-a", frRefs: ["FR-001"], dependsOn: [], complexity: "mechanical", kind: "code" },
      { id: "T002", title: "deferred", frRefs: ["FR-001"], dependsOn: ["T001"], complexity: "mechanical", kind: "code" },
    ];
    const multiPlan = `
### Task T001: slice-a
**Implements:** FR-001
**Depends on:** none

### Task T002: deferred
**Implements:** FR-001
**Depends on:** T001
`;
    const state = initState(multi);
    recordResult(state, "T001", true, { maxReviewFailures: 3 });
    state.tasks.T002 = { status: "blocked", reviewFailures: 0 };
    const snap = buildStatusSnapshot(specText, multiPlan, state, "slice-a");
    expect(snap.frRows.find((r) => r.fr === "FR-001")?.status).toBe("done");
    expect(snap.taskRows.find((r) => r.id === "T002")?.status).toBe("blocked");
  });

  it("renders status markdown with FR table", () => {
    const state = initState(tasks);
    const md = renderStatusMarkdown(buildStatusSnapshot(specText, planText, state, "demo"));
    expect(md).toContain("# Status: demo");
    expect(md).toContain("| FR-001 |");
    expect(md).toContain("Functional requirements");
  });
});

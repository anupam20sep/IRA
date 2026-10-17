import { afterEach, describe, expect, it } from "vitest";
import {
  registerCommandPlaneHooks,
  runRecordResultHooksForTest,
  type DistillContext,
} from "../../src/command-plane/hooks.js";

const ctx: DistillContext = {
  featureId: "004-ira-token-context",
  taskId: "T017",
  passed: true,
  reviewFailures: 0,
};

describe("record-result hook order", () => {
  afterEach(() => {
    registerCommandPlaneHooks({ learning: {}, token: {}, hire: {}, engine: {} });
  });

  it("runs distill before token onRecordResult", async () => {
    const order: string[] = [];
    registerCommandPlaneHooks({
      learning: {
        distill: async () => {
          await Promise.resolve();
          order.push("distill");
        },
      },
      token: {
        onRecordResult: async () => {
          order.push("compact");
        },
      },
    });
    await runRecordResultHooksForTest(ctx);
    expect(order).toEqual(["distill", "compact"]);
  });

  it("still runs compact when distill throws", async () => {
    const order: string[] = [];
    registerCommandPlaneHooks({
      learning: {
        distill: async () => {
          order.push("distill");
          throw new Error("distill failed");
        },
      },
      token: {
        onRecordResult: async () => {
          order.push("compact");
        },
      },
    });
    await expect(runRecordResultHooksForTest(ctx)).resolves.toBeUndefined();
    expect(order).toEqual(["distill", "compact"]);
  });
});

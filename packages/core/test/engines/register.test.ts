import { describe, it, expect, vi } from "vitest";
import { registerEngineHooks } from "../../src/engines/register.js";

describe("registerEngineHooks", () => {
  it("calls registerCommandPlaneHooks with engine key", () => {
    const spy = vi.fn();
    registerEngineHooks("/tmp/hive", { registerCommandPlaneHooks: spy } as never);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ engine: expect.any(Object) }));
  });
});

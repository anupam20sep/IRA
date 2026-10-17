import { describe, expect, it, vi } from "vitest";
import { normalizeCapabilityTags, tagsIntersect } from "../../src/hire/capabilities.js";
import { matchCapabilities } from "../../src/hire/hooks-impl.js";

describe("normalizeCapabilityTags", () => {
  it("lowercases, trims, dedupes, and validates slug shape", () => {
    expect(normalizeCapabilityTags([" iOS ", "ios", "QA"])).toEqual(["ios", "qa"]);
  });

  it("drops invalid tokens and invokes optional onInvalidTag", () => {
    const onInvalidTag = vi.fn();
    expect(
      normalizeCapabilityTags(["valid.tag", "Bad Space", ""], { onInvalidTag }),
    ).toEqual(["valid.tag"]);
    expect(onInvalidTag).toHaveBeenCalledTimes(2);
  });
});

describe("tagsIntersect", () => {
  it("returns normalized tags present on both sides", () => {
    expect(tagsIntersect([" iOS ", "qa"], ["IOS", "security"])).toEqual(["ios"]);
  });
});

type MatchAgent = {
  id: string;
  status: "idle" | "busy" | "blocked" | "offline";
  origin: "hire" | "placeholder" | "manual";
  capabilityTags: string[];
  hireScore?: { score: number };
};

function agent(partial: MatchAgent): MatchAgent {
  return partial;
}

describe("matchCapabilities", () => {
  it("prefers idle hire with matching ios tag", () => {
    const matched = matchCapabilities(
      { capabilityTags: ["ios"] },
      [
        { id: "ios-dev", status: "idle", origin: "hire", capabilityTags: ["ios"], hireScore: { score: 80 } },
        { id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: [] },
      ] as never,
    );
    expect(matched?.id).toBe("ios-dev");
  });

  it("ranks by intersecting tag count, then hire score, then id", () => {
    const roster = [
      agent({
        id: "broad-low",
        status: "idle",
        origin: "hire",
        capabilityTags: ["ios", "qa"],
        hireScore: { score: 10 },
      }),
      agent({
        id: "narrow-high",
        status: "idle",
        origin: "hire",
        capabilityTags: ["ios"],
        hireScore: { score: 99 },
      }),
      agent({
        id: "b-peer",
        status: "idle",
        origin: "hire",
        capabilityTags: ["ios"],
        hireScore: { score: 50 },
      }),
      agent({
        id: "a-peer",
        status: "idle",
        origin: "hire",
        capabilityTags: ["ios"],
        hireScore: { score: 50 },
      }),
    ];

    expect(matchCapabilities({ capabilityTags: ["ios", "qa"] }, roster)?.id).toBe("broad-low");
    expect(
      matchCapabilities(
        { capabilityTags: ["ios"] },
        roster.filter((row) => row.id !== "broad-low"),
      )?.id,
    ).toBe("narrow-high");
    expect(
      matchCapabilities(
        { capabilityTags: ["ios"] },
        roster.filter((row) => row.id === "a-peer" || row.id === "b-peer"),
      )?.id,
    ).toBe("a-peer");
  });

  it("treats a missing hire score as lower than any recorded score", () => {
    const matched = matchCapabilities({ capabilityTags: ["qa"] }, [
      agent({ id: "unscored", status: "idle", origin: "hire", capabilityTags: ["qa"] }),
      agent({
        id: "scored",
        status: "idle",
        origin: "hire",
        capabilityTags: ["qa"],
        hireScore: { score: 1 },
      }),
    ]);
    expect(matched?.id).toBe("scored");
  });

  it("normalizes tags and ignores non-idle agents", () => {
    const matched = matchCapabilities({ capabilityTags: [" iOS "] }, [
      agent({ id: "busy-ios", status: "busy", origin: "hire", capabilityTags: ["ios", "qa"] }),
      agent({ id: "idle-ios", status: "idle", origin: "hire", capabilityTags: ["IOS"] }),
    ]);
    expect(matched?.id).toBe("idle-ios");
  });

  it("returns the first idle hire when the task has no tags", () => {
    const matched = matchCapabilities({ capabilityTags: [] }, [
      agent({ id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: [] }),
      agent({ id: "first-hire", status: "idle", origin: "hire", capabilityTags: ["ios"], hireScore: { score: 1 } }),
      agent({ id: "later-hire", status: "idle", origin: "hire", capabilityTags: ["qa"], hireScore: { score: 99 } }),
    ]);
    expect(matched?.id).toBe("first-hire");
  });

  it("returns the idle placeholder when the task has no tags and no idle hire", () => {
    const matched = matchCapabilities({ capabilityTags: ["", " "] }, [
      agent({ id: "busy-hire", status: "busy", origin: "hire", capabilityTags: ["ios"] }),
      agent({ id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: [] }),
    ]);
    expect(matched?.id).toBe("agent-host");
  });

  it("returns null when required tags match nobody, including a lone placeholder", () => {
    expect(
      matchCapabilities({ capabilityTags: ["ios"] }, [
        agent({ id: "qa-dev", status: "idle", origin: "hire", capabilityTags: ["qa"] }),
        agent({ id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: ["ios"] }),
      ]),
    ).toBeNull();
    expect(
      matchCapabilities({ capabilityTags: ["ios"] }, [
        agent({ id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: [] }),
      ]),
    ).toBeNull();
  });

  it("can match an idle manual agent and still excludes the placeholder", () => {
    const matched = matchCapabilities({ capabilityTags: ["security"] }, [
      agent({ id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: ["security"] }),
      agent({ id: "manual-sec", status: "idle", origin: "manual", capabilityTags: ["security"] }),
    ]);
    expect(matched?.id).toBe("manual-sec");
  });
});

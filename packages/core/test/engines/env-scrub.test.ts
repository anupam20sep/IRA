import { describe, it, expect } from "vitest";
import { buildSupervisorEnv } from "../../src/engines/env-scrub.js";

const BASE = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "SHELL",
  "SUPERSPEC_ROOT",
  "SUPERSPEC_ENGINE_SESSION",
  "SUPERSPEC_HIVE_ROOT",
] as const;

describe("buildSupervisorEnv", () => {
  it("drops ANTHROPIC_API_KEY on non-byok rung and never spreads process.env", () => {
    const processEnv = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-secret", HOME: "/home/op" };
    const env = buildSupervisorEnv({
      rung: "local",
      processEnv,
      byokAllowlist: ["OPENAI_API_KEY"],
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/op");
    expect(env).not.toBe(processEnv);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("copies only the base allowlist and omits other non-secret names", () => {
    const processEnv: Record<string, string> = { NODE_ENV: "test", FOO: "bar" };
    for (const name of BASE) processEnv[name] = `v-${name}`;
    const env = buildSupervisorEnv({
      rung: "subscription",
      processEnv,
      byokAllowlist: ["OPENAI_API_KEY"],
    });
    expect(env).toEqual(Object.fromEntries(BASE.map((name) => [name, `v-${name}`])));
    expect(env).not.toHaveProperty("NODE_ENV");
    expect(env).not.toHaveProperty("FOO");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("drops credential-like names that are not on the byok allowlist", () => {
    const env = buildSupervisorEnv({
      rung: "local",
      processEnv: {
        PATH: "/usr/bin",
        GITHUB_TOKEN: "gho_secret",
        MY_SECRET: "s",
        DB_PASSWORD: "p",
        AWS_CREDENTIAL: "c",
        ANTHROPIC_API_KEY: "sk-secret",
      },
      byokAllowlist: ["OPENAI_API_KEY"],
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("copies byok allowlist names only when the rung is byok", () => {
    const processEnv = {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      CUSTOM_BASE_URL: "https://api.example",
    };
    const byok = buildSupervisorEnv({
      rung: "byok",
      processEnv,
      byokAllowlist: ["OPENAI_API_KEY", "CUSTOM_BASE_URL"],
    });
    expect(byok.OPENAI_API_KEY).toBe("sk-openai");
    expect(byok.CUSTOM_BASE_URL).toBe("https://api.example");
    expect(byok.ANTHROPIC_API_KEY).toBeUndefined();
    expect(byok.PATH).toBe("/usr/bin");

    const local = buildSupervisorEnv({
      rung: "local",
      processEnv,
      byokAllowlist: ["OPENAI_API_KEY", "CUSTOM_BASE_URL"],
    });
    expect(local).toEqual({ PATH: "/usr/bin" });
  });

  it("skips allowlisted names that are absent and does not mutate the source", () => {
    const processEnv = { PATH: "/usr/bin" };
    const snapshot = { ...processEnv };
    const env = buildSupervisorEnv({
      rung: "byok",
      processEnv,
      byokAllowlist: ["OPENAI_API_KEY"],
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
    expect(processEnv).toEqual(snapshot);
  });
});

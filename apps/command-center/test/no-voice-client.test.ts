import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const clientRoot = path.join(appRoot, "src", "client");
const tokensPath = path.join(clientRoot, "tokens.css");

/** Ira Glass variables from specs/002-ira-command-center/design.md */
const REQUIRED_IRA_TOKENS: Record<string, string> = {
  "--ira-field": "#0e1114",
  "--ira-field-raised": "#161b20",
  "--ira-glass": "rgba(168, 198, 210, 0.07)",
  "--ira-glass-border": "rgba(176, 208, 220, 0.35)",
  "--ira-glass-highlight": "rgba(214, 232, 240, 0.12)",
  "--ira-text": "#d7dee6",
  "--ira-text-dim": "#8e9aa6",
  "--ira-telemetry": "#d5e0d2",
  "--ira-lamp-cool": "#6ec8c0",
  "--ira-lamp-amber": "#d59a45",
  "--ira-lamp-red": "#c45448",
  "--ira-presence": "#b7d4e4",
  "--ira-reveal-ms": "160ms",
  "--ira-lamp-period": "1600ms",
};

const FORBIDDEN_CLIENT_STRINGS = [
  "SpeechRecognition",
  "speechSynthesis",
  "wake-word",
] as const;

function normalizeCssValue(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function readClientSourceFiles(dir: string): { relativePath: string; content: string }[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: { relativePath: string; content: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relativePath = path.relative(clientRoot, full);
    if (entry.isDirectory()) {
      out.push(...readClientSourceFiles(full));
    } else if (/\.(css|ts|tsx|js|jsx|html|svg)$/i.test(entry.name)) {
      out.push({
        relativePath,
        content: fs.readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

describe("Ira Glass tokens (FR-016)", () => {
  it("defines every --ira-* variable from design in tokens.css", () => {
    expect(fs.existsSync(tokensPath), "tokens.css must exist").toBe(true);
    const css = fs.readFileSync(tokensPath, "utf8");

    for (const [name, expectedValue] of Object.entries(REQUIRED_IRA_TOKENS)) {
      const pattern = new RegExp(
        `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`,
      );
      const match = css.match(pattern);
      expect(match, `${name} must be declared in tokens.css`).not.toBeNull();
      expect(normalizeCssValue(match![1])).toBe(
        normalizeCssValue(expectedValue),
      );
    }
  });
});

describe("voice-free client guard (FR-021)", () => {
  it("does not reference speech APIs or wake-word under src/client", () => {
    const files = readClientSourceFiles(clientRoot);
    expect(files.length, "src/client should include client sources").toBeGreaterThan(0);

    for (const { relativePath, content } of files) {
      for (const forbidden of FORBIDDEN_CLIENT_STRINGS) {
        expect(
          content.includes(forbidden),
          `${relativePath} must not contain "${forbidden}"`,
        ).toBe(false);
      }
    }
  });
});

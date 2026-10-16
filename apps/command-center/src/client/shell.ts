import type { BoardSnapshot } from "../shared/snapshot-types.js";

/** Hash-routed board views (brief plus seven GOD panels). */
export type ShellView =
  | "brief"
  | "tasks"
  | "fleet"
  | "activity"
  | "memory"
  | "spend"
  | "ask-me"
  | "triggers";

const NAV_ITEMS: { view: ShellView; label: string }[] = [
  { view: "brief", label: "Brief" },
  { view: "tasks", label: "Tasks" },
  { view: "fleet", label: "Fleet" },
  { view: "activity", label: "Activity" },
  { view: "memory", label: "Memory" },
  { view: "spend", label: "Spend" },
  { view: "ask-me", label: "Ask-Me" },
  { view: "triggers", label: "Triggers" },
];

const TOKENS_STYLESHEET = new URL("./tokens.css", import.meta.url).href;

const SHELL_STYLES = `
.ira-shell {
  min-height: 100%;
  background: var(--ira-field);
  color: var(--ira-text);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.ira-shell__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.5rem;
  padding: 0.75rem 1.25rem;
  background: var(--ira-field-raised);
  border-bottom: 1px solid var(--ira-glass-border);
}
.ira-shell__identity {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.ira-shell__callsign {
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.ira-shell__expansion {
  font-size: 0.75rem;
  color: var(--ira-text-dim);
}
.ira-shell__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-left: auto;
}
.ira-shell__nav a {
  color: var(--ira-text-dim);
  text-decoration: none;
  font-size: 0.875rem;
}
.ira-shell__nav a:hover {
  color: var(--ira-text);
}
.ira-arc {
  flex-shrink: 0;
}
.ira-lamp-amber {
  color: var(--ira-lamp-amber);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  animation: ira-lamp-pulse var(--ira-lamp-period) ease-in-out infinite;
}
@keyframes ira-lamp-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ira-lamp-amber { animation: none; opacity: 1; }
}
.ira-engine-banner {
  padding: 0.5rem 1.25rem;
  background: var(--ira-glass);
  border-bottom: 1px solid var(--ira-glass-border);
  color: var(--ira-text-dim);
  font-size: 0.875rem;
}
.ira-shell__main {
  min-height: 12rem;
}
`;

export function navHref(view: ShellView): string {
  return `#/${view}`;
}

function totalOpenAskMe(snapshot: BoardSnapshot): number {
  return snapshot.features.reduce((sum, feature) => sum + feature.openAskMe, 0);
}

function shouldShowEngineBanner(snapshot: BoardSnapshot): boolean {
  const { hiveReady, engineRungReady } = snapshot.doctor;
  return hiveReady && !engineRungReady;
}

function ensureTokensStylesheet(): void {
  if (document.querySelector("[data-ira-tokens]")) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = TOKENS_STYLESHEET;
  link.setAttribute("data-ira-tokens", "");
  document.head.appendChild(link);
}

function ensureShellStyles(): void {
  if (document.querySelector("style[data-ira-shell]")) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-ira-shell", "");
  style.textContent = SHELL_STYLES;
  document.head.appendChild(style);
}

function createPresenceArc(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ira-arc");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 28 28");
  svg.setAttribute("data-ira-arc", "");
  svg.setAttribute("aria-hidden", "true");

  const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  arc.setAttribute("cx", "14");
  arc.setAttribute("cy", "14");
  arc.setAttribute("r", "10");
  arc.setAttribute("fill", "none");
  arc.setAttribute("stroke", "var(--ira-presence)");
  arc.setAttribute("stroke-width", "2");
  arc.setAttribute("stroke-linecap", "round");
  arc.setAttribute(
    "stroke-dasharray",
    `${2 * Math.PI * 10 * 0.75} ${2 * Math.PI * 10 * 0.25}`,
  );
  arc.setAttribute("transform", "rotate(-90 14 14)");
  svg.appendChild(arc);
  return svg;
}

/** Renders Ira board chrome: header, navigation, lamps, and engine banner. */
export function renderShell(root: HTMLElement, snapshot: BoardSnapshot): void {
  ensureTokensStylesheet();
  ensureShellStyles();

  root.replaceChildren();
  root.className = "ira-shell";

  const header = document.createElement("header");
  header.className = "ira-shell__header";
  header.appendChild(createPresenceArc());

  const identity = document.createElement("div");
  identity.className = "ira-shell__identity";

  const callsign = document.createElement("span");
  callsign.className = "ira-shell__callsign";
  callsign.textContent = snapshot.persona.callsign;

  const expansion = document.createElement("span");
  expansion.className = "ira-shell__expansion";
  expansion.textContent = snapshot.persona.expansion;

  identity.append(callsign, expansion);
  header.appendChild(identity);

  const openAskMe = totalOpenAskMe(snapshot);
  if (openAskMe > 0) {
    const lamp = document.createElement("span");
    lamp.className = "ira-lamp-amber";
    lamp.setAttribute("data-ask-me-lamp", "");
    lamp.textContent = `Ask-Me ${openAskMe}`;
    header.appendChild(lamp);
  }

  const nav = document.createElement("nav");
  nav.className = "ira-shell__nav";
  for (const { view, label } of NAV_ITEMS) {
    const link = document.createElement("a");
    link.href = navHref(view);
    link.textContent = label;
    nav.appendChild(link);
  }
  header.appendChild(nav);
  root.appendChild(header);

  if (shouldShowEngineBanner(snapshot)) {
    const banner = document.createElement("div");
    banner.className = "ira-engine-banner";
    banner.setAttribute("data-engine-banner", "");
    banner.textContent =
      "No healthy engine rung is available. Coordination data remains visible.";
    root.appendChild(banner);
  }

  const main = document.createElement("main");
  main.className = "ira-shell__main";
  main.setAttribute("data-view-host", "");
  root.appendChild(main);
}

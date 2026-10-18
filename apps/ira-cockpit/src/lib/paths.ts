/** Resolve repository root for Tauri FS commands. */
export function resolveRepoRoot(configured: string): string {
  if (configured.startsWith("/")) return configured;
  // Monorepo default when running from apps/ira-cockpit
  return "/Users/macky/IRA/superspec";
}

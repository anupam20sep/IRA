import { useState } from "react";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { onboardProjectApi, removeProjectApi } from "@/lib/ira-api";
import { useCockpit } from "@/store/cockpit";

export function ProjectsPanel() {
  const refreshLive = useCockpit((s) => s.refreshLive);
  const openProject = useCockpit((s) => s.openProject);
  const liveProjects = useCockpit((s) => s.projects);
  const [draftPath, setDraftPath] = useState("");
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onboard() {
    const path = draftPath.trim();
    if (!path) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await onboardProjectApi({
        path,
        name: draftName.trim() || undefined,
      });
      setDraftPath("");
      setDraftName("");
      setStatus(`Onboarded ${res.project.name}`);
      await refreshLive();
      openProject(res.project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await removeProjectApi(id);
      setStatus(`Removed ${id}`);
      await refreshLive();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassPanel eyebrow="Onboard" title="Add a local project">
      <p className="mb-3 text-xs text-slate-500">
        Paste an absolute path to a repo on this machine. Ira persists it to{" "}
        <span className="font-mono text-[10px]">ira.config.json</span> and loads its specs
        under that project.
      </p>

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-ira-cyan/20 bg-black/40 p-3">
        <Input
          placeholder="/Users/you/code/my-repo"
          value={draftPath}
          onChange={(e) => setDraftPath(e.target.value)}
          className="font-mono text-xs"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onboard();
          }}
        />
        <Input
          placeholder="Display name (optional)"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          disabled={busy}
        />
        <Button
          onClick={() => void onboard()}
          disabled={busy || !draftPath.trim()}
        >
          {busy ? "Working…" : "Onboard project"}
        </Button>
      </div>

      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
        Onboarded projects
      </p>
      <ul className="mb-2 flex flex-col gap-2">
        {liveProjects.map((p) => (
          <li
            key={p.id}
            className="flex items-start justify-between gap-2 rounded-xl border border-white/5 bg-black/30 px-3 py-2"
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => openProject(p.id)}
            >
              <p className="text-sm text-slate-100">{p.name}</p>
              <p className="truncate font-mono text-[10px] text-ira-cyan/70">{p.path}</p>
              <p className="font-mono text-[10px] text-slate-600">
                {p.specs.length} specs · id {p.id}
              </p>
            </button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void remove(p.id)}
            >
              Remove
            </Button>
          </li>
        ))}
        {liveProjects.length === 0 ? (
          <p className="text-xs text-slate-500">No projects yet — onboard a path above.</p>
        ) : null}
      </ul>

      {status ? <p className="font-mono text-[11px] text-ira-cyan">{status}</p> : null}
      {error ? <p className="text-xs text-ira-rose">{error}</p> : null}
    </GlassPanel>
  );
}

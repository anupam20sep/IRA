import { Lightbulb, Rocket } from "lucide-react";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useCockpit } from "@/store/cockpit";

export function BrainstormView() {
  const draft = useCockpit((s) => s.brainstormDraft);
  const setDraft = useCockpit((s) => s.setBrainstormDraft);
  const create = useCockpit((s) => s.createBrainstorm);
  const sessions = useCockpit((s) => s.brainstorms);
  const launch = useCockpit((s) => s.launchPlanMode);
  const projects = useCockpit((s) => s.projects);
  const openProject = useCockpit((s) => s.openProject);

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-[1fr_1fr]">
      <GlassPanel
        eyebrow="Ira brainstorm"
        title="New ideas or existing project"
        action={<Lightbulb className="size-4 text-ira-purple" />}
      >
        <p className="mb-3 text-xs text-slate-500">
          Capture an idea. Ira will open AI <span className="text-ira-cyan">plan mode</span>{" "}
          (Cursor / Claude / Codex) — stubbed in this demo.
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Nightly support digest, or deepen tenant isolation for Education Platform…"
          className="min-h-32 border-ira-purple/20 bg-black/40 text-sm"
        />
        <div className="mt-3 flex gap-2">
          <Button
            className="bg-ira-purple text-white hover:bg-ira-purple/80"
            onClick={create}
            disabled={!draft.trim()}
          >
            Save brainstorm
          </Button>
        </div>
      </GlassPanel>

      <GlassPanel eyebrow="Sessions" title="Plan mode queue">
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const proj = projects.find((p) => p.id === s.projectId);
            return (
              <li
                key={s.id}
                className="rounded-xl border border-white/5 bg-black/30 p-3"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm text-slate-100">{s.title}</p>
                  <Badge
                    className={
                      s.status === "planning"
                        ? "bg-ira-cyan/20 text-ira-cyan"
                        : s.status === "ready"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-slate-500/20 text-slate-400"
                    }
                  >
                    {s.status}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    → {s.planModeTarget} plan
                  </Badge>
                </div>
                <p className="mb-2 text-xs text-slate-500">{s.notes}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => launch(s.id)}>
                    <Rocket data-icon="inline-start" />
                    Launch plan mode
                  </Button>
                  {proj ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-ira-cyan"
                      onClick={() => openProject(proj.id)}
                    >
                      Open {proj.name}
                    </Button>
                  ) : (
                    <span className="self-center font-mono text-[10px] text-slate-600">
                      new project idea
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </GlassPanel>
    </div>
  );
}

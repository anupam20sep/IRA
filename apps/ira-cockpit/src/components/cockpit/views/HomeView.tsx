import { NeuralPulse } from "@/components/cockpit/NeuralPulse";
import { OmniPrompt } from "@/components/cockpit/OmniPrompt";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { AskMeRail } from "@/components/cockpit/AskMeRail";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useCockpit } from "@/store/cockpit";

export function HomeView() {
  const projects = useCockpit((s) => s.filteredProjects());
  const filter = useCockpit((s) => s.projectFilter);
  const setFilter = useCockpit((s) => s.setProjectFilter);
  const openProject = useCockpit((s) => s.openProject);
  const interventions = useCockpit((s) => s.interventions);
  const telemetry = useCockpit((s) => s.telemetry);
  const away = useCockpit((s) => s.away);

  const totalDone = projects.reduce((n, p) => n + p.done, 0);
  const totalBlocked = projects.reduce((n, p) => n + p.blocked, 0);
  const totalPending = projects.reduce((n, p) => n + p.pending, 0);
  const spend = projects.reduce((n, p) => n + p.spendUsd, 0);
  const live = projects.reduce(
    (n, p) => n + p.agents.filter((a) => a.status === "busy").length,
    0,
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] gap-3">
      <div className="flex min-h-0 flex-col gap-3 overflow-auto">
        <div className="flex flex-col items-center gap-4 py-2">
          <NeuralPulse />
          <OmniPrompt />
        </div>

        <GlassPanel eyebrow="Morning brief" title="Company pulse">
          <p className="text-sm text-slate-300">
            <span className="text-ira-cyan mono-tick">{totalDone}</span> done ·{" "}
            <span className="text-ira-amber mono-tick">{totalBlocked}</span> blocked ·{" "}
            <span className="mono-tick text-slate-200">{totalPending}</span> pending ·{" "}
            <span className="text-ira-purple mono-tick">{live}</span> agents live · spend{" "}
            <span className="mono-tick text-ira-cyan">${spend.toFixed(2)}</span>
            {away ? " · away engaged" : " · operator present"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Needs you: {interventions.length || "nothing"}. Hive{" "}
            {telemetry.hiveReady ? "ready" : "degraded"} · engines{" "}
            {telemetry.engineRungReady ? "ready" : "degraded"}.
          </p>
        </GlassPanel>

        <GlassPanel
          eyebrow="Projects"
          title="Filter & open"
          action={
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter projects…"
              className="h-8 w-48 border-ira-cyan/20 bg-black/40 font-mono text-xs"
            />
          }
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openProject(p.id)}
                className="rounded-xl border border-white/5 bg-black/35 p-3 text-left transition hover:border-ira-cyan/30 hover:shadow-[inset_0_0_16px_rgba(34,211,238,0.1)]"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-100">{p.name}</p>
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] capitalize text-slate-400"
                  >
                    {p.status}
                  </Badge>
                </div>
                <p className="mb-2 truncate text-xs text-slate-500">{p.tagline}</p>
                <Progress value={p.progress} className="mb-2 h-1.5 bg-slate-900" />
                <div className="flex justify-between font-mono text-[10px] text-slate-500">
                  <span>
                    {p.done}d / {p.blocked}b / {p.pending}p
                  </span>
                  <span className="text-ira-cyan">
                    ${p.spendUsd.toFixed(2)} / ${p.budgetUsd}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-slate-600">
                  {p.specs.length} specs · {p.path}
                </p>
              </button>
            ))}
            {projects.length === 0 ? (
              <p className="text-xs text-slate-500">No projects match filter.</p>
            ) : null}
          </div>
        </GlassPanel>
      </div>

      <AskMeRail />
    </div>
  );
}

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCockpit } from "@/store/cockpit";
import { cn } from "@/lib/utils";

export function AskMeRail({ compact = false }: { compact?: boolean }) {
  const interventions = useCockpit((s) => s.interventions);
  const approve = useCockpit((s) => s.approveIntervention);
  const openProject = useCockpit((s) => s.openProject);
  const projects = useCockpit((s) => s.projects);

  if (compact) {
    return (
      <Badge
        className={cn(
          "font-mono text-[10px]",
          interventions.length
            ? "border-ira-rose/40 bg-ira-rose/15 text-ira-rose"
            : "border-emerald-400/40 bg-emerald-400/10 text-emerald-400",
        )}
      >
        {interventions.length ? `${interventions.length} ask-me` : "clear"}
      </Badge>
    );
  }

  return (
    <div className="glass-panel flex h-full flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-3.5 text-ira-amber" />
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Ask-Me
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-2 pr-2">
          {interventions.map((item) => {
            const proj = projects.find((p) => p.id === item.projectId);
            return (
              <li key={item.id} className="rounded-xl border border-white/5 bg-black/40 p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge
                    className={cn(
                      "text-[10px]",
                      item.severity === "critical"
                        ? "bg-ira-rose/20 text-ira-rose"
                        : "bg-ira-amber/20 text-ira-amber",
                    )}
                  >
                    {item.severity}
                  </Badge>
                  <button
                    type="button"
                    className="font-mono text-[10px] text-ira-cyan hover:underline"
                    onClick={() => openProject(item.projectId, "askme")}
                  >
                    {proj?.name ?? item.projectId}
                  </button>
                </div>
                <p className="text-xs text-slate-100">{item.title}</p>
                <p className="mt-1 text-[11px] text-slate-500">{item.detail}</p>
                <Button
                  size="xs"
                  variant="ghost"
                  className="mt-2 text-ira-cyan"
                  onClick={() => approve(item.id)}
                >
                  Approve
                </Button>
              </li>
            );
          })}
          {interventions.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing waiting on you.</p>
          ) : null}
        </ul>
      </ScrollArea>
    </div>
  );
}

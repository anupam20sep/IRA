import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCockpit,
  type DocHit,
  type ProjectLens,
  type SpecStage,
} from "@/store/cockpit";
import { cn } from "@/lib/utils";
import { AskMeRail } from "@/components/cockpit/AskMeRail";
import { searchDocsApi } from "@/lib/ira-api";

const lenses: { id: ProjectLens; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "team", label: "Team" },
  { id: "stages", label: "Stages" },
  { id: "docs", label: "Docs" },
  { id: "decisions", label: "Decisions" },
  { id: "memory", label: "Memory" },
  { id: "spend", label: "Spend" },
  { id: "triggers", label: "Triggers" },
  { id: "askme", label: "Ask-Me" },
];

const stageOrder: SpecStage[] = [
  "explore",
  "scope",
  "refine",
  "architect",
  "plan",
  "route",
  "forge",
  "validate",
  "ship",
];

function statusDot(status: string) {
  if (status === "busy") return "bg-ira-cyan shadow-[0_0_8px_#22d3ee]";
  if (status === "blocked") return "bg-ira-amber shadow-[0_0_8px_#f59e0b]";
  if (status === "offline") return "bg-ira-rose";
  return "bg-slate-500";
}

export function ProjectView() {
  const project = useCockpit((s) => s.activeProject());
  const lens = useCockpit((s) => s.projectLens);
  const setLens = useCockpit((s) => s.setProjectLens);
  const docsQuery = useCockpit((s) => s.docsQuery);
  const setDocsQuery = useCockpit((s) => s.setDocsQuery);
  const interventions = useCockpit((s) => s.interventions);
  const approve = useCockpit((s) => s.approveIntervention);
  const hire = useCockpit((s) => s.hireAgentToProject);
  const catalog = useCockpit((s) => s.catalogAgents);
  const [liveDocs, setLiveDocs] = useState<DocHit[]>([]);
  const [docsErr, setDocsErr] = useState<string | null>(null);

  useEffect(() => {
    if (lens !== "docs" || !project) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchDocsApi(docsQuery, project.id)
        .then((res) => {
          if (!cancelled) {
            setLiveDocs(res.hits);
            setDocsErr(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setDocsErr(e instanceof Error ? e.message : String(e));
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [lens, docsQuery, project?.id]);

  if (!project) {
    return (
      <GlassPanel title="No project selected">
        <p className="text-sm text-slate-500">Pick a project from the nav.</p>
      </GlassPanel>
    );
  }

  const docs =
    liveDocs.length > 0 || docsQuery.trim()
      ? liveDocs
      : project.docs;

  const projectAsks = interventions.filter((i) => i.projectId === project.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <GlassPanel
        eyebrow="Project"
        title={project.name}
        action={
          <Badge variant="outline" className="font-mono text-[10px] capitalize">
            {project.status}
          </Badge>
        }
      >
        <p className="mb-2 text-xs text-slate-500">{project.tagline}</p>
        <Progress value={project.progress} className="mb-2 h-1.5 bg-slate-900" />
        <div className="flex flex-wrap gap-3 font-mono text-[11px] text-slate-400">
          <span className="text-ira-cyan">{project.done} done</span>
          <span className="text-ira-amber">{project.blocked} blocked</span>
          <span>{project.pending} pending</span>
          <span className="text-ira-purple">
            ${project.spendUsd.toFixed(2)} / ${project.budgetUsd}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {lenses.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLens(l.id)}
              className={cn(
                "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide",
                lens === l.id
                  ? "bg-ira-cyan/20 text-ira-cyan"
                  : "text-slate-500 hover:bg-white/5 hover:text-slate-300",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </GlassPanel>

      <ScrollArea className="min-h-0 flex-1">
        <div className="pr-3 pb-2">
          {lens === "pulse" && (
            <div className="grid gap-3 lg:grid-cols-2">
              <GlassPanel eyebrow="Realtime" title="Work status">
                <ul className="flex flex-col gap-2 text-sm">
                  {(["doing", "blocked", "todo", "done"] as const).map((st) => {
                    const items = project.tasks.filter((t) => t.status === st);
                    return (
                      <li key={st}>
                        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                          {st} ({items.length})
                        </p>
                        <ul className="flex flex-col gap-1">
                          {items.map((t) => {
                            const agent = project.agents.find((a) => a.id === t.assigneeId);
                            return (
                              <li
                                key={t.id}
                                className="flex justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-2 py-1.5 text-xs"
                              >
                                <span>
                                  <span className="font-mono text-ira-cyan">{t.id}</span>{" "}
                                  {t.title}
                                </span>
                                <span className="shrink-0 text-slate-500">
                                  {agent?.name ?? "unassigned"}
                                </span>
                              </li>
                            );
                          })}
                          {items.length === 0 ? (
                            <li className="text-xs text-slate-600">—</li>
                          ) : null}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </GlassPanel>
              <GlassPanel eyebrow="Live agents" title="Running now">
                <ul className="flex flex-col gap-2">
                  {project.agents.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between rounded-xl border border-white/5 bg-black/30 p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("size-1.5 rounded-full", statusDot(a.status))} />
                        <div>
                          <p className="text-sm text-slate-100">{a.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {a.role} · {a.taskId ?? "idle"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right font-mono text-[10px] text-slate-400">
                        <div>{(a.tokensUsed / 1000).toFixed(1)}k tok</div>
                        <div>{a.tokensPerMin}/min · {a.elapsedMin.toFixed(0)}m</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </GlassPanel>
            </div>
          )}

          {lens === "team" && (
            <GlassPanel eyebrow="Team working view" title="Agents ↔ tasks">
              <div className="mb-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="pb-2 pr-3">Agent</th>
                      <th className="pb-2 pr-3">Role</th>
                      <th className="pb-2 pr-3">Engine</th>
                      <th className="pb-2 pr-3">Task</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Tokens</th>
                      <th className="pb-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.agents.map((a) => {
                      const task = project.tasks.find((t) => t.id === a.taskId);
                      return (
                        <tr key={a.id} className="border-t border-white/5">
                          <td className="py-2 pr-3 text-slate-100">{a.name}</td>
                          <td className="py-2 pr-3 text-slate-400">{a.role}</td>
                          <td className="py-2 pr-3 font-mono text-ira-cyan">{a.engine}</td>
                          <td className="py-2 pr-3">
                            {task ? (
                              <>
                                <span className="font-mono text-ira-purple">{task.id}</span>{" "}
                                {task.title}
                              </>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 capitalize text-slate-400">{a.status}</td>
                          <td className="mono-tick py-2 pr-3">
                            {(a.tokensUsed / 1000).toFixed(1)}k · {a.tokensPerMin}/m
                          </td>
                          <td className="mono-tick py-2">{a.elapsedMin.toFixed(0)}m</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Hire from catalog into this project
              </p>
              <div className="flex flex-wrap gap-2">
                {catalog
                  .filter((c) => c.hired)
                  .map((c) => (
                    <Button
                      key={c.id}
                      size="sm"
                      variant="outline"
                      className="border-ira-cyan/20 text-xs"
                      onClick={() => hire(c.id, project.id)}
                    >
                      + {c.name}
                    </Button>
                  ))}
              </div>
            </GlassPanel>
          )}

          {lens === "stages" && (
            <GlassPanel eyebrow="SuperSpec" title="Spec & stage status">
              {project.specs.map((spec) => {
                const idx = stageOrder.indexOf(spec.stage);
                return (
                  <div key={spec.id} className="mb-4 rounded-xl border border-white/5 bg-black/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm text-slate-100">{spec.title}</p>
                      <Badge className="bg-ira-purple/20 font-mono text-[10px] text-ira-purple">
                        {spec.stage}
                      </Badge>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {stageOrder.map((st, i) => (
                        <span
                          key={st}
                          className={cn(
                            "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase",
                            i < idx
                              ? "bg-emerald-500/15 text-emerald-400"
                              : i === idx
                                ? "bg-ira-cyan/20 text-ira-cyan"
                                : "bg-white/5 text-slate-600",
                          )}
                        >
                          {st}
                        </span>
                      ))}
                    </div>
                    <p className="font-mono text-[11px] text-slate-500">
                      FR coverage {spec.frDone}/{spec.frTotal}
                    </p>
                    <Progress
                      value={(spec.frDone / Math.max(spec.frTotal, 1)) * 100}
                      className="mt-2 h-1.5 bg-slate-900"
                    />
                  </div>
                );
              })}
            </GlassPanel>
          )}

          {lens === "docs" && (
            <GlassPanel eyebrow="Documentation" title="Live FS search">
              <Input
                value={docsQuery}
                onChange={(e) => setDocsQuery(e.target.value)}
                placeholder="Search specs, design, plans, patterns…"
                className="mb-3 border-ira-cyan/20 bg-black/40 font-mono text-xs"
              />
              {docsErr ? (
                <p className="mb-2 text-xs text-ira-rose">{docsErr}</p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {docs.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-xl border border-white/5 bg-black/30 p-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {d.kind}
                      </Badge>
                      <span className="text-sm text-slate-100">{d.title}</span>
                    </div>
                    <p className="font-mono text-[10px] text-ira-cyan/70">{d.path}</p>
                    <p className="mt-1 text-xs text-slate-500">{d.snippet}</p>
                  </li>
                ))}
                {docs.length === 0 ? (
                  <p className="text-xs text-slate-500">No matches.</p>
                ) : null}
              </ul>
            </GlassPanel>
          )}

          {lens === "decisions" && (
            <GlassPanel eyebrow="Decision log" title="Immutable timeline">
              <ul className="flex flex-col gap-2">
                {project.decisions.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-xl border border-white/5 bg-black/30 p-3"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-600">{d.ts}</span>
                      <Badge className="bg-ira-cyan/15 font-mono text-[10px] text-ira-cyan">
                        {d.kind}
                      </Badge>
                      <span className="text-xs text-slate-500">{d.actor}</span>
                    </div>
                    <p className="text-sm text-slate-100">{d.title}</p>
                    <p className="mt-1 text-xs text-slate-400">Outcome: {d.outcome}</p>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          {lens === "memory" && (
            <GlassPanel eyebrow="Patterns" title="Learning memory">
              <ul className="flex flex-col gap-2">
                {project.patterns.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-xl border border-white/5 bg-black/30 p-3"
                  >
                    <div className="mb-1 flex gap-2">
                      <Badge
                        className={cn(
                          "font-mono text-[10px]",
                          p.kind === "success" && "bg-emerald-500/15 text-emerald-400",
                          p.kind === "failure" && "bg-ira-rose/15 text-ira-rose",
                          p.kind === "routing" && "bg-ira-purple/15 text-ira-purple",
                        )}
                      >
                        {p.kind}
                      </Badge>
                      <span className="mono-tick text-[10px] text-slate-500">
                        score {p.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-200">{p.summary}</p>
                    {p.usedIn ? (
                      <p className="mt-1 font-mono text-[10px] text-ira-cyan">
                        retrieved → {p.usedIn}
                      </p>
                    ) : null}
                  </li>
                ))}
                {project.patterns.length === 0 ? (
                  <p className="text-xs text-slate-500">No patterns yet.</p>
                ) : null}
              </ul>
            </GlassPanel>
          )}

          {lens === "spend" && (
            <GlassPanel eyebrow="Budgets" title="Spend & circuit breaker">
              <p className="mb-2 text-2xl font-medium text-ira-cyan mono-tick">
                ${project.spendUsd.toFixed(2)}
                <span className="text-sm text-slate-500"> / ${project.budgetUsd}</span>
              </p>
              <Progress
                value={(project.spendUsd / project.budgetUsd) * 100}
                className="mb-3 h-2 bg-slate-900"
              />
              <p className="mb-3 text-xs text-slate-500">
                Breaker:{" "}
                {project.spendUsd / project.budgetUsd > 0.9
                  ? "constrain (near limit)"
                  : project.spendUsd / project.budgetUsd > 0.7
                    ? "steer"
                    : "nominal"}
              </p>
              <ul className="flex flex-col gap-1 text-xs">
                {project.agents.map((a) => (
                  <li key={a.id} className="flex justify-between border-t border-white/5 py-1.5">
                    <span>{a.name}</span>
                    <span className="mono-tick text-slate-400">
                      {(a.tokensUsed / 1000).toFixed(1)}k tok
                    </span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          {lens === "triggers" && (
            <GlassPanel eyebrow="Standing orders" title="Triggers / away">
              <ul className="flex flex-col gap-2">
                {project.triggers.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-xl border border-white/5 bg-black/30 p-3"
                  >
                    <div>
                      <p className="text-sm text-slate-100">{t.name}</p>
                      <p className="font-mono text-[10px] text-slate-500">next: {t.next}</p>
                    </div>
                    <Badge
                      className={
                        t.enabled
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-slate-500/15 text-slate-500"
                      }
                    >
                      {t.enabled ? "on" : "off"}
                    </Badge>
                  </li>
                ))}
                {project.triggers.length === 0 ? (
                  <p className="text-xs text-slate-500">No triggers configured.</p>
                ) : null}
              </ul>
            </GlassPanel>
          )}

          {lens === "askme" && (
            <div className="grid gap-3 lg:grid-cols-2">
              <GlassPanel eyebrow="Project Ask-Me" title="Needs you here">
                <ul className="flex flex-col gap-2">
                  {projectAsks.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-white/5 bg-black/30 p-3"
                    >
                      <p className="text-sm text-slate-100">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="mt-2 text-ira-cyan"
                        onClick={() => approve(item.id)}
                      >
                        Approve
                      </Button>
                    </li>
                  ))}
                  {projectAsks.length === 0 ? (
                    <p className="text-xs text-slate-500">Clear for this project.</p>
                  ) : null}
                </ul>
              </GlassPanel>
              <AskMeRail />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentForm } from "@/components/cockpit/forms/AgentForm";
import { SkillForm } from "@/components/cockpit/forms/SkillForm";
import { ProjectsPanel } from "@/components/cockpit/forms/ProjectsPanel";
import { EnginesPanel } from "@/components/cockpit/EnginesPanel";
import { VoiceConfigPanel } from "@/components/cockpit/VoiceConfigPanel";
import { useCockpit } from "@/store/cockpit";
import { defaultConfig, loadConfig, type IraConfig } from "@/lib/config";

export function SetupView() {
  const agents = useCockpit((s) => s.catalogAgents);
  const skills = useCockpit((s) => s.catalogSkills);
  const toggleAgent = useCockpit((s) => s.toggleCatalogAgent);
  const toggleSkill = useCockpit((s) => s.toggleCatalogSkill);
  const hire = useCockpit((s) => s.hireAgentToProject);
  const projects = useCockpit((s) => s.projects);
  const projectId = useCockpit((s) => s.projectId) ?? projects[0]?.id;
  const [config, setConfig] = useState<IraConfig>(defaultConfig);

  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ProjectsPanel />

      <div className="grid gap-3 lg:grid-cols-2">
        <AgentForm />
        <SkillForm />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <EnginesPanel />
        <VoiceConfigPanel config={config} onChange={setConfig} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <GlassPanel eyebrow="Roster" title="Catalog agents">
          <ul className="flex flex-col gap-2">
            {agents.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-white/5 bg-black/30 p-3"
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-slate-100">{a.name}</p>
                    <p className="text-xs text-slate-500">{a.role}</p>
                  </div>
                  <Badge
                    className={
                      a.hired
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-slate-500/20 text-slate-500"
                    }
                  >
                    {a.hired ? "in roster" : "available"}
                  </Badge>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {a.skills.map((sk) => (
                    <Badge key={sk} variant="outline" className="font-mono text-[10px]">
                      {sk}
                    </Badge>
                  ))}
                </div>
                <p className="mb-2 font-mono text-[10px] text-ira-cyan">{a.defaultEngine}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleAgent(a.id)}>
                    {a.hired ? "Remove from roster" : "Add to roster"}
                  </Button>
                  {a.hired && projectId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-ira-cyan"
                      onClick={() => hire(a.id, projectId)}
                    >
                      Hire → {projectId}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </GlassPanel>

        <GlassPanel eyebrow="Skills" title="Installed skills">
          <ul className="flex flex-col gap-2">
            {skills.map((sk) => (
              <li
                key={sk.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/30 p-3"
              >
                <div>
                  <p className="text-sm text-slate-100">{sk.name}</p>
                  <p className="text-xs text-slate-500">{sk.description}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleSkill(sk.id)}>
                  {sk.installed ? "Installed" : "Install"}
                </Button>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </div>
    </div>
  );
}

import { Keyboard, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AskMeRail } from "@/components/cockpit/AskMeRail";
import { useCockpit, type AutonomyMode } from "@/store/cockpit";
import { cn } from "@/lib/utils";

const modes: AutonomyMode[] = ["observe", "supervised", "autonomous"];

export function TopBar() {
  const autonomy = useCockpit((s) => s.autonomy);
  const setAutonomy = useCockpit((s) => s.setAutonomy);
  const away = useCockpit((s) => s.away);
  const setAway = useCockpit((s) => s.setAway);
  const setCommandOpen = useCockpit((s) => s.setCommandOpen);
  const telemetry = useCockpit((s) => s.telemetry);
  const route = useCockpit((s) => s.route);
  const project = useCockpit((s) => s.activeProject());

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-glow text-lg font-semibold tracking-[0.28em] text-ira-cyan">
            IRA
          </p>
          <p className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
            GOD mode
            {route === "project" && project ? ` · ${project.name}` : ` · ${route}`}
          </p>
        </div>
        <AskMeRail compact />
        <span
          className={cn(
            "font-mono text-[10px]",
            telemetry.hiveReady ? "text-emerald-400" : "text-ira-rose",
          )}
        >
          hive {telemetry.hiveReady ? "ok" : "bad"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="glass-panel flex rounded-full p-1">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAutonomy(mode)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                autonomy === mode
                  ? "bg-ira-cyan/20 text-ira-cyan"
                  : "text-slate-500 hover:text-slate-300",
              )}
            >
              {mode}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="ghost"
          className={cn(away ? "text-ira-amber" : "text-slate-400")}
          onClick={() => setAway(!away)}
        >
          {away ? <Moon data-icon="inline-start" /> : <Sun data-icon="inline-start" />}
          {away ? "Away" : "Present"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="border-ira-cyan/20 text-slate-300"
          onClick={() => setCommandOpen(true)}
        >
          <Keyboard data-icon="inline-start" />
          Ctrl+K
        </Button>
      </div>
    </header>
  );
}

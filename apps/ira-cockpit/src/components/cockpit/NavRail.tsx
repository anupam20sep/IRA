import {
  FolderKanban,
  Home,
  Lightbulb,
  Settings2,
} from "lucide-react";
import { useCockpit, type Route } from "@/store/cockpit";
import { cn } from "@/lib/utils";

const items: { id: Route; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "project", label: "Projects", icon: FolderKanban },
  { id: "brainstorm", label: "Brainstorm", icon: Lightbulb },
  { id: "setup", label: "Setup", icon: Settings2 },
];

export function NavRail() {
  const route = useCockpit((s) => s.route);
  const setRoute = useCockpit((s) => s.setRoute);
  const openProject = useCockpit((s) => s.openProject);
  const projects = useCockpit((s) => s.projects);
  const projectId = useCockpit((s) => s.projectId);

  return (
    <nav className="glass-panel flex w-[200px] shrink-0 flex-col gap-1 rounded-2xl p-2">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          item.id === "project" ? route === "project" : route === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id === "project") {
                openProject(projectId ?? projects[0]?.id ?? "edu-platform");
              } else {
                setRoute(item.id);
              }
            }}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
              active
                ? "bg-ira-cyan/15 text-ira-cyan"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </button>
        );
      })}

      <div className="my-2 h-px bg-ira-cyan/10" />
      <p className="px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
        Projects
      </p>
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => openProject(p.id)}
          className={cn(
            "rounded-xl px-3 py-1.5 text-left text-xs transition-colors",
            route === "project" && projectId === p.id
              ? "bg-ira-purple/15 text-ira-purple"
              : "text-slate-500 hover:bg-white/5 hover:text-slate-300",
          )}
        >
          <span className="block truncate font-medium">{p.name}</span>
          <span className="mono-tick text-[10px] text-slate-600">
            {p.specs.length} specs · {p.progress}%
          </span>
        </button>
      ))}
    </nav>
  );
}

import { useEffect } from "react";
import { TopBar } from "@/components/cockpit/TopBar";
import { NavRail } from "@/components/cockpit/NavRail";
import { ActivityDeck } from "@/components/cockpit/ActivityDeck";
import { CommandPalette } from "@/components/cockpit/CommandPalette";
import { HomeView } from "@/components/cockpit/views/HomeView";
import { ProjectView } from "@/components/cockpit/views/ProjectView";
import { BrainstormView } from "@/components/cockpit/views/BrainstormView";
import { SetupView } from "@/components/cockpit/views/SetupView";
import { OmniPrompt } from "@/components/cockpit/OmniPrompt";
import { useCockpit } from "@/store/cockpit";

export function Cockpit() {
  const tick = useCockpit((s) => s.tick);
  const route = useCockpit((s) => s.route);
  const refreshLive = useCockpit((s) => s.refreshLive);
  const live = useCockpit((s) => s.live);
  const liveError = useCockpit((s) => s.liveError);
  const refreshing = useCockpit((s) => s.refreshing);
  const lastRefreshAt = useCockpit((s) => s.lastRefreshAt);
  const liveMeta = useCockpit((s) => s.liveMeta);
  const projectCount = useCockpit((s) => s.projects.length);

  useEffect(() => {
    void refreshLive();
    const poll = window.setInterval(() => void refreshLive(), 15_000);
    return () => window.clearInterval(poll);
  }, [refreshLive]);

  useEffect(() => {
    const id = window.setInterval(() => tick(), 900);
    return () => window.clearInterval(id);
  }, [tick]);

  return (
    <div className="flex h-dvh flex-col gap-3 p-4">
      <TopBar />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-[10px] text-slate-500">
        {refreshing ? (
          <span className="text-ira-amber">Refreshing…</span>
        ) : live ? (
          <span className="text-emerald-400">
            LIVE · {projectCount} project{projectCount === 1 ? "" : "s"}
            {liveMeta?.hiveReady ? " · hive ok" : " · hive down"}
            {lastRefreshAt ? ` · ${lastRefreshAt}` : ""}
          </span>
        ) : (
          <span className="text-ira-amber">
            {liveError ? `Backend: ${liveError}` : "Connecting…"}
          </span>
        )}
        <button
          type="button"
          disabled={refreshing}
          className="text-ira-cyan hover:underline disabled:opacity-40"
          onClick={() => void refreshLive()}
        >
          {refreshing ? "Working…" : "Refresh"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <NavRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {route !== "home" ? (
            <div className="shrink-0 px-1">
              <OmniPrompt />
            </div>
          ) : null}
          {route === "home" ? <HomeView /> : null}
          {route === "project" ? <ProjectView /> : null}
          {route === "brainstorm" ? <BrainstormView /> : null}
          {route === "setup" ? <SetupView /> : null}
        </div>
      </div>

      <ActivityDeck />
      <CommandPalette />
    </div>
  );
}

import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchEngines, fetchSnapshot } from "@/lib/ira-api";
import type { EngineInfo } from "@/backend/types";
import { cn } from "@/lib/utils";

export function EnginesPanel() {
  const [rows, setRows] = useState<EngineInfo[]>([]);
  const [note, setNote] = useState("");
  const [doctor, setDoctor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const pack = await fetchEngines();
      setRows(pack.engines ?? []);
      setNote(pack.note ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function runDoctor() {
    setDoctor(null);
    setErr(null);
    try {
      const snap = await fetchSnapshot();
      setDoctor(JSON.stringify(snap.doctor, null, 2).slice(0, 2000));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <GlassPanel eyebrow="Engines" title="Claude · Cursor · Codex · OpenCode">
      <p className="mb-3 text-xs text-slate-500">
        Host engines (Claude / Cursor / Codex) are <strong className="text-ira-amber">never</strong>{" "}
        parented by Ira — only queued for the host session. OpenCode may run via detached
        supervisor when the engine rung is ready.
      </p>
      <ul className="mb-3 flex flex-col gap-2">
        {rows.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-black/30 px-3 py-2"
          >
            <div>
              <p className="text-sm text-slate-100">{e.id}</p>
              <p className="font-mono text-[10px] text-slate-500">{e.cmd}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  e.installed ? "bg-emerald-500/15 text-emerald-400" : "bg-ira-rose/15 text-ira-rose",
                )}
              >
                {e.installed ? "installed" : "missing"}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {e.hostSpawnOnly ? "host-spawn" : "detachable"}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          Re-detect
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runDoctor()}>
          Run doctor
        </Button>
      </div>
      {note ? <p className="mt-2 font-mono text-[10px] text-slate-600">{note}</p> : null}
      {err ? <p className="mt-2 text-xs text-ira-rose">{err}</p> : null}
      {doctor ? (
        <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-black/50 p-2 font-mono text-[10px] text-slate-400">
          {doctor}
        </pre>
      ) : null}
    </GlassPanel>
  );
}

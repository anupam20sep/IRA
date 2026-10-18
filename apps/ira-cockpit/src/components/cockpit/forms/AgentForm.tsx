import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { createAgentApi } from "@/lib/ira-api";
import { useCockpit } from "@/store/cockpit";

const harnesses = ["cursor", "claude", "codex", "opencode"] as const;

export function AgentForm() {
  const refreshLive = useCockpit((s) => s.refreshLive);
  const projectId = useCockpit((s) => s.projectId);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tags, setTags] = useState("python, backend");
  const [harness, setHarness] = useState<(typeof harnesses)[number]>("cursor");
  const [body, setBody] = useState(
    "You are a specialist agent. Follow Ira's briefs. Escalate critical class to Ask-Me.",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setStatus(null);
    const agentId = (id || name).toLowerCase().replace(/\s+/g, "-");
    try {
      const res = await createAgentApi({
        harness,
        id: agentId,
        name: name || agentId,
        description: role || name || agentId,
        capabilityTags: tags,
        body,
        projectId: projectId ?? undefined,
      });
      setStatus(`Wrote ${res.path}`);
      await refreshLive();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassPanel eyebrow="Add agent" title="Creates harness .md / .toml">
      <p className="mb-3 text-xs text-slate-500">
        Writes a persona file under the repo for Claude / Cursor / Codex / OpenCode.
      </p>
      <div className="flex flex-col gap-2">
        <Input placeholder="id (python-dev)" value={id} onChange={(e) => setId(e.target.value)} />
        <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
        <Input
          placeholder="capability tags (comma)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {harnesses.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHarness(h)}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase ${
                harness === h ? "bg-ira-cyan/20 text-ira-cyan" : "text-slate-500"
              }`}
            >
              {h}
            </button>
          ))}
        </div>
        <Textarea
          className="min-h-28 font-mono text-xs"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button disabled={busy || (!id && !name)} onClick={submit}>
          Write agent file
        </Button>
        {status ? <p className="font-mono text-[11px] text-ira-cyan">{status}</p> : null}
      </div>
    </GlassPanel>
  );
}

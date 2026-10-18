import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GlassPanel } from "@/components/cockpit/GlassPanel";
import { createSkillApi } from "@/lib/ira-api";
import { useCockpit } from "@/store/cockpit";

export function SkillForm() {
  const refreshLive = useCockpit((s) => s.refreshLive);
  const projectId = useCockpit((s) => s.projectId);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(
    "When to use this skill…\n\n## Steps\n1. …\n",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setStatus(null);
    const skillId = (id || name).toLowerCase().replace(/\s+/g, "-");
    try {
      const res = await createSkillApi({
        id: skillId,
        name: name || skillId,
        description: description || name || skillId,
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
    <GlassPanel eyebrow="Add skill" title="Creates skills/<id>/SKILL.md">
      <div className="flex flex-col gap-2">
        <Input placeholder="id (security-review)" value={id} onChange={(e) => setId(e.target.value)} />
        <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder="One-line description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Textarea
          className="min-h-28 font-mono text-xs"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button disabled={busy || (!id && !name)} onClick={submit}>
          Write skill file
        </Button>
        {status ? <p className="font-mono text-[11px] text-ira-cyan">{status}</p> : null}
      </div>
    </GlassPanel>
  );
}

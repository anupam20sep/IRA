import { GlassPanel } from "@/components/cockpit/GlassPanel";
import type { IraConfig, VoiceSttProvider, VoiceTtsProvider } from "@/lib/config";

type Props = {
  config: IraConfig;
  onChange: (next: IraConfig) => void;
};

const sttProviders: VoiceSttProvider[] = ["webspeech", "whisper-local", "openai"];
const ttsProviders: VoiceTtsProvider[] = ["webspeech", "elevenlabs", "openai"];

export function VoiceConfigPanel({ config, onChange }: Props) {
  const v = config.voice;

  return (
    <GlassPanel eyebrow="Voice" title="STT / TTS providers">
      <p className="mb-3 text-xs text-slate-500">
        Defaults live in <span className="font-mono text-ira-cyan">ira.config.json</span>. Secrets via{" "}
        <span className="font-mono">VITE_IRA_ELEVENLABS_API_KEY</span> / env — never commit keys.
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) =>
            onChange({ ...config, voice: { ...v, enabled: e.target.checked } })
          }
        />
        Voice enabled
      </label>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">STT</p>
      <div className="mb-3 flex flex-wrap gap-1">
        {sttProviders.map((p) => (
          <button
            key={p}
            type="button"
            className={`rounded-full px-2.5 py-1 font-mono text-[10px] ${
              v.stt.provider === p ? "bg-ira-cyan/20 text-ira-cyan" : "text-slate-500"
            }`}
            onClick={() =>
              onChange({ ...config, voice: { ...v, stt: { provider: p } } })
            }
          >
            {p}
          </button>
        ))}
      </div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">TTS</p>
      <div className="mb-3 flex flex-wrap gap-1">
        {ttsProviders.map((p) => (
          <button
            key={p}
            type="button"
            className={`rounded-full px-2.5 py-1 font-mono text-[10px] ${
              v.tts.provider === p ? "bg-ira-purple/20 text-ira-purple" : "text-slate-500"
            }`}
            onClick={() =>
              onChange({
                ...config,
                voice: { ...v, tts: { ...v.tts, provider: p } },
              })
            }
          >
            {p}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] text-slate-600">
        wake “{v.wakeWord}” · elevenLabs model {v.tts.model || "—"} · voiceId{" "}
        {v.tts.voiceId || "(default)"}
      </p>
    </GlassPanel>
  );
}

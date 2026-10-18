import { useEffect, useState } from "react";
import { CornerDownLeft, Mic, Sparkles, Volume2 } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group";
import { useCockpit } from "@/store/cockpit";
import { defaultConfig, loadConfig, type IraConfig } from "@/lib/config";
import { listenOnce, speak } from "@/lib/voice";

export function OmniPrompt() {
  const prompt = useCockpit((s) => s.prompt);
  const setPrompt = useCockpit((s) => s.setPrompt);
  const submitPrompt = useCockpit((s) => s.submitPrompt);
  const processing = useCockpit((s) => s.processing);
  const [config, setConfig] = useState<IraConfig>(defaultConfig);
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);

  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (!processing) return;
    // After Ira "replies" in demo logs, optionally speak last ack
    const t = window.setTimeout(() => {
      void speak("Command received.", config).catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [processing, config]);

  function startListen() {
    setVoiceErr(null);
    setListening(true);
    listenOnce(
      config,
      (text) => {
        setListening(false);
        let cmd = text;
        const wake = config.voice.wakeWord.toLowerCase();
        if (cmd.toLowerCase().startsWith(wake)) {
          cmd = cmd.slice(wake.length).replace(/^[,:\s]+/, "");
        }
        setPrompt(cmd);
        if (cmd.trim()) {
          window.setTimeout(() => submitPrompt(), 50);
        }
      },
      (msg) => {
        setListening(false);
        setVoiceErr(msg);
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <InputGroup className="glass-panel h-12 overflow-hidden rounded-full border-ira-cyan/20 bg-black/40 shadow-[inset_0_0_18px_rgba(34,211,238,0.12)]">
        <InputGroupAddon align="inline-start">
          <Sparkles className="text-ira-cyan" />
        </InputGroupAddon>
        <InputGroupInput
          value={prompt}
          disabled={processing}
          placeholder='Ira… “show billing team”, “brainstorm digest”, or tap mic'
          className="font-sans text-sm text-slate-100 placeholder:text-slate-500"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitPrompt();
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="sm"
            variant="ghost"
            className={listening ? "text-ira-rose" : "text-ira-purple"}
            disabled={!config.voice.enabled || processing}
            onClick={startListen}
            title={`STT: ${config.voice.stt.provider}`}
          >
            <Mic data-icon="inline-start" />
            {listening ? "…" : "Mic"}
          </InputGroupButton>
          <InputGroupButton
            size="sm"
            variant="ghost"
            className="text-slate-400"
            disabled={!config.voice.enabled}
            onClick={() => void speak("Ira online. God mode.", config)}
            title={`TTS: ${config.voice.tts.provider}`}
          >
            <Volume2 />
          </InputGroupButton>
          <InputGroupButton
            size="sm"
            variant="ghost"
            className="text-ira-cyan hover:bg-ira-cyan/10"
            disabled={processing || !prompt.trim()}
            onClick={submitPrompt}
          >
            <CornerDownLeft data-icon="inline-start" />
            Send
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {voiceErr ? (
        <p className="mt-1 text-center text-[11px] text-ira-amber">{voiceErr}</p>
      ) : (
        <p className="mt-1 text-center font-mono text-[10px] text-slate-600">
          voice {config.voice.enabled ? "on" : "off"} · stt {config.voice.stt.provider} · tts{" "}
          {config.voice.tts.provider}
        </p>
      )}
    </div>
  );
}

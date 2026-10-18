import type { IraConfig } from "@/lib/config";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export async function speak(text: string, config: IraConfig): Promise<void> {
  if (!config.voice.enabled || !text.trim()) return;
  const provider = config.voice.tts.provider;

  if (provider === "elevenlabs") {
    const key = import.meta.env.VITE_IRA_ELEVENLABS_API_KEY as string | undefined;
    if (!key) {
      console.warn("ElevenLabs selected but VITE_IRA_ELEVENLABS_API_KEY missing; falling back to webspeech");
    } else {
      const voiceId = config.voice.tts.voiceId || "21m00Tcm4TlvDq8ikWAM";
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": key,
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: config.voice.tts.model || "eleven_multilingual_v2",
          }),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      return;
    }
  }

  if (provider === "openai") {
    console.warn("OpenAI TTS not wired in demo; using webspeech");
  }

  await new Promise<void>((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => resolve();
    u.onerror = () => reject(new Error("webspeech TTS failed"));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

export function listenOnce(
  config: IraConfig,
  onText: (text: string) => void,
  onError: (msg: string) => void,
): () => void {
  if (!config.voice.enabled) {
    onError("Voice disabled in ira.config.json");
    return () => undefined;
  }
  if (config.voice.stt.provider !== "webspeech") {
    onError(
      `${config.voice.stt.provider} STT not bundled yet — set stt.provider to webspeech or add local whisper later.`,
    );
    return () => undefined;
  }
  const rec = getRecognition();
  if (!rec) {
    onError("Web Speech STT unavailable in this webview");
    return () => undefined;
  }
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "en-US";
  rec.onresult = (ev) => {
    const text = ev.results[0]?.[0]?.transcript ?? "";
    onText(text.trim());
  };
  rec.onerror = (ev) => onError(ev.error);
  rec.onend = () => undefined;
  rec.start();
  return () => rec.stop();
}

export type VoiceSttProvider = "webspeech" | "whisper-local" | "openai";
export type VoiceTtsProvider = "webspeech" | "elevenlabs" | "openai";

export type ProjectConfigEntry = {
  id?: string;
  name?: string;
  /** Absolute or relative local repository root */
  path: string;
};

export type IraConfig = {
  /** @deprecated Prefer `projects[]` — kept as default/primary root */
  repositoryRoot: string;
  /** Local repo roots registered as cockpit projects (each may contain many specs) */
  projects: ProjectConfigEntry[];
  engines: {
    prefer: string[];
    superspecBin: string;
  };
  voice: {
    enabled: boolean;
    stt: { provider: VoiceSttProvider };
    tts: {
      provider: VoiceTtsProvider;
      voiceId: string;
      model: string;
    };
    wakeWord: string;
    autoListenAfterReply: boolean;
  };
  distribution: {
    channel: string;
    updateUrl: string;
  };
};

export const defaultConfig: IraConfig = {
  repositoryRoot: "../..",
  projects: [{ id: "superspec", name: "SuperSpec", path: "../.." }],
  engines: {
    prefer: ["cursor-agent", "claude", "codex", "opencode"],
    superspecBin: "packages/core/dist/cli.js",
  },
  voice: {
    enabled: true,
    stt: { provider: "webspeech" },
    tts: {
      provider: "webspeech",
      voiceId: "",
      model: "eleven_multilingual_v2",
    },
    wakeWord: "ira",
    autoListenAfterReply: false,
  },
  distribution: {
    channel: "dev",
    updateUrl: "",
  },
};

export async function loadConfig(): Promise<IraConfig> {
  try {
    const res = await fetch("/ira.config.json");
    if (!res.ok) return defaultConfig;
    const raw = (await res.json()) as Partial<IraConfig>;
    const projects =
      Array.isArray(raw.projects) && raw.projects.length > 0
        ? raw.projects
        : raw.repositoryRoot
          ? [{ path: raw.repositoryRoot }]
          : defaultConfig.projects;
    return {
      ...defaultConfig,
      ...raw,
      projects,
      engines: { ...defaultConfig.engines, ...raw.engines },
      voice: {
        ...defaultConfig.voice,
        ...raw.voice,
        stt: { ...defaultConfig.voice.stt, ...raw.voice?.stt },
        tts: { ...defaultConfig.voice.tts, ...raw.voice?.tts },
      },
      distribution: { ...defaultConfig.distribution, ...raw.distribution },
    };
  } catch {
    return defaultConfig;
  }
}

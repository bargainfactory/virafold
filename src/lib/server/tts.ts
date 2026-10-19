import { resolveField } from "./integrations";

/**
 * Text-to-speech for script videos. ElevenLabs when a voiceover key is
 * connected (best quality), else OpenAI TTS via the existing LLM key.
 * Returns null when neither is available — callers surface a clear
 * connect-a-key error, same contract as every other provider chain.
 */

// ElevenLabs "Rachel" — a neutral, widely-liked narration voice.
const ELEVENLABS_VOICE = "21m00Tcm4TlvDq8ikWAM";
const MAX_TTS_CHARS = 4800;

export async function synthesizeSpeech(
  text: string,
  language = "en",
  customVoiceId?: string | null
): Promise<{ bytes: Buffer; provider: string } | null> {
  const input = text.trim().slice(0, MAX_TTS_CHARS);
  if (!input) return null;

  const elevenKey = resolveField("voiceover", "elevenlabsApiKey");
  if (elevenKey) {
    // Per-character casting survives the provider: the voiceover integration's
    // elevenVoiceMap (JSON) maps the engine's voice names to ElevenLabs voice
    // IDs — {"eve":"<id>","luna":"<id>","default":"<id>"}. A requested voice
    // with NO mapping skips ElevenLabs for that line (falling through to xAI)
    // instead of collapsing the whole cast into one narrator.
    let elVoice: string | null = null;
    try {
      const map = JSON.parse(resolveField("voiceover", "elevenVoiceMap") || "{}") as Record<string, string>;
      if (customVoiceId) {
        if (map[customVoiceId]) elVoice = map[customVoiceId];
        else if (/^[A-Za-z0-9]{16,}$/.test(customVoiceId)) elVoice = customVoiceId; // already an ElevenLabs ID
      } else {
        elVoice = map.default || ELEVENLABS_VOICE;
      }
    } catch {
      elVoice = customVoiceId ? null : ELEVENLABS_VOICE;
    }
    if (elVoice) {
      try {
        const resp = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${elVoice}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
            body: JSON.stringify({ text: input, model_id: "eleven_multilingual_v2" }),
          }
        );
        if (resp.ok) {
          return {
            bytes: Buffer.from(await resp.arrayBuffer()),
            provider: "elevenlabs:multilingual-v2",
          };
        }
      } catch {
        /* fall through to xAI */
      }
    }
  }

  // xAI TTS: Grok voices at $15/1M chars on the key already connected.
  const xaiKey = resolveField("llm", "xaiApiKey");
  if (xaiKey) {
    try {
      // The creator's cloned voice wins; then the operator's pick; then eve.
      // A misconfigured voice name (a model name pasted into the voice field
      // once took every render down) falls back to eve instead of failing.
      const picked = customVoiceId || resolveField("voiceover", "xaiVoiceId") || "eve";
      for (const voice of picked === "eve" ? ["eve"] : [picked, "eve"]) {
        const resp = await fetch("https://api.x.ai/v1/tts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${xaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: input, voice_id: voice, language }),
        });
        if (resp.ok) {
          return {
            bytes: Buffer.from(await resp.arrayBuffer()),
            provider: `xai:tts:${voice}`,
          };
        }
      }
    } catch {
      /* fall through to OpenAI */
    }
  }

  const openaiKey = resolveField("llm", "openaiApiKey");
  if (openaiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "tts-1", voice: "onyx", input }),
      });
      if (resp.ok) {
        return { bytes: Buffer.from(await resp.arrayBuffer()), provider: "openai:tts-1" };
      }
    } catch {
      /* no TTS available */
    }
  }

  return null;
}

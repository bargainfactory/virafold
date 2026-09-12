import { getIntegrationRaw, setIntegrationRaw } from "./db";

/**
 * Integration registry + resolver.
 *
 * Each integration declares the fields it needs and, per field, an optional
 * environment-variable source. A field's value is resolved from the environment
 * first, then from the DB (values entered later in the UI). Nothing here ever
 * returns a secret value to the client — only whether each field is present and
 * where it came from. This is what makes "connect your key to activate" real:
 * features check `isConfigured(name)` and run for real when keyed, or fall back
 * cleanly when not.
 */

export interface IntegrationField {
  key: string;
  label: string;
  envVar?: string;
  secret?: boolean;
  placeholder?: string;
  required?: boolean;
}

export interface IntegrationDef {
  name: string;
  label: string;
  description: string;
  docsHint?: string;
  fields: IntegrationField[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    name: "llm",
    label: "AI generation (Claude / Grok / OpenAI)",
    description:
      "Upgrades asset generation from the built-in engine to frontier-model output. Priority: Anthropic, then xAI, then OpenAI.",
    docsHint: "Paste an Anthropic API key (recommended), an xAI (Grok) key, or an OpenAI key.",
    fields: [
      { key: "anthropicApiKey", label: "Anthropic API key", envVar: "ANTHROPIC_API_KEY", secret: true, placeholder: "sk-ant-..." },
      { key: "xaiApiKey", label: "xAI (Grok) API key", envVar: "XAI_API_KEY", secret: true, placeholder: "xai-..." },
      { key: "openaiApiKey", label: "OpenAI API key", envVar: "OPENAI_API_KEY", secret: true, placeholder: "sk-..." },
    ],
  },
  {
    name: "audit",
    label: "Social audits (YouTube Data)",
    description:
      "Powers channel audits: fetches any public YouTube channel's recent videos and stats. CSV-import audits work without this.",
    docsHint:
      "Create a free API key in Google Cloud Console with the YouTube Data API v3 enabled.",
    fields: [
      { key: "youtubeApiKey", label: "YouTube Data API key", envVar: "YOUTUBE_API_KEY", secret: true, placeholder: "AIza...", required: true },
    ],
  },
  {
    name: "transcription",
    label: "Transcription (Deepgram / Whisper)",
    description:
      "Transcribes uploaded audio/video automatically, so pasting a transcript becomes optional. Falls back to your OpenAI key (Whisper, files up to 25 MB) when no Deepgram key is set.",
    docsHint: "Add a Deepgram API key for large files, or rely on your OpenAI key.",
    fields: [
      { key: "deepgramApiKey", label: "Deepgram API key", envVar: "DEEPGRAM_API_KEY", secret: true, placeholder: "dg_..." },
    ],
  },
  {
    name: "routing",
    label: "Model routing (token efficiency)",
    description:
      "Maps task tiers to models. Format: provider:model where provider is anthropic, xai, openai, or custom. Flagship = full generation & scripts, Standard = coaching & clip detection, Fast = one-line rewrites. Unset tiers use sensible defaults; unavailable models fall through the provider chain.",
    docsHint: "Change a tier here the day a better/cheaper model ships — no deploy needed.",
    fields: [
      { key: "flagshipModel", label: "Flagship tier", envVar: "LLM_FLAGSHIP", placeholder: "anthropic:claude-opus-4-8" },
      { key: "standardModel", label: "Standard tier", envVar: "LLM_STANDARD", placeholder: "xai:grok-4.6" },
      { key: "fastModel", label: "Fast tier", envVar: "LLM_FAST", placeholder: "openai:gpt-4o-mini" },
    ],
  },
  {
    name: "customllm",
    label: "Custom endpoint (OpenAI-compatible)",
    description:
      "Any OpenAI-compatible server — Groq, Together, Fireworks, DeepInfra, or your own vLLM/Ollama box. Once set, route any tier to it with custom:<model> in Model routing.",
    docsHint: "Base URL up to /v1 (e.g. https://api.groq.com/openai/v1).",
    fields: [
      { key: "baseUrl", label: "Base URL", envVar: "CUSTOM_LLM_URL", placeholder: "https://api.groq.com/openai/v1" },
      { key: "model", label: "Model name", envVar: "CUSTOM_LLM_MODEL", placeholder: "llama-3.3-70b-versatile" },
      { key: "apiKey", label: "API key", envVar: "CUSTOM_LLM_KEY", secret: true, placeholder: "gsk_..." },
    ],
  },
  {
    name: "voiceover",
    label: "Voiceover (ElevenLabs / Grok / OpenAI)",
    description:
      "Narrates script videos with a natural AI voice. Priority: ElevenLabs, then your xAI key (Grok voices — eve, orion, helix…), then OpenAI tts-1. With an xAI key connected, this already works.",
    docsHint: "Optional: an ElevenLabs key for premium voices, or pick a Grok voice below.",
    fields: [
      { key: "elevenlabsApiKey", label: "ElevenLabs API key", envVar: "ELEVENLABS_API_KEY", secret: true, placeholder: "sk_..." },
      { key: "xaiVoiceId", label: "Grok voice", envVar: "XAI_VOICE_ID", placeholder: "eve — or orion, helix, luna, perseus…" },
    ],
  },
  {
    name: "email",
    label: "Email (Resend)",
    description:
      "Enables real transactional email — password resets and notifications. Without it, reset links are shown in-app.",
    docsHint: "Add a Resend API key and a verified from-address.",
    fields: [
      { key: "resendApiKey", label: "Resend API key", envVar: "RESEND_API_KEY", secret: true, placeholder: "re_...", required: true },
      { key: "fromEmail", label: "From address", envVar: "EMAIL_FROM", placeholder: "Virafold <hello@yourdomain.com>", required: true },
      { key: "replyTo", label: "Reply-to address", envVar: "EMAIL_REPLY_TO", placeholder: "hello@yourdomain.com" },
    ],
  },
  {
    name: "stripe",
    label: "Payments (Stripe)",
    description:
      "Turns checkout into real Stripe subscriptions. Without it, checkout runs in demo mode.",
    docsHint: "Add your Stripe secret key.",
    fields: [
      { key: "secretKey", label: "Stripe secret key", envVar: "STRIPE_SECRET_KEY", secret: true, placeholder: "sk_live_...", required: true },
      { key: "webhookSecret", label: "Webhook signing secret", envVar: "STRIPE_WEBHOOK_SECRET", secret: true, placeholder: "whsec_..." },
    ],
  },
  {
    name: "google-oauth",
    label: "Sign in with Google",
    description: "Adds Google as a one-click sign-in option.",
    docsHint: "Add your Google OAuth client ID and secret.",
    fields: [
      { key: "clientId", label: "Client ID", envVar: "GOOGLE_CLIENT_ID", required: true },
      { key: "clientSecret", label: "Client secret", envVar: "GOOGLE_CLIENT_SECRET", secret: true, required: true },
    ],
  },
  {
    name: "publishing",
    label: "Publish & schedule (X / LinkedIn / TikTok / YouTube)",
    description:
      "Operator app credentials that let creators connect their own accounts and publish for real. X and LinkedIn deliver text posts today; TikTok/YouTube slots are reserved for the video pipeline.",
    docsHint:
      "Register developer apps (developer.x.com, developer.linkedin.com) with redirect URIs https://virafold.ai/api/connect/x/callback and /api/connect/linkedin/callback, then paste the credentials.",
    fields: [
      { key: "xClientId", label: "X (Twitter) client ID", envVar: "X_CLIENT_ID" },
      { key: "xClientSecret", label: "X (Twitter) client secret", envVar: "X_CLIENT_SECRET", secret: true },
      { key: "linkedinClientId", label: "LinkedIn client ID", envVar: "LINKEDIN_CLIENT_ID" },
      { key: "linkedinClientSecret", label: "LinkedIn client secret", envVar: "LINKEDIN_CLIENT_SECRET", secret: true },
      { key: "tiktokClientKey", label: "TikTok client key", envVar: "TIKTOK_CLIENT_KEY", secret: true },
      { key: "youtubeClientId", label: "YouTube client ID", envVar: "YOUTUBE_CLIENT_ID", secret: true },
    ],
  },
];

export function getIntegrationDef(name: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.name === name);
}

/** Resolve a single field value: environment wins, then stored config. */
export function resolveField(name: string, key: string): string | undefined {
  const def = getIntegrationDef(name);
  const field = def?.fields.find((f) => f.key === key);
  if (field?.envVar && process.env[field.envVar]) return process.env[field.envVar];
  const stored = getIntegrationRaw(name);
  return stored[key] || undefined;
}

/** Configured = every REQUIRED field has a value (env or stored). If no field
 *  is marked required, any single present field counts as configured. */
export function isConfigured(name: string): boolean {
  const def = getIntegrationDef(name);
  if (!def) return false;
  const required = def.fields.filter((f) => f.required);
  if (required.length > 0) {
    return required.every((f) => Boolean(resolveField(name, f.key)));
  }
  return def.fields.some((f) => Boolean(resolveField(name, f.key)));
}

export interface IntegrationStatus {
  name: string;
  label: string;
  description: string;
  docsHint?: string;
  configured: boolean;
  fields: {
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
    placeholder?: string;
    present: boolean;
    fromEnv: boolean;
  }[];
}

/** Secret-free status for the UI. */
export function integrationStatus(): IntegrationStatus[] {
  return INTEGRATIONS.map((def) => ({
    name: def.name,
    label: def.label,
    description: def.description,
    docsHint: def.docsHint,
    configured: isConfigured(def.name),
    fields: def.fields.map((f) => {
      const fromEnv = Boolean(f.envVar && process.env[f.envVar]);
      const stored = getIntegrationRaw(def.name)[f.key];
      return {
        key: f.key,
        label: f.label,
        secret: Boolean(f.secret),
        required: Boolean(f.required),
        placeholder: f.placeholder,
        present: fromEnv || Boolean(stored),
        fromEnv,
      };
    }),
  }));
}

/** Persist submitted fields for one integration. Blank values clear a stored
 *  field; env-sourced fields are never overwritten (they aren't submitted). */
export function saveIntegration(
  name: string,
  incoming: Record<string, unknown>
): void {
  const def = getIntegrationDef(name);
  if (!def) return;
  const current = getIntegrationRaw(name);
  for (const field of def.fields) {
    if (field.key in incoming) {
      const val = String(incoming[field.key] ?? "").trim();
      if (val) current[field.key] = val;
      else delete current[field.key];
    }
  }
  setIntegrationRaw(name, current);
}

// Server-side Gemini configuration. Credentials never enter status responses or MCP processes.
import { createRequire } from "node:module";
const requireHere = createRequire(import.meta.url);

export const DEFAULT_MODELS = { orchestrator: "gemini-3.8-flash", specialist: "gemini-3.8-flash", watch: "gemini-3.5-flash-lite", aiCheck: "gemini-3.8-flash" };
const MODEL_SETTINGS = { orchestrator: "REGCHAIN_MODEL_ORCHESTRATOR", specialist: "REGCHAIN_MODEL_SPECIALIST", watch: "REGCHAIN_MODEL_WATCH", aiCheck: "REGCHAIN_MODEL_AI_CHECK" };

export function geminiSettings(env = process.env) {
  const provider = String(env.REGCHAIN_AI_PROVIDER || "gemini").trim().toLowerCase();
  const problems = provider === "gemini" ? [] : ['REGCHAIN_AI_PROVIDER must be "gemini".'];
  const models = {};
  for (const [job, setting] of Object.entries(MODEL_SETTINGS)) {
    models[job] = String(env[setting] ?? "").trim() || DEFAULT_MODELS[job];
    if (!/^gemini-[a-z0-9][a-z0-9.\-]*$/i.test(models[job])) problems.push(`RegChain uses Gemini models only: check ${setting}.`);
  }
  const missing = String(env.GEMINI_API_KEY ?? "").trim() ? [] : ["GEMINI_API_KEY"];
  return { provider, label: "Gemini API (Google)", package: "@google/genai", known: provider === "gemini", models, missing, problems, configured: !missing.length && !problems.length };
}

export function packageInstalled(name) {
  try { requireHere.resolve(name); return true; } catch { return false; }
}

export function setupMessage(settings, installed = packageInstalled(settings.package)) {
  if (settings.problems.length) return settings.problems[0];
  if (!installed) return "The Google GenAI SDK is not installed. Run npm install in the RegChain folder, then restart.";
  if (settings.missing.length) return "Add GEMINI_API_KEY to the .env file next to serve-regchain.cjs, then restart RegChain.";
  return null;
}

export function geminiStatus(env = process.env) {
  const settings = geminiSettings(env);
  const installed = settings.known && packageInstalled(settings.package);
  const message = setupMessage(settings, installed);
  return { ...settings, installed, ready: !message, message };
}

export function credentialsRefused(error) {
  const status = Number(error?.status ?? error?.code);
  if ([401, 403].includes(status) || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(error?.message ?? ""))) {
    return "The Gemini API key was not accepted. Check GEMINI_API_KEY and its API access in the .env file.";
  }
  return null;
}

export async function createGemini({ load = name => import(name), env = process.env } = {}) {
  const settings = geminiSettings(env);
  if (!settings.configured) throw new Error(setupMessage(settings, true));
  let mod;
  try { mod = await load(settings.package); } catch { throw new Error(setupMessage(settings, false)); }
  // Explicitly use the API key even if the host also has Vertex AI/cloud environment settings.
  return new mod.GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim(), vertexai: false, httpOptions: { timeout: 180000 } });
}

export function liveModels(settings = geminiSettings()) {
  return { orchestrator: settings.models.orchestrator, specialists: settings.models.specialist, watch: settings.models.watch, service: settings.label };
}

// Preserve the entire model content (including thought signatures) when returning tool results.
export function responseParts(response) {
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("The model's answer was cut off. Try again.");
  if (response.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== "STOP")) {
    throw new Error("The model declined this request.");
  }
  const parts = candidate?.content?.parts;
  if (!parts?.length) throw new Error("The model returned no answer. Try again.");
  return parts;
}

// Keep the audit record's existing token field names, with Gemini's reasoning tokens included in output.
export function tokenUsage(response) {
  const usage = response.usageMetadata ?? {};
  return { input_tokens: usage.promptTokenCount ?? 0, output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0), cache_read_input_tokens: usage.cachedContentTokenCount ?? 0 };
}

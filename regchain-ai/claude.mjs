// Which Claude service RegChain calls, chosen with one setting: REGCHAIN_AI_PROVIDER.
//
// RegChain uses Claude models only. A company reaches them through Anthropic directly or through the cloud it already
// uses (AWS, Google Cloud, Microsoft Azure), so the data stays under the agreements it already has. The agents, prompts,
// rules and checks are the same on every service. Each cloud has its own Anthropic package, installed only where it is
// used. See RegChain-AI-Deployment.md, "Which Claude service".

import { createRequire } from "node:module";

const requireHere = createRequire(import.meta.url);

// The models for each job. Opus plans and reads the law; Sonnet does the specialists' narrower work.
export const DEFAULT_MODELS = { orchestrator: "claude-opus-5-5", specialist: "claude-sonnet-5-5", aiCheck: "claude-opus-5-5" };
const MODEL_SETTINGS = { orchestrator: "REGCHAIN_MODEL_ORCHESTRATOR", specialist: "REGCHAIN_MODEL_SPECIALIST", aiCheck: "REGCHAIN_MODEL_AI_CHECK" };
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const AZURE_SCOPE = "https://ai.azure.com/.default";

// One entry per service. `needs`: settings that must be present, each met by any one of its variables. Credentials that
// come from the cloud's own chain (an IAM role, a service account) cannot be checked here and show up on the first call.
// `serverFallbacks`: whether the service offers Anthropic's server-side fallback model for the AI check.
export const PROVIDERS = {
  anthropic: {
    label: "Claude API (Anthropic)", package: "@anthropic-ai/sdk", serverFallbacks: true,
    needs: [["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]],
    create: mod => new mod.default(),
  },
  aws: {
    label: "Claude Platform on AWS", package: "@anthropic-ai/aws-sdk", serverFallbacks: true,
    needs: [["AWS_REGION", "AWS_DEFAULT_REGION"], ["ANTHROPIC_AWS_WORKSPACE_ID"]],
    create: mod => new mod.default(),
  },
  bedrock: {
    label: "Amazon Bedrock", package: "@anthropic-ai/bedrock-sdk", serverFallbacks: false, modelPrefix: "anthropic.",
    needs: [["AWS_REGION", "AWS_DEFAULT_REGION"]],
    create: mod => new mod.AnthropicBedrockMantle(),
  },
  "google-cloud": {
    label: "Claude on Google Cloud (Anthropic managed)", package: "@anthropic-ai/google-cloud-sdk", serverFallbacks: true, google: true,
    needs: [["ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID", "ANTHROPIC_GOOGLE_CLOUD_BASE_URL"]],
    create: (mod, authClient) => new mod.AnthropicGoogleCloud({ authClient }),
  },
  vertex: {
    label: "Google Cloud Vertex AI", package: "@anthropic-ai/vertex-sdk", serverFallbacks: false, google: true,
    needs: [["CLOUD_ML_REGION"]],
    create: (mod, authClient) => new mod.AnthropicVertex({ authClient }),
  },
  foundry: {
    label: "Microsoft Foundry", package: "@anthropic-ai/foundry-sdk", serverFallbacks: false,
    needs: [["ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_FOUNDRY_BASE_URL"]],
    create: (mod, tokenProvider) => new mod.default(tokenProvider ? { azureADTokenProvider: tokenProvider } : {}),
  },
};

const present = (env, name) => String(env[name] ?? "").trim() !== "";

// What is configured, without loading anything. Safe to call on every status request.
export function claudeSettings(env = process.env) {
  const id = String(env.REGCHAIN_AI_PROVIDER || "anthropic").trim().toLowerCase();
  const provider = PROVIDERS[id];
  const problems = [];
  if (!provider) problems.push(`REGCHAIN_AI_PROVIDER is "${id}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.`);
  const models = {};
  for (const [job, setting] of Object.entries(MODEL_SETTINGS)) {
    const chosen = String(env[setting] ?? "").trim();
    models[job] = chosen || (provider?.modelPrefix ?? "") + DEFAULT_MODELS[job];
    // RegChain is built, prompted and tested for Claude. Another model is a change the tests have not covered.
    if (!/claude/i.test(models[job])) problems.push(`RegChain uses Claude models only: ${setting} is "${chosen}".`);
  }
  const missing = provider ? provider.needs.filter(names => !names.some(name => present(env, name))).map(names => names[0]) : [];
  return {
    provider: id, label: provider?.label ?? id, package: provider?.package ?? null, known: Boolean(provider),
    serverFallbacks: Boolean(provider?.serverFallbacks), models, missing, problems,
    configured: Boolean(provider) && !missing.length && !problems.length,
  };
}

export function packageInstalled(name) {
  try {
    requireHere.resolve(name);
    return true;
  } catch {
    return false;
  }
}

// The one sentence a person needs to make the AI work, or null when it is set up.
export function setupMessage(settings, installed = packageInstalled(settings.package)) {
  if (settings.problems.length) return settings.problems[0];
  if (!installed) {
    return settings.provider === "anthropic"
      ? "The Anthropic SDK is not installed. Run npm install in the RegChain folder, then restart."
      : `${settings.label} needs the package ${settings.package}. Run npm install ${settings.package} in the RegChain folder, then restart RegChain.`;
  }
  if (settings.missing.length) {
    return settings.provider === "anthropic"
      ? "Add ANTHROPIC_API_KEY to the .env file next to serve-regchain.cjs, then restart RegChain."
      : `For ${settings.label}, add ${settings.missing.join(" and ")} to the .env file next to serve-regchain.cjs, then restart RegChain.`;
  }
  return null;
}

export function claudeStatus(env = process.env) {
  const settings = claudeSettings(env);
  const installed = settings.known && packageInstalled(settings.package);
  const message = setupMessage(settings, installed);
  return { ...settings, installed, ready: !message, message };
}

// The service answered that RegChain may not call it: a wrong key, or an identity without access.
export function credentialsRefused(error, settings = claudeSettings()) {
  if (error?.status === 401 && settings.provider === "anthropic") return "The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY in the .env file.";
  if (error?.status === 401 || error?.status === 403) {
    return `${settings.label} did not accept RegChain's credentials. Check the ${settings.label} settings in the .env file and the access of the account RegChain runs as.`;
  }
  return null;
}

// google-auth-library comes with the Google packages. Resolve it from the package itself, so it is the same copy.
async function googleAuth(settings, load) {
  try {
    return createRequire(requireHere.resolve(settings.package))("google-auth-library").GoogleAuth;
  } catch {
    return (await load("google-auth-library")).GoogleAuth;
  }
}

// A client for the configured service. The Google clients start looking for credentials as soon as they are built and
// do not handle a failure, which would stop the whole server; so RegChain finds the credentials first and hands them over.
export async function createClaude({ load = name => import(name) } = {}) {
  const settings = claudeSettings();
  const missing = settings.problems[0] ?? (settings.missing.length ? setupMessage(settings, true) : null);
  if (missing) throw new Error(missing);
  const provider = PROVIDERS[settings.provider];
  let mod;
  try {
    mod = await load(settings.package);
  } catch {
    throw new Error(setupMessage(settings, false));
  }
  if (provider.google) {
    const GoogleAuth = await googleAuth(settings, load);
    let authClient;
    try {
      authClient = await new GoogleAuth({ scopes: GOOGLE_SCOPE }).getClient();
    } catch (error) {
      throw new Error(`${settings.label} needs Google credentials: run "gcloud auth application-default login" on this computer, attach a service account to the server, or set GOOGLE_APPLICATION_CREDENTIALS. (${error.message})`);
    }
    return provider.create(mod, authClient);
  }
  if (settings.provider === "foundry" && !present(process.env, "ANTHROPIC_FOUNDRY_API_KEY")) {
    // No key: sign in with Microsoft Entra ID (a managed identity, a service principal or az login).
    let identity;
    try {
      identity = await load("@azure/identity");
    } catch {
      throw new Error("Microsoft Foundry needs ANTHROPIC_FOUNDRY_API_KEY in the .env file, or the package @azure/identity to sign in with Microsoft Entra ID: run npm install @azure/identity in the RegChain folder, then restart RegChain.");
    }
    return provider.create(mod, identity.getBearerTokenProvider(new identity.DefaultAzureCredential(), AZURE_SCOPE));
  }
  return provider.create(mod);
}

// For records and screens: which service and which models a live run used.
export function liveModels(settings = claudeSettings()) {
  return { orchestrator: settings.models.orchestrator, specialists: settings.models.specialist, service: settings.label };
}

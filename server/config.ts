// Config + data dirs. One file, ~/.opengrokbot/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { InstanceConfigMap } from "./contracts.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  composio?: { key?: string; url?: string };
  box?: { token?: string };
  instances?: InstanceConfigMap;
}

export const DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");

export function ensureDirs() {
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) mkdirSync(dir, { recursive: true });
}

export function loadConfig(): AppConfig {
  let cfg: AppConfig = {};
  try {
    cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
  } catch {
    /* first run — env fallbacks below */
  }
  cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
  cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
  cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  return cfg;
}

// Default fleet: one instance per built-in driver (t3code
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  if (cfg.instances && Object.keys(cfg.instances).length) return cfg.instances;
  return {
    grok: { driver: "grok" },
    claude: { driver: "claudeAgent" },
    codex: { driver: "codex" },
    computer: { driver: "boxAgent" },
  };
}

// Claude driver — upstream ClaudeDriver skeleton over agentcal's
// drivers/claude.js runtime (stream-json both directions, prompt over
// stdin, completion from a real `result` event — verified against
// claude 2.1.211 by agentcal). Per-turn CLI process; the conversation
// continues across turns via --resume <sessionId> (the resumeCursor).
//
// Integrations become MCP servers on the CLI:
//   - Composio Connect (connected apps → tools) over streamable HTTP
//   - the bot's cloud computer (box.ascii.dev) via server/computer-proxy.ts
//     — screenshot/exec/open_url, the CUA-on-the-box bridge
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { appendNative } from "./native.ts";

const DRIVER_KIND = "claudeAgent";

export interface ClaudeConfig {
  cli: string;
  permissionMode: "acceptEdits" | "auto" | "bypassPermissions";
}

// model catalog ported from upstream packages/contracts/src/model.ts
const MODELS = {
  default: "claude-sonnet-5",
  options: [
    { id: "claude-fable-5", label: "Claude Fable 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

const PROXY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "computer-proxy.ts");

function decodeConfig(raw: unknown): ClaudeConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const mode = o.permissionMode;
  if (mode !== undefined && mode !== "acceptEdits" && mode !== "auto" && mode !== "bypassPermissions") {
    throw new Error(`claude: invalid permissionMode ${JSON.stringify(mode)}`);
  }
  return {
    cli: typeof o.cli === "string" ? o.cli : "claude",
    permissionMode: (mode as ClaudeConfig["permissionMode"]) ?? "acceptEdits",
  };
}

function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text" && b.text)
      .map((b) => b.text)
      .join("");
  }
  return "";
}

export const ClaudeDriver: ProviderDriver<ClaudeConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Claude", supportsMultipleInstances: true },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<ClaudeConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const listeners = new Set<RuntimeEventListener>();
    // one active turn per thread; a second send while busy is a caller bug
    const active = new Map<string, { stop: () => void; turnId: string }>();

    const emit = (event: RuntimeEvent) => {
      for (const l of [...listeners]) l(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const sendTurn = async (turn: SendTurnInput) => {
      const { threadId } = turn;
      if (active.has(threadId)) throw new Error("a turn is already running on this thread");
      const turnId = newId();
      const sessionId = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
      const newSessionId = sessionId ? null : newId();

      const args = [
        "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose", // required by stream-json output
        "--permission-mode", config.permissionMode === "auto" ? "acceptEdits" : config.permissionMode,
      ];
      if (sessionId) args.push("--resume", sessionId);
      else args.push("--session-id", newSessionId!);
      if (turn.model) args.push("--model", turn.model);
      if (turn.system) args.push("--append-system-prompt", turn.system);

      // integrations → MCP servers; pre-allow their tools (a headless
      // acceptEdits run silently denies anything unlisted)
      const mcpServers: Record<string, unknown> = {};
      const allowed: string[] = [];
      if (turn.integrations?.composio?.key) {
        mcpServers.composio = {
          type: "http",
          url: turn.integrations.composio.url || "https://connect.composio.dev/mcp",
          headers: { "x-consumer-api-key": turn.integrations.composio.key },
        };
        allowed.push("mcp__composio");
      }
      if (turn.integrations?.computer) {
        mcpServers.computer = {
          command: process.execPath,
          args: [PROXY_PATH],
          env: {
            OGB_BOX_ID: turn.integrations.computer.boxId,
            OGB_BOX_TOKEN: turn.integrations.computer.token,
          },
        };
        allowed.push("mcp__computer");
      } else if (turn.integrations?.localComputer) {
        // this Mac, via the Electron-owned cua-driver daemon (spawn config
        // read from cua-connection.json — same "computer" name either way,
        // the agent just sees a computer)
        mcpServers.computer = { ...turn.integrations.localComputer };
        allowed.push("mcp__computer");
      }
      if (Object.keys(mcpServers).length) {
        args.push("--mcp-config", JSON.stringify({ mcpServers }));
        args.push("--allowedTools", allowed.join(","));
      }

      const env: Record<string, string | undefined> = { ...process.env, NPM_CONFIG_LOGLEVEL: "error" };
      // subscription users get billed pay-as-you-go if this leaks through;
      // and a nested CLI must not inherit this session's identity (agentcal)
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;

      const child = spawn(config.cli, args, {
        cwd: turn.cwd ?? homedir(),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true, // own process group: killing -pid reaps child MCP servers
      });

      let settled = false;
      const settle = (ok: boolean, stopReason: string | null, cost: number | null = null) => {
        if (settled) return;
        settled = true;
        active.delete(threadId);
        emit({ ...base(threadId, turnId), type: "turn.completed", ok, stopReason, cost });
      };

      const handleLine = (line: string) => {
        let o: any;
        try {
          o = JSON.parse(line);
        } catch {
          return;
        }
        appendNative(threadId, { dir: "in", source: "claude.sdk.message", msg: o });
        switch (o.type) {
          case "system":
            if (o.subtype === "init") {
              emit({ ...base(threadId, turnId), type: "session.started", sessionId: o.session_id, model: o.model });
            } else if (o.subtype === "thinking_tokens") {
              emit({ ...base(threadId, turnId), type: "item.updated", itemType: "reasoning", tokens: o.estimated_tokens });
            }
            break;
          case "assistant": {
            const msg = o.message ?? {};
            const text = firstText(msg.content);
            if (text.trim()) {
              emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: text });
              emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
            }
            for (const b of Array.isArray(msg.content) ? msg.content : []) {
              if (b.type === "tool_use") {
                emit({ ...base(threadId, turnId), type: "item.started", itemType: "tool", itemId: b.id, title: b.name });
              }
            }
            if (msg.usage) {
              emit({
                ...base(threadId, turnId),
                type: "thread.token-usage.updated",
                input: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0),
                output: msg.usage.output_tokens || 0,
              });
            }
            break;
          }
          case "user":
            for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
              if (b.type === "tool_result") {
                emit({ ...base(threadId, turnId), type: "item.completed", itemType: "tool", itemId: b.tool_use_id, ok: !b.is_error });
              }
            }
            break;
          case "result":
            settle(o.is_error !== true, o.stop_reason ?? o.terminal_reason ?? null, o.total_cost_usd ?? null);
            break;
        }
      };

      let buf = "";
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim()) handleLine(line);
        }
      });

      let stderr = "";
      child.stderr.on("data", (c) => {
        stderr += c;
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });

      child.on("error", (e) => {
        emit({ ...base(threadId, turnId), type: "runtime.error", message: `spawn failed: ${e.message}` });
        settle(false, "spawn_error");
      });

      child.on("close", (code) => {
        if (!settled) {
          emit({
            ...base(threadId, turnId),
            type: "runtime.error",
            message: `claude exited ${code} before result${stderr ? `: ${stderr.trim().slice(-300)}` : ""}`,
          });
          settle(false, "exit_before_result");
        }
      });

      const stop = () => {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          try {
            child.kill("SIGTERM");
          } catch {}
        }
      };
      active.set(threadId, { stop, turnId });
      emit({ ...base(threadId, turnId), type: "turn.started" });

      // prompt over stdin as a stream-json message — never argv (ARG_MAX)
      const promptMsg = { type: "user", message: { role: "user", content: turn.text } };
      child.stdin.write(JSON.stringify(promptMsg) + "\n");
      child.stdin.end();
      appendNative(threadId, { dir: "out", source: "claude.sdk.message", msg: promptMsg });

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      const version = await new Promise<string | null>((resolve) => {
        execFile(config.cli, ["--version"], { timeout: 8000 }, (err, stdout) =>
          resolve(err ? null : stdout.trim()),
        );
      });
      if (!version) return { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };
      const authenticated = existsSync(join(homedir(), ".claude", ".credentials.json"));
      return { state: "available", version, authenticated };
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      models: MODELS,
      snapshot,
      adapter: {
        provider: DRIVER_KIND,
        capabilities: { sessionModelSwitch: "in-session" },
        sendTurn,
        interruptTurn: async (threadId) => active.get(threadId)?.stop(),
        respondToRequest: async () => {
          throw new Error("claude driver has no pending asks (permission broker not wired)");
        },
        hasSession: (threadId) => active.has(threadId),
        stopAll: async () => {
          for (const { stop } of active.values()) stop();
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      generateText: (prompt: string) =>
        new Promise((resolve, reject) => {
          execFile(
            config.cli,
            ["-p", prompt, "--model", "claude-haiku-4-5", "--output-format", "text"],
            { timeout: 60_000, env: { ...process.env } },
            (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
          );
        }),
      dispose: async () => {
        for (const { stop } of active.values()) stop();
        listeners.clear();
      },
    };
  },
};

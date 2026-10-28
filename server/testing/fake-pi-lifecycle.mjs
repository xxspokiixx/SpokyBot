#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const dump = (row) => appendFileSync(process.env.FAKE_PI_LIFECYCLE_DUMP, JSON.stringify(row) + "\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const reply = (command, data) => send({ type: "response", command, success: true, data });
const model = { provider: "fixture", id: "default" };

process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
createInterface({ input: process.stdin }).on("line", (line) => {
  const cmd = JSON.parse(line);
  if (cmd.type === "get_available_models") {
    process.stdout.write(JSON.stringify({ type: "response", command: cmd.type, success: true, data: { models: [model] } }) + "\n", () => process.exit(0));
  }
  if (["get_state", "new_session", "switch_session"].includes(cmd.type)) {
    reply(cmd.type, { sessionFile: "fixture-session.jsonl", model });
  }
  if (cmd.type === "set_model") {
    dump({ setModel: cmd.modelId });
    if (cmd.modelId === "refused") send({ type: "response", command: cmd.type, success: false, error: "Model unavailable" });
    else reply(cmd.type, { provider: "fixture", id: "confirmed" });
  }
  if (cmd.type === "prompt") {
    dump({ prompt: cmd.message, pid: process.pid });
    reply(cmd.type);
    send({ type: "tool_execution_start", toolCallId: "ready", toolName: "fixture" });
    if (cmd.message !== "wait") {
      send({ type: "turn_end", message: { stopReason: "end_turn" } });
      send({ type: "agent_end", isTerminal: true });
      send({ type: "agent_settled" });
    }
  }
});

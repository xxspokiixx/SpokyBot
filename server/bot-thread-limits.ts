// How many threads one bot runs at once. The number follows the machine this server runs on: on a phone with 3.8 GB the
// three concurrent engines of a fixed default are enough to make the kernel stop one, while a desktop with 32 GB can run
// far more.
import { boxMemory } from "./box-memory.ts";
import { engineMemory } from "./engine-memory.ts";
// The ceiling lives with the config schema that enforces it; one number in the codebase.
import { MAX_CONCURRENT_BOT_THREADS } from "./config.ts";

export { MAX_CONCURRENT_BOT_THREADS };
const DEFAULT_THREADS_FLOOR = 2, BYTES_PER_DEFAULT_THREAD = 2 * 1024 ** 3;

/** Where the memory gate runs it decides, so only the ceiling applies; elsewhere nothing protects the machine. */
export interface BotThreadsHost { memoryGate: boolean; totalBytes: number; oneThreadPerBot: boolean }
type SavedThreads = { threads?: { maxConcurrentPerBot?: number } };

/** The memory this server may use: its container's limit where one is set, not the machine's. */
export const botThreadsHost = (oneThreadPerBot = false): BotThreadsHost => ({ memoryGate: engineMemory.enabled, totalBytes: boxMemory().bytes, oneThreadPerBot });

export function defaultBotThreads(host: Pick<BotThreadsHost, "memoryGate" | "totalBytes"> = botThreadsHost()): number {
  if (host.memoryGate) return MAX_CONCURRENT_BOT_THREADS;
  return Math.min(MAX_CONCURRENT_BOT_THREADS, Math.max(DEFAULT_THREADS_FLOOR, Math.round(host.totalBytes / BYTES_PER_DEFAULT_THREAD)));
}

/** Separate work a person or a routine starts. A plan's limit outranks a saved number. */
export function maxConcurrentBotThreadsFor(cfg: SavedThreads, host: BotThreadsHost = botThreadsHost()): number {
  if (host.oneThreadPerBot) return 1;
  return cfg.threads?.maxConcurrentPerBot ?? defaultBotThreads(host);
}

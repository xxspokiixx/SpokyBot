import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GroupThreadUsage } from "../shared/wire.ts";

type Row = { at: string; threadId: string; botId: string; botName?: string; input: number; output: number; cachedInput?: number; costUsd?: number | null };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const valid = (row: Partial<Row> | null): row is Row => Boolean(row && typeof row.threadId === "string" && typeof row.botId === "string" && typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) && finite(row.input) && finite(row.output));

/** Read existing accounting records, never chat text. Reuse parsed months until
 * their file stamps change, including after append, truncation or replacement. */
export class GroupUsageReader {
  private files = new Map<string, { stamp: string; rows: Row[] }>();
  private signature = "";
  private totals = new Map<string, GroupThreadUsage>();
  private dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }

  forThread(threadId: string): GroupThreadUsage | undefined {
    const dir = join(this.dataDir, "usage");
    let names: string[];
    try { names = readdirSync(dir).filter(name => /^\d{4}-\d{2}\.jsonl$/.test(name)).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      names = [];
    }
    const files = names.map(name => {
      const stat = statSync(join(dir, name));
      return { name, stamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}` };
    });
    const signature = JSON.stringify(files);
    if (signature !== this.signature) {
      const next = new Map<string, { stamp: string; rows: Row[] }>();
      const rows: Row[] = [];
      for (const { name, stamp } of files) {
        let entry = this.files.get(name);
        if (entry?.stamp !== stamp) {
          const parsed: Row[] = [];
          for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
            try { const row = JSON.parse(line); if (valid(row)) parsed.push(row); } catch { /* incomplete or damaged row */ }
          }
          entry = { stamp, rows: parsed };
        }
        next.set(name, entry);
        for (const row of entry.rows) rows.push(row);
      }
      rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const totals = new Map<string, GroupThreadUsage>();
      for (const row of rows) {
        const total = totals.get(row.threadId) ?? { input: 0, output: 0, costUsd: null, turns: 0, cachedInput: 0 };
        const input = Math.trunc(row.input), output = Math.trunc(row.output);
        const cached = finite(row.cachedInput) ? Math.min(input, Math.trunc(row.cachedInput)) : undefined;
        total.input += input;
        total.output += output;
        total.turns++;
        // Unknown cache usage in any turn makes the cumulative split unknown.
        if (cached === undefined) delete total.cachedInput;
        else if (total.cachedInput !== undefined) total.cachedInput += cached;
        if (finite(row.costUsd)) total.costUsd = (total.costUsd ?? 0) + row.costUsd;
        total.lastTurn = { input, output, ...(cached === undefined ? {} : { cachedInput: cached }), costUsd: finite(row.costUsd) ? row.costUsd : null };
        total.lastSpeaker = { botId: row.botId, name: typeof row.botName === "string" && row.botName ? row.botName : row.botId };
        totals.set(row.threadId, total);
      }
      this.files = next;
      this.totals = totals;
      this.signature = signature;
    }
    const usage = this.totals.get(threadId);
    return usage ? structuredClone(usage) : undefined;
  }
}

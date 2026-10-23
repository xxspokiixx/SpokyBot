// The members a Team Cloud has seen: each one the Admin paired, with their role, kept in team-people.json. The Admin
// holds the real roster and this machine never reads it, so a removed member stays listed here; this list only offers
// who a bot can report to.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { ownerEmail } from "../shared/bot-owner.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { TeamRole } from "./cloud-team.ts";

export const TEAM_PEOPLE_FILE = "team-people.json";
const MAX_PEOPLE = 500;

const personSchema = z.object({
  email: z.string().min(3).max(254),
  role: z.enum(["owner", "admin", "member"]),
  firstSeenAt: z.number().finite().nonnegative(),
  lastSeenAt: z.number().finite().nonnegative(),
});
const fileSchema = z.object({ version: z.literal(1), people: z.array(personSchema).max(MAX_PEOPLE) });

export type TeamPerson = z.infer<typeof personSchema>;

export function createTeamPeople(dataDir: string, now: () => number = Date.now) {
  const file = join(dataDir, TEAM_PEOPLE_FILE);
  let people: TeamPerson[] = [];
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) people = parsed.data.people;
    else console.warn(`team people: ${file} is not a people file; starting fresh`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`team people: ${file} is unreadable; starting fresh`);
  }
  const save = () => {
    try {
      writeFileAtomic(file, `${JSON.stringify({ version: 1, people })}\n`, { mode: 0o600 });
    } catch (error) {
      console.warn(`team people: could not save ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return {
    /** The Admin vouched for this member just now. */
    seen(email: string, role: TeamRole): void {
      const address = ownerEmail(email);
      const at = now();
      const known = people.find((person) => person.email === address);
      if (known && known.role === role && at - known.lastSeenAt < 60_000) return;
      people = [
        { email: address, role, firstSeenAt: known?.firstSeenAt ?? at, lastSeenAt: at },
        ...people.filter((person) => person.email !== address),
      ].slice(0, MAX_PEOPLE);
      save();
    },
    has(email: string): boolean {
      const address = ownerEmail(email);
      return people.some((person) => person.email === address);
    },
    list(): TeamPerson[] {
      return [...people].sort((a, b) => a.email.localeCompare(b.email));
    },
  };
}

export type TeamPeople = ReturnType<typeof createTeamPeople>;


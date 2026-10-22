// "About you" on a Team Cloud: one record per person (people/<person>/about.json), read into that person's own turns
// only. The server's one profile (config.json's aboutMe) describes the owner of a My Cloud, and on a team never anyone.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

export const ABOUT_ME_MAX = 4_000;
const PERSON = /^p_[\w-]{22}$/;
const record = z.object({ version: z.literal(1), aboutMe: z.string().max(ABOUT_ME_MAX * 2) }).strict();

export interface PeopleAbout {
  read(person: string): string;
  write(person: string, aboutMe: string): string;
}

export function createPeopleAbout(dataDir: string): PeopleAbout {
  const file = (person: string) => {
    if (!PERSON.test(person)) throw new Error("not a person key");
    return join(dataDir, "people", person, "about.json");
  };
  return {
    read(person) {
      try {
        const path = file(person);
        if (!existsSync(path)) return "";
        return record.parse(JSON.parse(readFileSync(path, "utf8"))).aboutMe.slice(0, ABOUT_ME_MAX);
      } catch {
        return "";
      }
    },
    write(person, aboutMe) {
      const path = file(person);
      const text = aboutMe.replace(/\r\n/g, "\n").trim().slice(0, ABOUT_ME_MAX);
      mkdirSync(join(dataDir, "people", person), { recursive: true, mode: 0o700 });
      writeFileAtomic(path, JSON.stringify({ version: 1, aboutMe: text }) + "\n", { mode: 0o600 });
      return text;
    },
  };
}

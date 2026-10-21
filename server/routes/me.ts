// GET and PUT /api/me: a person's own "About you" on a Team Cloud (people-about.ts), read into their own turns only.
// Anywhere else the server's one profile (Settings → Profile) is the person's, and this answers 404.
import type { CloudTeam } from "../cloud-team.ts";
import { ABOUT_ME_MAX, type PeopleAbout } from "../people-about.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MeRouteDeps {
  team: CloudTeam | null;
  people: PeopleAbout;
  person(auth: RequestAuth): string | null;
}

export function createMeRoutes(deps: MeRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/me") return PASS;
    if (!deps.team) return json(res, 404, { error: "not found" });
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Sign in to this team to have an About you." });
    if (method === "GET") return json(res, 200, { team: { id: deps.team.id, name: deps.team.name }, aboutMe: deps.people.read(person) });
    if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req, 64 * 1024);
    const aboutMe = body && typeof body === "object" ? (body as { aboutMe?: unknown }).aboutMe : undefined;
    if (typeof aboutMe !== "string") return json(res, 400, { error: "send { aboutMe }: a few lines about you" });
    if (aboutMe.length > ABOUT_ME_MAX * 2) return json(res, 400, { error: `About you is at most ${ABOUT_ME_MAX} characters` });
    return json(res, 200, { team: { id: deps.team.id, name: deps.team.name }, aboutMe: deps.people.write(person, aboutMe) });
  };
}

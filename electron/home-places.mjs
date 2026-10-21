// The places one window can show besides My Cloud: each team the verified session lists. Main keeps them as saved
// places (environments.cjs `team` entries, so the window's navigation rules know their addresses) and here what else
// the switcher needs: the place to open next time, which teams' first-open line this device has shown, and the one
// line waiting for the next page (a team this person is no longer in). Nothing here comes from a page: the list of
// teams is the Admin's session's, read by main.
import environments from "./environments.cjs";

const MAX_TOLD = 200;

/**
 * @param {{
 *   store: { read(): unknown, write(value: unknown): void },
 *   environments(): { environments: any[], activeId: string },
 *   persist(state: unknown): void,
 *   makeId(): string,
 *   homeOrigin(): string | null,
 *   log?(line: string): void,
 * }} deps `store`: this app's home-place.json (`{ team, told }`); `environments()` / `persist()`: the saved places and
 * their file; `homeOrigin()`: My Cloud's verified origin, the place the window falls back to.
 */
export function createHomePlaces({ store, environments: read, persist, makeId, homeOrigin, log = () => {} }) {
  let cached = null;
  const pending = [];
  function load() {
    try {
      const record = store.read();
      const told = Array.isArray(record?.told) ? record.told.filter((id) => typeof id === "string").slice(-MAX_TOLD) : [];
      return { team: typeof record?.team === "string" ? record.team : null, told };
    } catch { return { team: null, told: [] }; }
  }
  const current = () => (cached ??= load());
  function save(next) {
    cached = next;
    try { store.write(next); } catch (error) { log(`home places: could not save (${error?.message ?? error})`); }
  }
  const entryOf = (id) => read().environments.find((entry) => entry.team?.id === id) ?? null;
  const places = {
    /** The team shown last time, as saved: its id, and its name and address while it is still a saved place. */
    remembered() {
      const id = current().team;
      if (!id) return null;
      const entry = entryOf(id);
      return entry ? { team: id, name: entry.name, origin: entry.origin } : { team: id };
    },
    /** What the window opens next time: a team (`{ team }`), or My Cloud (null). */
    remember(place) {
      const team = typeof place?.team === "string" ? place.team : null;
      if (team !== current().team) save({ ...current(), team });
    },
    /** The team shown is no longer this person's: said once, on the next page that asks. */
    left(name) {
      if (typeof name === "string" && name && !pending.includes(name)) pending.push(name);
    },
    /** The MausBot Cloud sign-in changed: a connected session's teams are the saved team places (one it no longer
     * lists is gone, with its name for the line); anything else changes nothing. */
    sync(state) {
      if (state?.status !== "connected") return;
      const teams = Array.isArray(state.teams) ? state.teams : [];
      const { state: next, left } = environments.reconcileTeams(read(), teams, makeId, homeOrigin());
      if (next !== read()) persist(next);
      for (const name of left) places.left(name);
      if (current().team && !teams.some((team) => team?.id === current().team)) places.remember(null);
    },
    /** The one line for the page at `origin`, served once: that a team is gone (any page), or, on a team's page the
     * first time on this device, that its admins can see private chats with its bots. */
    line(origin) {
      if (pending.length) return { kind: "left", name: pending.shift() };
      const entry = origin ? read().environments.find((candidate) => candidate.team && candidate.origin === origin) ?? null : null;
      if (!entry || current().told.includes(entry.team.id)) return null;
      save({ ...current(), told: [...current().told, entry.team.id].slice(-MAX_TOLD) });
      return { kind: "private", name: entry.name };
    },
  };
  return places;
}

/** Lazy exclusive claims for auto-resolved Local VM attaches (issue #1361).
 * The table is keyed by thread and owned by the dispatch generation; the
 * claim closure itself lives in index.ts next to the turn state it needs.
 * Kept free of index.ts imports so the fire-once semantics stay unit-testable. */

export interface AutoVmClaimOwner {
  threadId: string;
  generation: string;
}

export interface AutoVmClaimSlot {
  owner: AutoVmClaimOwner;
  /** Runs the exclusive claim sequence: bind, lease, boot. At most once. */
  claim: () => Promise<void>;
  /** Set by startAutoVmClaim; presence means the claim already fired. */
  begin?: Promise<void>;
}

export type AutoVmClaimTable = Map<string, AutoVmClaimSlot>;

/** Fire a thread's lazy claim exactly once, fenced by the dispatch
 * generation. A failed claim clears the slot so later polls fail closed
 * (the capability dies and the bridge treats the computer as held)
 * instead of wedging a claim that can never succeed. A rejection only
 * clears the slot it fired from, so a stale claim can never remove a
 * newer generation's slot on the same thread. */
export function startAutoVmClaim(table: AutoVmClaimTable, threadId: string, generation: string): void {
  const slot = table.get(threadId);
  if (!slot || slot.owner.threadId !== threadId || slot.owner.generation !== generation || slot.begin) return;
  slot.begin = slot.claim().then(
    () => undefined,
    () => { if (table.get(threadId) === slot) table.delete(threadId); },
  );
}

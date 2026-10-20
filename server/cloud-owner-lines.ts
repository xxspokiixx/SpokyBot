// A conversation that comes to the person's own Cloud from their computer, over the owner's own session: the lines its
// owner wrote there name nobody, and on a Cloud home a conversation with a line that names nobody can never use the lent
// Mac or feed memory (cloud-lending.ts), so each such line, and each card answered there, is stamped as the owner's.
import type { CardAnswerer, WireMessage as Message } from "../shared/wire.ts";
import { BLOCK_OPEN as APP_EVENT_DATA } from "./app-events.ts";
import { answeredByPerson } from "./cloud-lending.ts";
import { routinePrompt } from "./routine-execution.ts";
import { WEBHOOK_EVENT_DATA } from "./webhooks.ts";

/** My Cloud's owner as the owner's own session is: their person key, and the name their lines read as. */
export interface CloudOwner { person: string; name: string }

/** Security invariant: only a user line nobody else's words or no automation made. A peer's ask or aside, a line a
 * script or an outside interface relayed, and a routine's, webhook's or app event's own prompt are never the owner's,
 * however they arrive; a webhook's post is a bot's line. */
export function ownersOwnLine(row: Message): boolean {
  if (row.role !== "user" || row.sender || row.peerAsk || row.aside || row.relayed || row.via === "api") return false;
  const text = typeof row.text === "string" ? row.text : "";
  return !routinePrompt(text) && !text.includes(WEBHOOK_EVENT_DATA) && !text.includes(APP_EVENT_DATA);
}

/** Security invariant: a card counts as the owner's only when the owner answered it in that computer's own window. */
function answeredInWindow(card: NonNullable<Message["card"]>): boolean {
  return answeredByPerson(card) && (!card.answeredBy || card.answeredBy.kind === "loopback");
}

/** A bot conversation's rows as My Cloud keeps them: the owner's own lines and answers carry the owner. */
export function stampOwner(rows: readonly Message[], owner: CloudOwner): Message[] {
  const sender = { name: owner.name, id: owner.person };
  return rows.map((row) => {
    let stamped = ownersOwnLine(row) ? { ...row, sender } : row;
    if (row.card && answeredInWindow(row.card)) {
      const answeredBy: CardAnswerer = { kind: "session", name: owner.name, person: owner.person, ...(row.card.answeredBy?.via ? { via: row.card.answeredBy.via } : {}) };
      stamped = { ...stamped, card: { ...row.card, answeredBy } };
    }
    return stamped;
  });
}

import { createHash } from "node:crypto";
const hashed = (basis) => `p_${createHash("sha256").update(basis).digest("base64url").slice(0, 22)}`;
/** Hashed, so a message or a thread can carry it without handing other members a session id. */
export function personKey(session) {
    return hashed(session.email ? `email:${session.email.trim().toLowerCase()}` : `session:${session.id}`);
}
/** A person another app relays (the Slack worker's onBehalfOf): the key their own session would have, by email,
 * or one by name when the app knows no email. */
export function relayedPersonKey(person) {
    return person.email ? personKey({ id: "", email: person.email }) : hashed(`name:${(person.name ?? "").trim()}`);
}

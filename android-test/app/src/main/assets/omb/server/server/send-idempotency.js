import { z } from "zod";
const sendIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,80}$/).optional();
export function parseSendId(value) {
    const parsed = sendIdSchema.safeParse(value);
    if (!parsed.success) {
        throw Object.assign(new Error("sendId must be a client-generated id"), { status: 400 });
    }
    return parsed.data;
}
export function acceptedSendMatch(messages, sendId, text, replyToId, channelMode) {
    const message = messages.find((candidate) => candidate.sendId === sendId);
    if (!message)
        return { kind: "none" };
    if (message.role !== "user" ||
        message.kind !== "text" ||
        message.text !== text ||
        message.replyToId !== replyToId ||
        (message.channelMode ?? "chat") !== (channelMode ?? "chat")) {
        return { kind: "conflict" };
    }
    return { kind: "match", message };
}
export class SendSequencer {
    inFlight = new Map();
    async run(key, fingerprint, work) {
        if (!key)
            return work();
        const existing = this.inFlight.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
            }
            // SAFETY: one key is one endpoint receipt, so every coalesced caller shares the owner's result type.
            return existing.result;
        }
        const current = work();
        const entry = { fingerprint, result: current };
        this.inFlight.set(key, entry);
        const clear = () => {
            if (this.inFlight.get(key) === entry)
                this.inFlight.delete(key);
        };
        void current.then(clear, clear);
        return current;
    }
}
export function sendFingerprint(text, replyToId, channelMode) {
    return JSON.stringify([text, replyToId ?? null, channelMode ?? null]);
}

/** Pending check-backs a conversation and a bot may hold, and how near and far one may be set. */
export const CHECK_BACK_LIMITS = {
    perConversation: 10,
    perBot: 50,
    minMs: 60_000,
    maxMs: 90 * 24 * 60 * 60_000,
};

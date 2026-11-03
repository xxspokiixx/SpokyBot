import { PAGE_ID } from "../../shared/published-page.js";
import { redactSecretsInText } from "../../shared/redact.js";
import { PageBundleError, pageSource, readPageBundle } from "./bundle.js";
const TITLE_MAX = 200;
const TITLE_REQUIRED = { status: 400, text: "title is required: a short name for the page." };
const pageTitle = (raw) => redactSecretsInText(raw.trim()).slice(0, TITLE_MAX);
const usageWords = (usage) => `${usage.pages} of ${usage.limit} pages`;
/** The message text every client shows, the card's own words for one that doesn't draw it. */
export function cardText(card) {
    if (card.state === "limit")
        return card.message ?? "This account's pages are used up.";
    if (card.state === "unpublished")
        return `Unpublished “${card.title}”. Its link no longer opens.`;
    return `Published “${card.title}”: ${card.url}${card.usage ? ` (${usageWords(card.usage)})` : ""}`;
}
const failureStatus = { sign_in: 403, limit: 402, rate_limited: 429, gone: 410, refused: 400, unavailable: 503 };
export function createPagePublisher(deps) {
    const { client, store } = deps;
    const markUnpublished = (pageId, usage) => {
        const record = store.forget(pageId);
        if (!record)
            return null;
        const card = { state: "unpublished", title: record.title, pageId, url: record.url, ...(usage ? { usage } : {}) };
        for (const shown of record.cards) {
            try {
                deps.patch(shown.threadId, shown.messageId, cardText(card), card);
            }
            catch { /* A conversation deleted since keeps nothing to re-draw. */ }
        }
        return card;
    };
    const pages = {
        async publish(input) {
            if (!pageTitle(input.title))
                return TITLE_REQUIRED;
            if (input.pageId !== undefined && !PAGE_ID.test(input.pageId))
                return { status: 400, text: "page_id must be the id of a page you published, from its link." };
            let bundle;
            try {
                bundle = await readPageBundle(input.path, input.roots);
            }
            catch (error) {
                if (error instanceof PageBundleError)
                    return { status: error.status, text: error.message };
                throw error;
            }
            return publishBundle(input, bundle);
        },
        /** A page built here rather than read from a folder (a chat page the person publishes from the preview); `source`
         * keeps its link across publishes. */
        async publishFiles(input) {
            return publishBundle(input, { source: input.source, files: input.files, bytes: input.files.reduce((sum, file) => sum + file.data.byteLength, 0), skipped: [] });
        },
    };
    async function publishBundle(input, bundle) {
        const title = pageTitle(input.title);
        if (!title)
            return TITLE_REQUIRED;
        const remembered = input.pageId ? store.get(input.pageId) : store.fromSource(input.botId, bundle.source);
        const target = input.pageId ?? remembered?.pageId;
        let result = await client.publish({ title, files: bundle.files, ...(target ? { pageId: target } : {}) });
        // The page this folder was published to before is gone (unpublished, or taken down): it gets a new link.
        if (!result.ok && result.reason === "gone" && !input.pageId && target) {
            store.forget(target);
            result = await client.publish({ title, files: bundle.files });
        }
        if (!result.ok) {
            if (result.reason === "limit") {
                const card = { state: "limit", title, message: result.message, ...(result.usage ? { usage: result.usage } : {}), ...(result.upgrade ? { upgrade: true } : {}),
                    ...(result.plan ? { plan: result.plan } : {}) };
                input.post(cardText(card), card);
                return { status: 402, text: `${result.message} Tell the person this in your reply.`, card };
            }
            return { status: failureStatus[result.reason], text: result.message };
        }
        const card = { state: "live", title, pageId: result.pageId, url: result.url, usage: result.usage };
        const messageId = input.post(cardText(card), card, bundle);
        store.published({ pageId: result.pageId, url: result.url, title, botId: remembered?.botId ?? input.botId, source: bundle.source,
            card: messageId ? { threadId: input.threadId, messageId } : null });
        const updated = Boolean(target) && result.pageId === target;
        const lines = [
            updated ? `Updated “${title}” at the same link: ${result.url}` : `Published “${title}” at ${result.url}`,
            `Page id ${result.pageId}. This account now has ${usageWords(result.usage)}.`,
            "A card with the link, Copy link and Unpublish is in the chat. Publishing the same file or folder again updates this same link.",
            ...(result.badge ? ["Free pages carry a small “Made with SpokyBot” badge."] : []),
            ...(bundle.skipped.length ? [`Left out ${bundle.skipped.length} file${bundle.skipped.length === 1 ? "" : "s"} a page can't serve: ${bundle.skipped.slice(0, 5).join(", ")}${bundle.skipped.length > 5 ? ", …" : ""}.`] : []),
        ];
        return { status: 200, text: lines.join("\n"), card };
    }
    return {
        ...pages,
        /** Takes a page down, by its id or the file or folder it came from (with the bot's folders). */
        async unpublish(input) {
            let pageId = input.pageId;
            if (pageId !== undefined && !PAGE_ID.test(pageId))
                return { status: 400, text: "page_id must be the id of a page you published, from its link." };
            if (!pageId && input.path && input.botId && input.roots) {
                try {
                    pageId = store.fromSource(input.botId, await pageSource(input.path, input.roots))?.pageId;
                }
                catch (error) {
                    if (!(error instanceof PageBundleError))
                        throw error;
                }
                if (!pageId)
                    return { status: 404, text: `No page was published from ${input.path}. Pass the page_id from its link instead.` };
            }
            if (!pageId)
                return { status: 400, text: "Pass the page_id of the page to unpublish, or the path it was published from." };
            const title = store.get(pageId)?.title;
            const result = await client.unpublish(pageId);
            if (!result.ok && result.reason !== "gone")
                return { status: failureStatus[result.reason], text: result.message };
            const card = markUnpublished(pageId, result.ok ? result.usage : null)
                ?? { state: "unpublished", title: title ?? pageId, pageId, ...(result.ok && result.usage ? { usage: result.usage } : {}) };
            return { status: 200, text: result.ok ? `Unpublished${title ? ` “${title}”` : ""}. Its link no longer opens.` : "That page was already taken down.", card };
        },
    };
}

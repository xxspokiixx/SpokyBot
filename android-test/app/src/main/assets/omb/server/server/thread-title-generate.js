// One generated thread title: the engine's one-shot text call, given 10 seconds, its reply cleaned to a title or null.
import { titleFromLlm } from "./store.js";
import { threadTitlePrompt } from "./thread-title.js";
export async function generateThreadTitle(provider, text, source = "first-message") {
    const prompt = threadTitlePrompt(text, source);
    const expiry = new AbortController();
    let timer;
    try {
        const reply = await Promise.race([
            provider.generateText(prompt, { signal: expiry.signal }),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    expiry.abort();
                    reject(new Error("thread title timed out"));
                }, 10_000);
            }),
        ]);
        return titleFromLlm(reply);
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}

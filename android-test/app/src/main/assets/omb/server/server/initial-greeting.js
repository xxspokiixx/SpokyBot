/** The first bot's seeded line is created by the server before the UI exists. */
const GREETINGS = {
    en: (name) => `Hi, I'm ${name}. What would you like me to do?`,
    es: (name) => `Hola, soy ${name}. ¿Qué te gustaría que hiciera?`,
    "pt-br": (name) => `Oi, eu sou ${name}. O que você gostaria que eu fizesse?`,
};
export function initialGreeting(name, language) {
    let candidate = language?.trim().toLowerCase() || "en";
    while (candidate) {
        const greeting = GREETINGS[candidate];
        if (greeting)
            return greeting(name);
        const separator = candidate.lastIndexOf("-");
        if (separator < 0)
            break;
        candidate = candidate.slice(0, separator);
    }
    return GREETINGS.en(name);
}
/** The seeded message; a function language is read now, so a language changed in Settings reaches the next new bot. */
export function initialGreetingMessage(name, language) {
    return { role: "bot", kind: "text", text: initialGreeting(name, typeof language === "function" ? language() : language) };
}

/** SpokyBot: every person's built-in helper. A new install's first bot (its Chief of Staff too); an existing place or
 * person without one is given one once. It can be renamed and recoloured, hidden from the sidebar, never deleted. */
export const DEFAULT_BOT_NAME = "SpokyBot";
export const DEFAULT_BOT_COLOR = "chrome";
export const defaultBotPerson = (bot) => bot.defaultBot?.person?.trim().toLowerCase() ?? "";
/** The SpokyBot a viewer sees as theirs: their own on a Team Cloud (by email), else the place's. */
export function viewersDefaultBot(bots, email) {
    const person = email?.trim().toLowerCase() ?? "";
    return (person ? bots.find((bot) => bot.defaultBot && defaultBotPerson(bot) === person) : undefined)
        ?? bots.find((bot) => bot.defaultBot && !defaultBotPerson(bot));
}

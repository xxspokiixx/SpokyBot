// Security invariant: a Team Cloud member's SpokyBot never holds more than its member. Until the server says how to read
// members' roles, and whenever it cannot find one, a member's SpokyBot holds no Chief powers.
let roleOf = () => null;
export function readTeamRolesWith(resolver) {
    roleOf = resolver;
}
/** A Chief of Staff's powers: creating, configuring and deleting bots, rooms and routines through its tools, retrying a
 * teammate's thread, and its approval level passing down to the work it hands out. The Chief holds them, and so does the
 * person's SpokyBot (on a Team Cloud only when its member is an Owner or Admin). Being the Chief (the brief, incidents,
 * escalations, who answers a room) stays with `chiefOfStaff`. */
export function chiefLevel(bot) {
    if (!bot)
        return false;
    if (bot.chiefOfStaff === true)
        return true;
    if (!bot.defaultBot)
        return false;
    const person = bot.defaultBot.person?.trim().toLowerCase();
    if (!person)
        return true;
    const role = roleOf(person);
    return role === "owner" || role === "admin";
}

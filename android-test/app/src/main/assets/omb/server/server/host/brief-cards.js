// The server-built cards of the brief: the daily brief itself, meeting prep and the 10-minute reminder. Each is a widget
// the server writes and only the server may edit. Text from mail and invites is untrusted, so it is shown as plain Text
// and Caption nodes only, and a link becomes a button only when it is an https link with no username or password.
import { WEB_URL_MAX, WIDGET_LIMITS } from "../../shared/widget.js";
import { localDate, validZone } from "./check-plan.js";
import { clip, oneLine } from "./text-clip.js";
const DAY = 24 * 60 * 60_000;
const SUMMARY_MAX = 140;
const summary = (value) => oneLine(value, SUMMARY_MAX);
const zoneOf = (timeZone) => validZone(timeZone) ?? "UTC";
// ICU puts a narrow no-break space before AM/PM; cards and tests read plain spaces.
const plain = (text) => text.replace(/\s/g, " ");
const bareClock = (ms, timeZone) => plain(new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zoneOf(timeZone) }));
/** Labelled UTC when no zone is known. */
export function clockTime(ms, timeZone) {
    return validZone(timeZone) ? bareClock(ms, timeZone) : `${bareClock(ms, timeZone)} UTC`;
}
function dayLabel(start, timeZone, now) {
    const date = localDate(start, timeZone);
    if (date === localDate(now, timeZone))
        return "Today";
    if (date === localDate(now + DAY, timeZone))
        return "Tomorrow";
    return plain(new Date(start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zoneOf(timeZone) }));
}
export function meetingWhen(start, end, timeZone, now) {
    return `${dayLabel(start, timeZone, now)}, ${bareClock(start, timeZone)} to ${clockTime(end, timeZone)}`;
}
export function attendeeNames(event) {
    const others = event.attendees.filter((attendee) => !attendee.self);
    const name = (attendee) => attendee.name ?? attendee.email.split("@")[0];
    if (others.length <= 1)
        return others[0] ? name(others[0]) : "your meeting";
    return `${name(others[0])} and ${others.length - 1} other${others.length === 2 ? "" : "s"}`;
}
export const gmailUrl = (threadId) => `https://mail.google.com/mail/#all/${encodeURIComponent(threadId)}`;
const button = (label, onClickAction, primary = false) => ({ type: "Button", label: clip(label, WIDGET_LIMITS.label), style: primary ? "primary" : "secondary", onClickAction });
function openUrl(url) {
    const payload = { url };
    return url.length <= WEB_URL_MAX && JSON.stringify(payload).length <= WIDGET_LIMITS.actionPayloadBytes ? { type: "open_url", payload } : undefined;
}
// Invites are untrusted, so only an https link without a username or password becomes a button.
export function httpsLink(url) {
    try {
        const parsed = url ? new URL(url) : undefined;
        return parsed?.protocol === "https:" && !parsed.username && !parsed.password && openUrl(parsed.href) ? parsed.href : undefined;
    }
    catch {
        return undefined;
    }
}
const joinButton = (event) => {
    const link = httpsLink(event.joinUrl);
    const action = link ? openUrl(link) : undefined;
    return action ? [button("Join", action, true)] : [];
};
const buttons = (items) => (items.length ? [{ type: "Row", gap: 2, wrap: true, children: items }] : []);
const text = (value) => ({ type: "Text", value: clip(value, WIDGET_LIMITS.text) });
const caption = (value) => ({ type: "Caption", value: clip(value, 160) });
function root(title, subtitle, children) {
    return { type: "Card", id: "root", title: oneLine(title, WIDGET_LIMITS.title), ...(subtitle ? { caption: oneLine(subtitle, WIDGET_LIMITS.caption) } : {}), children };
}
const PREP_LINES = 60;
// The prep is AI text shaped by untrusted invites: plain Text nodes only, so no link, image or HTML can render.
function prepLines(prep) {
    const lines = clip(prep, WIDGET_LIMITS.markdown).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const shown = lines.length > PREP_LINES ? [...lines.slice(0, PREP_LINES - 1), lines.slice(PREP_LINES - 1).join(" ")] : lines;
    return shown.map((line) => text(line));
}
export function prepCard(input) {
    const { event } = input;
    const when = meetingWhen(event.start, event.end, input.timeZone, input.now);
    const where = event.location && event.location !== event.joinUrl ? ` · ${event.location}` : "";
    return {
        card: root(`Prep: ${event.title}`, `${when}${where}`, [...prepLines(input.prep), ...buttons(joinButton(event))]),
        summary: summary(`Prep ready: ${event.title}, ${when}`),
    };
}
export function reminderCard(input) {
    const { event } = input;
    const minutes = Math.max(1, Math.round((event.start - input.now) / 60_000));
    const title = `${event.title} with ${attendeeNames(event)} in ${minutes} minute${minutes === 1 ? "" : "s"}`;
    return { card: root(title, meetingWhen(event.start, event.end, input.timeZone, input.now), buttons(joinButton(event))), summary: summary(title) };
}
export const BRIEF_TITLE = "Your brief";
export const BRIEF_ROWS = 6;
export const DISMISS_ACTION = "dismiss_row";
export const DRAFT_ACTION = "draft_reply";
export const BRIEF_INTRO = "I keep an eye on your calendar and email and put what needs you here, once a day and when you come back. Tell me to stop, or what to watch for.";
const BRIEF_TEXT = { line: 120, note: 160, sender: 40, label: 32, link: 600 };
const NOTHING_NEEDS_YOU = "Nothing needs you right now.";
const NEEDS_YOU = "Needs you";
function senderName(rawFrom) {
    const from = rawFrom.slice(0, 300);
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/.exec(from);
    return match ? match[1].trim() || match[2].trim() : from.trim();
}
const sender = (email, max) => oneLine(senderName(email.from), max) || "(no sender)";
const rowLines = (value, note) => [{ type: "Text", value: clip(value, BRIEF_TEXT.line), weight: "medium" }, ...(note ? [caption(note)] : [])];
const rowBeside = (value, note, presses) => ({ type: "Row", gap: 3, align: "center", children: [{ type: "Col", flex: 1, children: rowLines(value, note) }, ...presses] });
const rowUnder = (value, note, presses) => ({ type: "Col", gap: 1, children: [...rowLines(value, note), ...buttons(presses)] });
function capped(rows, total) {
    const shown = rows.slice(0, BRIEF_ROWS);
    return total > shown.length ? [...shown, caption(`and ${total - shown.length} more`)] : shown;
}
const section = (title, rows, total, empty) => [{ type: "Title", value: title, size: "sm" }, ...(rows.length ? capped(rows, total) : empty ? [text(empty)] : [])];
const openButton = (target) => (target ? [button("Open", { type: "open_thread", payload: target })] : []);
const pageButton = (url) => { const link = httpsLink(url), open = link ? openUrl(link) : undefined; return open ? [button("Open page", open)] : []; };
function emailRow(email) {
    const who = sender(email, BRIEF_TEXT.label);
    const gmail = email.threadId.length <= BRIEF_TEXT.link ? openUrl(gmailUrl(email.threadId)) : undefined;
    const note = email.needsReply ? (email.why ? `Waiting on your reply · ${email.why}` : "Waiting on your reply") : email.why ?? "Important";
    return rowUnder(`${sender(email, BRIEF_TEXT.sender)}: ${email.subject || "(no subject)"}`, note, [
        button(`Draft a reply to ${who}`, { type: DRAFT_ACTION, payload: { messageId: email.messageId } }, true),
        ...(gmail ? [button("Open in Gmail", gmail)] : []),
        button(`Dismiss ${who}'s email`, { type: DISMISS_ACTION, payload: { messageId: email.messageId } }),
    ]);
}
const longDate = (now, timeZone) => plain(new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zoneOf(timeZone) }));
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
export function briefCard(facts) {
    const zone = facts.timeZone;
    const replies = facts.emails.filter((email) => email.needsReply);
    const important = facts.emails.filter((email) => !email.needsReply);
    const needRows = [...replies.map(emailRow), ...facts.needs.map((row) => rowBeside(row.text, row.note, openButton(row.open)))];
    const meetings = [...(facts.meetings ?? [])].sort((a, b) => a.start - b.start);
    const meetingRows = meetings.map((meeting) => rowBeside(`${clockTime(meeting.start, zone)} · ${meeting.title}`, "", joinButton(meeting)));
    const waiting = facts.waiting === true ? "More new emails than one check reads; I'll sort the rest next."
        : facts.waiting ? `${plural(facts.waiting, "more new email")} since you were away; I'll sort them next.` : undefined;
    const importantRows = [...important.map(emailRow), ...(waiting ? [caption(waiting)] : [])];
    const routineRows = facts.routines.map((row) => rowBeside(row.text, row.note, [...pageButton(row.page), ...openButton(row.open)]));
    const children = [
        ...(facts.intro ? [caption(BRIEF_INTRO)] : []),
        ...section(NEEDS_YOU, needRows, needRows.length, NOTHING_NEEDS_YOU),
        ...(facts.meetings === null ? [] : section("Your day", meetingRows, meetingRows.length, "No more meetings today.")),
        ...(importantRows.length ? section("Important emails", importantRows, importantRows.length) : []),
        ...(routineRows.length ? section("Routines", routineRows, routineRows.length) : []),
    ];
    const needCount = needRows.length;
    const parts = [
        needCount && `${needCount} ${needCount === 1 ? "needs" : "need"} you`,
        facts.meetings && facts.meetings.length && plural(facts.meetings.length, "meeting"),
        important.length && plural(important.length, "important email"),
        facts.routines.length && plural(facts.routines.length, "routine result"),
    ].filter(Boolean);
    return { card: root(BRIEF_TITLE, longDate(facts.now, zone), children), summary: summary(`${BRIEF_TITLE}: ${parts.length ? parts.join(", ") : "nothing needs you right now"}`) };
}

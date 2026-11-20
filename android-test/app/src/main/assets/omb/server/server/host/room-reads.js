// A Team Cloud's group chats are read per person: each person's own "read up to" line in each room
// (`room-reads.json`), so one person opening a room clears its unread mark for nobody else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.js";
import { personKey } from "../person-key.js";
const ROOM_READS_FILE = "room-reads.json";
const fileSchema = z.object({ version: z.literal(1), reads: z.record(z.string(), z.record(z.string(), z.string())) });
const NOT_A_REPLY = new Set(["activity", "screen", "digest", "compaction"]);
const isReply = (message) => message.role === "bot" && !NOT_A_REPLY.has(message.kind ?? "text");
/** Unread for a person: a bot replied after where they read up to; with no line yet, the room's own mark. A line no
 * longer on the path (an edit or a retry moved it) reads up to the last message at or before it; `atOf` gives its time. */
export function roomUnreadFor(path, readUpTo, roomUnread, atOf) {
    if (readUpTo === undefined)
        return roomUnread;
    let from = path.findIndex((message) => message.id === readUpTo) + 1;
    if (from === 0) {
        const readAt = atOf?.(readUpTo);
        if (readAt === undefined)
            return false;
        from = path.findLastIndex((message) => (message.at ?? 0) <= readAt) + 1;
    }
    return path.slice(from).some(isReply);
}
export function createRoomReads(dataDir) {
    const file = join(dataDir, ROOM_READS_FILE);
    let reads = {};
    try {
        const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
        if (parsed.success)
            reads = parsed.data.reads;
        else
            console.warn(`room reads: ${file} is not a room reads file; starting fresh`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            console.warn(`room reads: ${file} is unreadable; starting fresh`);
    }
    const save = () => {
        try {
            writeFileAtomic(file, `${JSON.stringify({ version: 1, reads })}\n`, { mode: 0o600 });
        }
        catch (error) {
            console.warn(`room reads: could not save ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    return {
        readUpTo: (groupId, person) => reads[groupId]?.[person],
        read(groupId, person, messageId) {
            if (reads[groupId]?.[person] === messageId)
                return;
            (reads[groupId] ??= {})[person] = messageId;
            save();
        },
        forget(groupId, person) {
            if (reads[groupId]?.[person] === undefined)
                return;
            delete reads[groupId][person];
            save();
        },
        forgetRoom(groupId) {
            if (!reads[groupId])
                return;
            delete reads[groupId];
            save();
        },
        forgetPerson(person) {
            const rooms = Object.values(reads).filter((room) => room[person] !== undefined);
            if (!rooms.length)
                return;
            for (const room of rooms)
                delete room[person];
            save();
        },
    };
}
/** Each person's view of a room (server/index.ts): its unread mark and read line as they read it, on a Team Cloud. */
export function createPersonRooms(deps) {
    const { reads } = deps;
    /** A room's unread mark and read line as this person has read it, on a Team Cloud; the room as it is anywhere else. */
    function groupForPerson(group, person) {
        if (!reads || !person)
            return group;
        const readUpTo = reads.readUpTo(group.id, person);
        const unread = roomUnreadFor(deps.store().activePath(group.threadId), readUpTo, group.unread, (id) => deps.store().messagesFor(group.threadId).find((message) => message.id === id)?.at);
        if (unread === group.unread && readUpTo === group.lastReadMessageId)
            return group;
        const { lastReadMessageId: _shared, ...rest } = group;
        return { ...rest, unread, ...(readUpTo ? { lastReadMessageId: readUpTo } : {}) };
    }
    return {
        reads,
        groupForPerson,
        groupForAuth: (auth, group) => groupForPerson(group, auth.kind === "session" ? personKey(auth.session) : null),
        /** A `group` frame as `person`'s own room (`frameOf` writes the stream's frame for a payload), kept in `ownGroups` for
         * the rest of that frame's streams; null when it is the room as it is. */
        ownGroupFrame(ownGroups, person, payload, frameOf) {
            if (!reads || payload.kind !== "group")
                return null;
            if (!ownGroups.has(person)) {
                const group = payload.group;
                const own = groupForPerson(group, person);
                const ownPayload = { ...payload, group: own };
                ownGroups.set(person, own === group ? null : { payload: ownPayload, frame: frameOf(ownPayload) });
            }
            return ownGroups.get(person) ?? null;
        },
        /** Marks a room read or unread for the person signed in (server/routes/channels.ts `personMarkRoom`), told to their
         * streams alone; absent anywhere but a Team Cloud. */
        ...(reads ? { personMarkRoom: (auth, room, unread) => {
                if (auth.kind !== "session")
                    return null;
                const person = personKey(auth.session);
                const newest = deps.newestMessageId(room.threadId);
                if (unread)
                    reads.forget(room.id, person);
                else if (newest)
                    reads.read(room.id, person, newest);
                const group = deps.publicGroupState(room);
                deps.broadcast({ kind: "group", group }, { person });
                return groupForPerson(group, person);
            } } : {}),
    };
}

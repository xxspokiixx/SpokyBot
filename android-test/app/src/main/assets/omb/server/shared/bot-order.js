/** A stable partial reorder: the listed items take, in the order given, the positions they already occupy together;
 * every other item keeps its place. Ids the list does not have are ignored. So a client can reorder one bucket
 * (a team, Pinned, the loose bots) without knowing the whole fleet. */
export function reorderStable(items, ids) {
    const rank = new Map(ids.map((id, index) => [id, index]));
    const slots = [];
    items.forEach((item, index) => { if (rank.has(item.id))
        slots.push(index); });
    const moved = slots.map((slot) => items[slot]).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    const out = [...items];
    slots.forEach((slot, index) => { out[slot] = moved[index]; });
    return out;
}

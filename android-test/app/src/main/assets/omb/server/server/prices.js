export function priceFor(turn, prices) {
    return prices[`${turn.driverKind}/${turn.model}`] ?? prices[turn.model] ?? prices.default ?? null;
}
const clean = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
export function billableFor(turn, prices) {
    const price = priceFor(turn, prices);
    if (!price)
        return null;
    const input = clean(turn.input);
    const cached = Math.min(clean(turn.cachedInput), input);
    const fresh = input - cached;
    const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;
    return (fresh * price.inputPerMillion + cached * cachedRate + clean(turn.output) * price.outputPerMillion) / 1_000_000;
}

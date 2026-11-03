/** `startsOnFirstCall`: the turn's first computer call creates or wakes it, so it is this turn's before it is up, and
 * asking for it (or for Auto) keeps it rather than restarting the request elsewhere. */
export function pickComputer(options, requested, current, startsOnFirstCall) {
    const isCurrent = (option) => option.surface === current && (option.ready || (startsOnFirstCall && option.available));
    const option = requested === "auto"
        ? options.find(isCurrent)
            ?? options.find((candidate) => candidate.ready && candidate.surface === "vm")
            ?? options.find((candidate) => candidate.ready)
            ?? options.find((candidate) => candidate.canStart)
            ?? options.find((candidate) => candidate.canCreate && candidate.surface === "vm")
            ?? options.find((candidate) => candidate.canCreate)
        : options.find((candidate) => candidate.surface === requested);
    return { option, current: option !== undefined && isCurrent(option) };
}

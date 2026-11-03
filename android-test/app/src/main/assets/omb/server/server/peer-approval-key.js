export function peerAllowKey(action, targetId) {
    return `${action}:${targetId}`;
}

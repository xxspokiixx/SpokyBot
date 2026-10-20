import type { Bot } from "./store";

/** What a copy takes from its source, PATCHed onto the new bot in one request. A copy of a VPS bot keeps its server. */
export function duplicateBotProfile(source: Bot) {
  return {
    name: `${source.name} copy`,
    title: source.title,
    description: source.description,
    soul: source.soul,
    notifications: source.notifications,
    modelSelection: source.modelSelection,
    computer: source.computer,
    cloudBackend: source.cloudBackend,
    autoStartVps: source.autoStartVps,
    vpsAlias: source.vpsAlias,
    avatarUrl: source.avatarUrl,
    avatarCrop: source.avatarCrop,
    avatarZoom: source.avatarZoom,
    avatarFocusX: source.avatarFocusX,
    avatarFocusY: source.avatarFocusY,
  };
}

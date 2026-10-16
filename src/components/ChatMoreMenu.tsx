import type { JSX } from "react";
import { Ellipsis } from "lucide-react";

import type { Bot } from "@/state/store";

export function ChatMoreMenu({ bot }: { bot: Bot }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`More for ${bot.name}`}
      className="flex size-8 items-center justify-center rounded-full bg-ink/[0.06] text-ink hover:bg-ink/[0.11]"
    >
      <Ellipsis size={16} className="pointer-events-none" />
    </button>
  );
}

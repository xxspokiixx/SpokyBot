import { useState } from "react";
import { Plus, Mic } from "lucide-react";
import { useStore } from "@/state/store";

export function Composer({ botName, botId }: { botName: string; botId: string }) {
  const { dispatch } = useStore();
  const [text, setText] = useState("");

  const send = () => {
    if (!text.trim()) return;
    dispatch({ type: "send", botId, text: text.trim() });
    setText("");
  };

  return (
    <div className="px-5 pb-5 pt-2">
      <div className="mx-auto flex max-w-[900px] items-center gap-2 rounded-full border border-hairline/40 bg-raised/60 py-2 pl-2 pr-2">
        <button
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          title="Attach"
        >
          <Plus size={20} />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Message ${botName}`}
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          title="Voice"
        >
          <Mic size={18} />
        </button>
      </div>
    </div>
  );
}

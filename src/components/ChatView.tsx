import { useEffect, useRef } from "react";
import { Monitor } from "lucide-react";
import { useStore, formatTime, type Bot, type Message } from "@/state/store";
import { BlobAvatar } from "./Avatar";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { cn } from "@/lib/cn";

function Bubble({ message }: { message: Message }) {
  const user = message.role === "user";
  return (
    <div className={cn("flex w-full", user ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
          user ? "bg-accent text-white" : "bg-raised text-ink",
        )}
      >
        {message.text}
      </div>
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, bot.messages.length, bot.typing]);

  const first = bot.messages[0];

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings" })}
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-raised/50"
          title="Bot settings"
        >
          <BlobAvatar color={bot.color} size={28} />
          <span className="text-[15px] font-semibold text-ink">{bot.name}</span>
        </button>
        <button className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink">
          <Monitor size={18} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4">
          {first && (
            <div className="py-3 text-center text-[13px] text-ink-secondary">
              Today {formatTime(first.at)}
            </div>
          )}
          {bot.messages.map((m) =>
            m.kind === "options" ? (
              <OptionCard key={m.id} botId={bot.id} message={m} />
            ) : (
              <Bubble key={m.id} message={m} />
            ),
          )}
          {bot.typing && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl bg-raised px-4 py-3">
                <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>
      </div>

      <Composer botName={bot.name} botId={bot.id} />
    </main>
  );
}

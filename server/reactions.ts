import { createHash } from "node:crypto";

import { formatQuestionAnswers } from "../shared/ask-question.ts";
import { NO, YES } from "../shared/call-consent.ts";
import { liveCardKind } from "../shared/live-approval.ts";
import { reactionAnswer, type Reaction, type ReactionDelivery } from "../shared/reactions.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { replyExcerpt, type ReplyTarget } from "./replies.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { BotRecord, Message, Store } from "./store.ts";

export interface Reactor {
  by: string;
  name?: string;
}

type CardReply = { behavior: "allow" | "deny" | "answer"; message?: string };
type Entry = NonNullable<Message["reactions"]>[number];

export interface ReactionDeps {
  store: Pick<Store, "bot" | "botByThread" | "groupByThread" | "messagesFor" | "setReaction">;
  /** `repeated`: that reply had reached the bot already. */
  reply(input: { auth: RequestAuth; threadId: string; owner: BotRecord; target: ReplyTarget; answer: string; sendId: string }): Promise<{ queued: boolean; repeated?: true }>;
  /** Answers the card the way a spoken yes or no on a call does, with the same checks on who may answer. */
  answerCard(input: { auth: RequestAuth; threadId: string; requestId: string } & CardReply): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  withdraw(threadId: string, owner: BotRecord, sendId: string): void;
}

export function reactionSendId(threadId: string, messageId: string, reaction: Pick<Entry, "by" | "emoji">): string {
  const basis = JSON.stringify([threadId, messageId, reaction.by, reaction.emoji]);
  return `reaction-${createHash("sha256").update(basis).digest("hex").slice(0, 32)}`;
}

export function cardReply(card: OptionCardData, answer: "yes" | "no"): CardReply | null {
  const kind = liveCardKind(card);
  if (kind === "approval") return { behavior: answer === "yes" ? "allow" : "deny" };
  if (kind !== "question") return null;
  const said = answer === "yes" ? YES : NO;
  const plain = answer === "yes" ? "Yes" : "No";
  const questions = card.questionRequest?.questions;
  if (!questions) {
    const label = card.options.length ? card.options.find((option) => said.test(option)) : plain;
    return label ? { behavior: "answer", message: label } : null;
  }
  const only = questions.length === 1 && !questions[0]!.multiSelect ? questions[0]! : null;
  const label = !only ? undefined : only.options.length ? only.options.find((option) => said.test(option.label))?.label : plain;
  return label ? { behavior: "answer", message: formatQuestionAnswers(questions, [[label]]) } : null;
}

const reactorName = (reaction: Entry, userName: string) => reaction.by === "user" ? userName : reaction.name ?? "Someone";
const feelings = (message: Message) => (message.reactions ?? []).filter((reaction) => !reactionAnswer(reaction.emoji));

/** `turnIds`: the lines this turn carries. */
export function withReactionNotes(text: string, path: readonly Message[], turnIds: ReadonlySet<string>, userName: string): string {
  const start = path.findIndex((message) => turnIds.has(message.id));
  if (start < 0) return text;
  const before = path.slice(0, start);
  const since = before.findLast((message) => message.role === "user" && !message.peerAsk)?.at ?? 0;
  const notes = before.flatMap((message) => message.role !== "bot" || message.from || !message.text ? [] : feelings(message)
    .filter((reaction) => (reaction.at ?? 0) > since)
    .map((reaction) => `(${reactorName(reaction, userName)} reacted ${reaction.emoji} to your message “${replyExcerpt(message.text!, 160)}”.)`));
  return notes.length ? `${notes.join("\n")}\n\n${text}` : text;
}

export function roomReactionNote(message: Message, userName: string): string {
  const felt = message.role === "bot" ? feelings(message) : [];
  return felt.length ? `\n(${felt.map((reaction) => `${reactorName(reaction, userName)} reacted ${reaction.emoji}`).join(", ")})` : "";
}

export function createReactions(deps: ReactionDeps) {
  const { store } = deps;

  function recipient(message: Message, threadId: string): BotRecord | null {
    if (message.role !== "bot") return null;
    if (!store.groupByThread(threadId)) return store.botByThread(threadId);
    return message.from ? store.bot(message.from.botId) : null;
  }

  async function deliver(auth: RequestAuth, threadId: string, target: Message, owner: BotRecord, entry: Entry): Promise<ReactionDelivery> {
    const answer = reactionAnswer(entry.emoji);
    if (!answer) return "noted";
    if (liveCardKind(target.card)) {
      const reply = store.groupByThread(threadId) ? null : cardReply(target.card!, answer);
      if (!reply) return "none";
      const result = await deps.answerCard({ auth, threadId, requestId: target.card!.requestId!, ...reply });
      if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
      return "answered";
    }
    if ((target.kind !== "text" && target.kind !== "widget") || !target.text?.trim()) return "none";
    const receipt = await deps.reply({
      auth, threadId, owner, target: { ...target, reactedWith: entry.emoji }, answer: entry.emoji,
      sendId: reactionSendId(threadId, target.id, entry),
    });
    return receipt.queued ? "queued" : receipt.repeated ? "none" : "started";
  }

  /** `on` sets (true) or clears (false) the person's `emoji`; absent, a second tap of the same emoji clears it. */
  async function react(input: {
    auth: RequestAuth; threadId: string; messageId: string; emoji: Reaction; reactor: Reactor; on?: boolean;
  }): Promise<{ message: Message; delivery: ReactionDelivery }> {
    const { auth, threadId, messageId, emoji, reactor, on } = input;
    const target = store.messagesFor(threadId).find((message) => message.id === messageId);
    if (!target) throw Object.assign(new Error("no such message"), { status: 404 });
    const previous = target.reactions?.find((reaction) => reaction.by === reactor.by);
    const kept = previous?.emoji === emoji ? null : previous?.emoji ?? null;
    const next = on === true || (on === undefined && previous?.emoji !== emoji) ? emoji : kept;
    if (next === (previous?.emoji ?? null)) return { message: target, delivery: "none" };

    const owner = recipient(target, threadId);
    if (owner && previous && reactionAnswer(previous.emoji)) deps.withdraw(threadId, owner, reactionSendId(threadId, messageId, previous));
    const entry: Entry | null = next ? { emoji: next, by: reactor.by, ...(reactor.name ? { name: reactor.name } : {}), at: Date.now() } : null;
    const message = store.setReaction(threadId, messageId, reactor.by, entry) ?? target;
    if (!entry || !owner) return { message, delivery: "none" };
    const latest = () => store.messagesFor(threadId).find((candidate) => candidate.id === messageId) ?? message;
    try {
      const delivery = await deliver(auth, threadId, message, owner, entry);
      return { message: latest(), delivery };
    } catch (error) {
      const current = latest().reactions?.find((reaction) => reaction.by === reactor.by);
      if (current && current.at === entry.at && current.emoji === entry.emoji) store.setReaction(threadId, messageId, reactor.by, previous ?? null);
      throw error;
    }
  }

  return { react };
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

export type BlobColor = "red" | "orange" | "blue" | "green" | "purple";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options";
  text?: string;
  card?: OptionCardData;
  at: number;
}

export interface Bot {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: BlobColor;
  unread: boolean;
  typing?: boolean;
  messages: Message[];
}

interface AppState {
  bots: Bot[];
  selectedId: string;
  settingsOpen: boolean;
  pluginsOpen: boolean;
}

type Action =
  | { type: "select"; id: string }
  | { type: "send"; botId: string; text: string }
  | { type: "answerCard"; botId: string; messageId: string; answer: string }
  | { type: "dismissCard"; botId: string; messageId: string }
  | { type: "newBot" }
  | { type: "typing"; botId: string; typing: boolean }
  | { type: "botReply"; botId: string; text: string }
  | { type: "toggleSettings"; open?: boolean }
  | { type: "togglePlugins"; open?: boolean }
  | {
      type: "updateBot";
      botId: string;
      patch: Partial<
        Pick<Bot, "name" | "title" | "description" | "notifications">
      >;
    };

let counter = 0;
const uid = () => `id-${Date.now()}-${counter++}`;

const onboardingCard = (): OptionCardData => ({
  title: "What do you mostly want help with?",
  subtitle: "Pick whatever's closest; we can always expand from there.",
  options: [
    "Work & projects",
    "Writing & research",
    "Life admin",
    "A bit of everything",
  ],
});

function seed(): AppState {
  const milind: Bot = {
    id: "bot-milind",
    name: "Milind",
    title: "",
    description: "",
    notifications: true,
    color: "blue",
    unread: false,
    messages: [
      {
        id: uid(),
        role: "bot",
        kind: "text",
        text: "Hey — I'm Milind. Nice to meet you.",
        at: Date.now(),
      },
      {
        id: uid(),
        role: "bot",
        kind: "options",
        card: onboardingCard(),
        at: Date.now(),
      },
    ],
  };
  const red: Bot = {
    id: "bot-red",
    name: "New Bot",
    title: "",
    description: "",
    notifications: true,
    color: "red",
    unread: true,
    messages: [
      {
        id: uid(),
        role: "bot",
        kind: "text",
        text: "What do you mainly want me to help with?",
        at: Date.now() - 1000 * 60 * 9,
      },
    ],
  };
  const orange: Bot = {
    id: "bot-orange",
    name: "New Bot",
    title: "",
    description: "",
    notifications: true,
    color: "orange",
    unread: true,
    messages: [
      {
        id: uid(),
        role: "bot",
        kind: "text",
        text: "What do you want me around for?",
        at: Date.now() - 1000 * 60 * 5,
      },
    ],
  };
  return {
    bots: [red, orange, milind],
    selectedId: milind.id,
    settingsOpen: false,
    pluginsOpen: false,
  };
}

const STORAGE_KEY = "opengrokbot-state-v1";

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (Array.isArray(parsed.bots) && parsed.bots.length > 0) {
        return {
          ...parsed,
          settingsOpen: false,
          pluginsOpen: false,
          bots: parsed.bots.map((b) => ({ ...b, typing: false })),
        };
      }
    }
  } catch {
    // corrupted state — fall through to seed
  }
  return seed();
}

function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot) {
  return {
    ...state,
    bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)),
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "select":
      return updateBot({ ...state, selectedId: action.id }, action.id, (b) => ({
        ...b,
        unread: false,
      }));
    case "send":
      return updateBot(state, action.botId, (b) => ({
        ...b,
        messages: [
          ...b.messages,
          {
            id: uid(),
            role: "user",
            kind: "text",
            text: action.text,
            at: Date.now(),
          },
        ],
      }));
    case "answerCard":
      return updateBot(state, action.botId, (b) => ({
        ...b,
        messages: b.messages
          .map((m) =>
            m.id === action.messageId && m.card
              ? { ...m, card: { ...m.card, answered: action.answer } }
              : m,
          )
          .concat({
            id: uid(),
            role: "user",
            kind: "text",
            text: action.answer,
            at: Date.now(),
          }),
      }));
    case "dismissCard":
      return updateBot(state, action.botId, (b) => ({
        ...b,
        messages: b.messages.map((m) =>
          m.id === action.messageId && m.card
            ? { ...m, card: { ...m.card, dismissed: true } }
            : m,
        ),
      }));
    case "typing":
      return updateBot(state, action.botId, (b) => ({
        ...b,
        typing: action.typing,
      }));
    case "botReply":
      return updateBot(state, action.botId, (b) => ({
        ...b,
        typing: false,
        unread: state.selectedId !== b.id ? true : b.unread,
        messages: [
          ...b.messages,
          { id: uid(), role: "bot", kind: "text", text: action.text, at: Date.now() },
        ],
      }));
    case "toggleSettings":
      return { ...state, settingsOpen: action.open ?? !state.settingsOpen };
    case "togglePlugins":
      return { ...state, pluginsOpen: action.open ?? !state.pluginsOpen };
    case "updateBot":
      return updateBot(state, action.botId, (b) => ({ ...b, ...action.patch }));
    case "newBot": {
      const colors: BlobColor[] = ["green", "purple", "red", "orange", "blue"];
      const color = colors[state.bots.length % colors.length];
      const bot: Bot = {
        id: uid(),
        name: "New Bot",
        title: "",
        description: "",
        notifications: true,
        color,
        unread: false,
        messages: [
          {
            id: uid(),
            role: "bot",
            kind: "text",
            text: "Hey — I'm your new bot. Nice to meet you.",
            at: Date.now(),
          },
          {
            id: uid(),
            role: "bot",
            kind: "options",
            card: onboardingCard(),
            at: Date.now(),
          },
        ],
      };
      return { ...state, bots: [bot, ...state.bots], selectedId: bot.id };
    }
  }
}

const REPLIES = [
  "Got it — noted. What else is on your mind?",
  "Nice. Want me to dig into that now or keep it for later?",
  "Understood. I'll keep that in mind as we go.",
  "Sounds good. Anything specific you want me to start with?",
];

function scriptedReply(userText: string, replyIndex: number): string {
  if (replyIndex === 0) {
    return `Great — ${userText.toLowerCase()} it is. What's on your plate right now?`;
  }
  return REPLIES[replyIndex % REPLIES.length];
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, load);

  // Side effects around the pure reducer: scripted bot replies with a
  // typing delay whenever the user sends something.
  const dispatch = useMemo(() => {
    const wrapped: React.Dispatch<Action> = (action) => {
      rawDispatch(action);
      if (action.type === "send" || action.type === "answerCard") {
        const botId = action.botId;
        const userText =
          action.type === "send" ? action.text : action.answer;
        const isOnboarding = action.type === "answerCard";
        setTimeout(() => rawDispatch({ type: "typing", botId, typing: true }), 350);
        setTimeout(() => {
          rawDispatch({
            type: "botReply",
            botId,
            text: scriptedReply(userText, isOnboarding ? 0 : 1 + Math.floor(Math.random() * (REPLIES.length - 1))),
          });
        }, 1200 + Math.random() * 600);
      }
    };
    return wrapped;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full/unavailable — persistence is best-effort
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

import {
  createContext,
  useContext,
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
  messages: Message[];
}

interface AppState {
  bots: Bot[];
  selectedId: string;
  settingsOpen: boolean;
}

type Action =
  | { type: "select"; id: string }
  | { type: "send"; botId: string; text: string }
  | { type: "answerCard"; botId: string; messageId: string; answer: string }
  | { type: "dismissCard"; botId: string; messageId: string }
  | { type: "newBot" }
  | { type: "toggleSettings"; open?: boolean }
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
  return { bots: [red, orange, milind], selectedId: milind.id, settingsOpen: false };
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
    case "toggleSettings":
      return { ...state, settingsOpen: action.open ?? !state.settingsOpen };
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

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, seed);
  const value = useMemo(() => ({ state, dispatch }), [state]);
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

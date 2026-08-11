import { StoreProvider, useStore } from "@/state/store";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";

function Shell() {
  const { state } = useStore();
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  return (
    <div className="flex h-full">
      <Sidebar />
      <ChatView bot={bot} />
      {state.settingsOpen && <SettingsPanel bot={bot} />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

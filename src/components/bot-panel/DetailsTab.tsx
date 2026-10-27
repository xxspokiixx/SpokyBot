import type { ReactNode } from "react";
import { AppWindow, Brain, Calendar, ChevronRight, FileText, Folder, Sparkles, Zap } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CALL_MODES, effectiveCallMode, setCallMode, useCallMode, type CallMode } from "@/lib/call-mode";
import { callCapabilityHelp } from "@/lib/call-capability";
import { useComposerChannelMode } from "@/lib/drafts";
import { effortLabel } from "@/components/ModelPicker";
import { shortPath } from "@/lib/short-path";
import { firstSentence } from "@/lib/soul";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { currentTaskBot, useStore, type Bot } from "@/state/store";
import type { ApprovalMode } from "../../../shared/approval-mode";
import type { EffortLevel } from "../../../shared/wire";
import { useChatMoreItems } from "../ChatMoreMenu";
import { ApprovalChip } from "../ComposerPlusMenu";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { DefaultBotHideRow } from "../DefaultBotControls";
import { ModelPicker, ModelVariantRow } from "../ModelPicker";
import type { SidebarMenuItem } from "../SidebarPopoverMenu";
import { SoulField } from "../SoulField";
import { useManagedSkills } from "../bot-settings/SkillsSection";
import { useBotApps } from "../bot-settings/useBotApps";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { useThreadApproval } from "../thread-approval";
import { memoryNotes } from "./memory-notes";
import type { SimplePageId } from "./page-registry";
import { buttonCls, Card, ColRow, NavRow, rowCls, RowText, Segmented, SwitchRow, type SegmentOption } from "./rows";
import { useMemoryDoc } from "./use-memory-doc";

type Derived = ReturnType<typeof useBotSettingsDerived>;
type ActsChoice = Extract<ApprovalMode, "ask" | "full">;

const ACTS_LABEL: Record<ApprovalMode, () => string> = {
  ask: () => t("botSettings.simple.ask"),
  full: () => t("botSettings.simple.justDoIt"),
  auto: () => t("botSettings.simple.decide"),
  edits: () => t("approvalMode.edits.label"),
  custom: () => t("approvalMode.custom.label"),
};

/** The chat's ⋯ items the Details tab lists for this conversation, in this order. */
export const CONVERSATION_ITEMS = ["find", "copy", "download", "usage", "activity", "inspector"];

/** A ⋯ menu item drawn as a panel row: the same label, icon, value and handler. */
function ItemRow({ item }: { item: SidebarMenuItem }) {
  return (
    <button
      type="button"
      data-panel-item={item.key}
      disabled={item.disabled}
      aria-pressed={item.active || undefined}
      onClick={item.onSelect}
      className={cn(rowCls, "w-full text-left enabled:hover:bg-ink/[0.03] disabled:cursor-default disabled:opacity-45")}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-secondary [&_svg]:size-[15px]" aria-hidden="true">
        {item.icon}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-[14px] font-medium", item.active ? "text-accent-text" : "text-ink")}>{item.label}</span>
      {item.trailing && <span className="flex shrink-0 items-center">{item.trailing}</span>}
    </button>
  );
}

function RoutinesNote({ children }: { children: ReactNode }) {
  return <p data-panel-empty="routines" className="mx-auto mt-6 max-w-[264px] text-center text-[13px] leading-[18px] text-ink-secondary">{children}</p>;
}

export function DetailsTab({ bot, derived, editingInstructions, onEditInstructions, onOpen }: {
  bot: Bot;
  derived: Derived;
  editingInstructions: boolean;
  onEditInstructions: (open: boolean) => void;
  onOpen: (page: SimplePageId) => void;
}) {
  const { dispatch } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const ownerOrAdmin = useOwnerOrAdmin();
  const apps = useBotApps(bot);
  const skills = useManagedSkills(bot);
  const memory = useMemoryDoc(bot);
  const thread = currentTaskBot(bot);
  const approval = useThreadApproval(thread);
  const [channelMode, setChannelMode] = useComposerChannelMode(`bot:${bot.id}:${bot.threadId}`);
  const storedCallMode = useCallMode();
  const { items } = useChatMoreItems(bot);
  const { patch, approvalMode, engine } = derived;
  const name = bot.name;

  // Antigravity's old Auto still executes as Ask: show that without changing the saved mode or granting Full.
  const displayedMode: ApprovalMode = engine?.driverKind === "antigravityAgent" && approvalMode === "auto" ? "ask" : approvalMode;
  const actsOptions: SegmentOption<ApprovalMode>[] = [
    { value: "ask", label: ACTS_LABEL.ask(), tooltip: t("botSettings.simple.askHint") },
    { value: "full", label: ACTS_LABEL.full(), tooltip: t("botSettings.simple.fullHint") },
    ...(displayedMode === "ask" || displayedMode === "full"
      ? []
      : [{ value: displayedMode, label: ACTS_LABEL[displayedMode](), disabled: true }]),
  ];
  const chooseActs = (mode: ApprovalMode) => {
    if (mode === approvalMode || (mode !== "ask" && mode !== "full")) return;
    const chosen: ActsChoice = mode;
    if (chosen === "full") {
      dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: "full", applyToAllThreads: true } });
      return;
    }
    patch({ approvalMode: chosen });
  };

  // As the call button: where this device cannot listen in turns, a call is always Live.
  const turnsHere = !ready || capabilities.dictation.available;
  const callMode = effectiveCallMode(storedCallMode, { turnsHere, canLive: true });
  const turnsHelp = turnsHere ? null : callCapabilityHelp(capabilities, Boolean(window.ogb?.speechStart));
  const callOptions: SegmentOption<CallMode>[] = CALL_MODES.map((entry) => ({
    value: entry.id,
    label: t(entry.label),
    disabled: entry.id === "turns" && turnsHelp !== null,
    tooltip: entry.id === "turns" && turnsHelp ? `${turnsHelp.label}. ${turnsHelp.reason}` : t(entry.id === "live" ? "call.mode.liveHint" : "call.mode.turnsHint"),
  }));

  // The Simple picker's own Thinking steps, so the row and the picker never disagree.
  const selection = bot.modelSelection;
  const levels = engine?.capabilities?.effortLevels ?? [];
  const updatesBotDefault = ownerOrAdmin === true;
  const thinking = engine?.capabilities?.modelVariants ? (
    <ColRow data-panel-row="thinking">
      <RowText title={t("botSettings.simple.thinking")} />
      <ModelVariantRow compact wide bot={bot} threadId={bot.threadId} updateBotDefault={updatesBotDefault} />
    </ColRow>
  ) : levels.length > 0 ? (
    <ColRow data-panel-row="thinking">
      <RowText title={t("botSettings.simple.thinking")} />
      <Segmented
        attr="data-thinking-choice"
        label={t("botSettings.simple.thinkingAria", { name })}
        value={selection.effort}
        onChange={(level: EffortLevel) => dispatch({
          type: "setModel",
          botId: bot.id,
          threadId: bot.threadId,
          ...(updatesBotDefault ? { updateBotDefault: true } : {}),
          selection: { ...selection, effort: level },
        })}
        // The provider's own level names (claude --effort / codex reasoning effort), every one the engine reports: no relabelling.
        options={levels.map((level) => ({ value: level, label: effortLabel(level), disabled: Boolean(bot.busy) }))}
      />
    </ColRow>
  ) : null;

  const soulOpen = editingInstructions || Boolean(bot.soulDrift);
  const enabledApps = apps.apps.filter((app) => app.scope !== null).map((app) => app.label);
  const routinesOn = derived.botRoutines.filter((routine) => routine.enabled).length;
  const skillsOn = skills.skills.filter((skill) => skill.enabled).length;
  const memoryOn = bot.memoryEnabled !== false;
  const notes = memory.doc ? memoryNotes(memory.doc.text).length : null;
  const memoryValue = !memoryOn ? t("botPanel.memory.off")
    : notes === null ? (memory.error ? t("botPanel.memory.nothingYet") : undefined)
    : notes === 0 ? t("botPanel.memory.nothingYet")
    : notes === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count: notes });
  const conversationItems = CONVERSATION_ITEMS.flatMap((key) => items.filter((item) => item.key === key));

  return (
    <div data-panel-tabpanel="details">
      {derived.botRoutines.length === 0 ? (
        <RoutinesNote>{t("botPanel.routines.empty")}</RoutinesNote>
      ) : (
        <Card label={t("botSettings.simple.routines")} anchor="routines">
          <NavRow
            data-panel-page="routines"
            icon={Calendar}
            title={t("botSettings.simple.routines")}
            value={routinesOn > 0 ? t("botPanel.routinesOn", { count: routinesOn }) : t("botPanel.none")}
            onClick={() => onOpen("routines")}
          />
        </Card>
      )}

      <Card label={t("botPanel.section.settings")} anchor="model">
        <div data-panel-row="model" className={rowCls}>
          <ModelPicker
            bot={bot}
            contained
            threadId={bot.threadId}
            label={<RowText title={<span className="flex items-center gap-2.5"><Sparkles size={15} className="text-ink-secondary" aria-hidden="true" />{t("model.simple.model")}</span>} />}
          />
        </div>
        {thinking}
        {soulOpen ? (
          <ColRow data-panel-row="soul">
            <SoulField
              bot={bot}
              onPatch={patch}
              simple={{
                label: t("botSettings.simple.instructions"),
                placeholder: t("botSettings.simple.instructionsPlaceholder", { name }),
              }}
            />
            {editingInstructions && (
              <div className="flex justify-end">
                <button type="button" data-panel-done="soul" onClick={() => onEditInstructions(false)} className={buttonCls}>
                  {t("botSettings.simple.done")}
                </button>
              </div>
            )}
          </ColRow>
        ) : (
          <section data-panel-card="instructions">
            <button
              type="button"
              data-panel-edit="soul"
              aria-label={`${t("botSettings.simple.edit")}: ${t("botSettings.simple.instructions")}`}
              onClick={() => onEditInstructions(true)}
              className={cn(rowCls, "w-full text-left hover:bg-ink/[0.03]")}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-secondary" aria-hidden="true">
                <FileText size={15} />
              </span>
              <RowText
                title={t("botSettings.simple.instructions")}
                hint={<span className="line-clamp-1">{firstSentence(bot.soul ?? "") || t("botPanel.instructionsHint", { name })}</span>}
              />
              <ChevronRight size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
            </button>
          </section>
        )}
      </Card>

      <Card anchor="approval">
        <ColRow data-panel-row="approval">
          <RowText title={t("botSettings.simple.beforeActs", { name })} hint={bot.busy ? t("approvalMode.whileWorking") : undefined} />
          <Segmented
            attr="data-approval-choice"
            label={t("botSettings.simple.beforeActs", { name })}
            value={displayedMode}
            onChange={chooseActs}
            options={actsOptions}
          />
        </ColRow>
        {approval.choice && (
          <div data-panel-row="thread-approval" className={rowCls}>
            <RowText title={t("botPanel.thisConversation")} />
            <ApprovalChip choice={approval.choice} />
          </div>
        )}
        <SwitchRow
          data-panel-row="goal"
          title={t("composer.goal.soloAria")}
          hint={t("botPanel.workUntilDone.hint", { name })}
          checked={channelMode === "goal"}
          onChange={() => setChannelMode(channelMode === "goal" ? "chat" : "goal")}
          color={bot.color}
        />
        <ColRow data-panel-row="call-mode">
          <RowText title={t("call.mode.menu")} />
          <Segmented attr="data-call-mode" label={t("call.mode.menu")} value={callMode} onChange={setCallMode} options={callOptions} />
        </ColRow>
      </Card>

      <Card anchor="uses">
        <NavRow
          data-panel-page="apps"
          icon={AppWindow}
          title={t("botPanel.appsRow")}
          value={enabledApps.length > 0 ? enabledApps.join(", ") : t("botPanel.appsNoneYet")}
          onClick={() => onOpen("apps")}
        />
        {derived.botRoutines.length === 0 && (
          <NavRow data-panel-page="routines" icon={Calendar} title={t("botSettings.simple.routines")} value={t("botPanel.none")} onClick={() => onOpen("routines")} />
        )}
        <NavRow
          data-panel-page="memory"
          icon={Brain}
          title={t("botPanel.memoryRow")}
          value={memoryValue}
          onClick={() => onOpen("memory")}
        />
        <NavRow
          data-panel-page="skills"
          icon={Zap}
          title={t("botSettings.simple.skills")}
          value={skills.loading ? undefined : skillsOn > 0 ? skillsOn : t("botPanel.none")}
          onClick={() => onOpen("skills")}
        />
        <NavRow
          data-panel-page="folder"
          icon={Folder}
          title={t("computer.files.folder")}
          value={bot.cwd ? shortPath(bot.cwd, capabilities.host?.homeDir) : t("botPanel.folder.private")}
          onClick={() => onOpen("folder")}
        />
      </Card>

      {conversationItems.length > 0 && (
        <Card label={t("botPanel.section.conversation")} anchor="conversation">
          {conversationItems.map((item) => <ItemRow key={item.key} item={item} />)}
        </Card>
      )}
      <DefaultBotHideRow bot={bot} />
      {approval.dialogs}
    </div>
  );
}

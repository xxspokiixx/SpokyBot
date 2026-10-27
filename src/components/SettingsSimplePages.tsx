import type { ReactNode } from "react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { AnalyticsRow } from "./AnalyticsRow";
import { UpdatesConsentRow } from "./UpdatesConsent";
import { OpenAtLoginRow } from "./OpenAtLoginRow";
import { DefaultBotSidebarRow } from "./DefaultBotControls";
import { DiagnosticsRow } from "./DiagnosticsRow";
import { brand } from "../lib/brand";
import { EnginesSettings } from "./EnginesSettings";
import { LocalComputerSection } from "./LocalComputerSection";
import { PeopleSection } from "./PeopleSection";
import { ActivitySection } from "./ActivitySection";
import { BuiltInBrowserRow } from "./BrowserSettingsRows";
import { LoginsSettings } from "./LoginsSettings";
import { OrganizationSettings } from "./OrganizationSettings";
import { CloudPlanRow } from "./ProIntroduction";
import { CloudUsageDetails, CloudUsageSummaryView, useCloudUsageSettings } from "./CloudUsageMeter";
import { Card, SettingRow, SettingsDisclosure, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { UsageSection } from "./UsageSection";
import { PlanUsageSummary } from "./PlanUsage";
import { SkinPicker } from "./SkinPicker";
import { ChatWidthRow, FontRow } from "./AppearanceSelectRows";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { McpCallTimeoutSettings } from "./McpCallTimeoutSettings";
import { ProfileSummaryRow } from "./ProfileSettings";
import { ThreadConcurrencySettings } from "./ThreadConcurrencySettings";
import { AutomaticRecoverySettings } from "./AutomaticRecoverySettings";
import { ThreadCleanupSettings } from "./ThreadCleanupSettings";
import { DefaultBotSettings } from "./NewBotDialog";
import { ImportSettings } from "./ImportSettings";
import { NotificationRows } from "./NotificationSettingsRows";
import { appVersion } from "@/lib/app-links";
import { useServerUpdateItem } from "./SidebarProfileMenu";
import { CacheKeepWarmSettings } from "./CacheKeepWarmSettings";
import { AdvancedModeRow, BrowserProfilesRow, ColorUserBubblesRow, LanguageRow, NewBotEffortRow, PinnedCirclesRow, ReplayTourRow, RunCardRow, SendKeyRow, SidebarDensityRow, ToolCallsRow, UniversalPinsRow, UpdatesRow } from "./AppSettingsRows";
import { ThemeRow } from "./ThemeRow";

export type SimpleDisclosureId = "general-more" | "ai-other" | "ai-more" | "computer-more" | "billing-details" | "updates-more";

export type Disclose = (id: SimpleDisclosureId) => { id: SimpleDisclosureId; open: boolean; onToggle: () => void };

export function SimpleGeneralPage({ has, remoteActive, disclose, peopleOpen }: {
  has: (id: AppSettingsSection) => boolean;
  remoteActive: boolean;
  disclose: Disclose;
  peopleOpen: boolean;
}) {
  return (
    <>
      {(has("general") || has("people")) && (
        <SettingsGroup label={t("settings.group.account")} block="general">
          <SettingsRows>
            {has("general") && <ProfileSummaryRow />}
            {has("general") && <CloudPlanRow />}
            {has("people") && <div data-settings-block="people" className="scroll-mt-4"><PeopleSection simple startOpen={peopleOpen} /></div>}
          </SettingsRows>
        </SettingsGroup>
      )}
      {has("appearance") && (
        <SettingsGroup label={t("settings.section.appearance")} block="appearance">
          <SettingsRows>
            <ThemeRow />
            <ColorUserBubblesRow simple />
            <LanguageRow simple />
            <SendKeyRow simple />
          </SettingsRows>
        </SettingsGroup>
      )}
      {has("appearance") && (
        <SettingsGroup label={t("notifications.title")}>
          <SettingsRows><NotificationRows simple /></SettingsRows>
        </SettingsGroup>
      )}
      {has("general") && (
        <SettingsGroup label={t("settings.group.system")}>
          <SettingsRows>
            <OpenAtLoginRow />
            <DefaultBotSidebarRow />
            {!remoteActive && <ReplayTourRow />}
          </SettingsRows>
        </SettingsGroup>
      )}
      <SettingsDisclosure label={t("settings.more")} {...disclose("general-more")}>
        {has("appearance") && (
          <SettingsGroup label={t("settings.group.display")}>
            <Card title={t("settings.skin.title")} subtitle={t("settings.skin.subtitle")}>
              <SkinPicker />
            </Card>
            <SettingsRows>
              <FontRow />
              <ChatWidthRow />
              <SidebarDensityRow />
              <PinnedCirclesRow />
              <UniversalPinsRow />
              {!remoteActive && <ToolCallsRow />}
              <RunCardRow />
            </SettingsRows>
          </SettingsGroup>
        )}
        {has("general") && (
          <SettingsGroup label={t("settings.group.newBots")}>
            <SettingsRows>
              <NewBotEffortRow />
              <DefaultBotSettings />
            </SettingsRows>
          </SettingsGroup>
        )}
        {has("general") && (
          <SettingsGroup label={t("settings.group.runningBots")}>
            <Card title={t("settings.roomTurns.title")} subtitle={t("settings.roomTurns.subtitle")}>
              <RoomTurnTimeoutSettings />
            </Card>
            <Card title={t("settings.mcpCalls.title")} subtitle={t("settings.mcpCalls.subtitle")}>
              <McpCallTimeoutSettings />
            </Card>
            <ThreadConcurrencySettings />
            <AutomaticRecoverySettings />
            <ThreadCleanupSettings />
          </SettingsGroup>
        )}
        {has("import") && <div data-settings-block="import" className="scroll-mt-4"><ImportSettings /></div>}
        {has("organization") && <div data-settings-block="organization" className="scroll-mt-4"><OrganizationSettings /></div>}
        {has("activity") && <div data-settings-block="activity" className="scroll-mt-4"><ActivitySection /></div>}
      </SettingsDisclosure>
      <SettingsRows><AdvancedModeRow simple /></SettingsRows>
    </>
  );
}

export function SimpleAiPage({ has, disclose, connections }: { has: (id: AppSettingsSection) => boolean; disclose: Disclose; connections: ReactNode }) {
  const { state } = useStore();
  return (
    <>
      {has("engines") && <div data-settings-block="engines" className="scroll-mt-4"><EnginesSettings simple /></div>}
      {has("connections") && (
        <SettingsDisclosure label={t("settings.ai.otherProviders")} {...disclose("ai-other")}>
          <div data-settings-block="connections" className="scroll-mt-4">{connections}</div>
        </SettingsDisclosure>
      )}
      {has("engines") && state.config?.cacheKeepWarm && (
        <SettingsDisclosure label={t("settings.more")} {...disclose("ai-more")}>
          <CacheKeepWarmSettings />
        </SettingsDisclosure>
      )}
    </>
  );
}

export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;

export function SimpleComputerPage({ has, remoteAccess, servers, disclose }: {
  has: (id: AppSettingsSection) => boolean;
  remoteAccess: RemoteAccessCards;
  servers: ReactNode;
  disclose: Disclose;
}) {
  return (
    <>
      {has("companion") && (
        <SettingsGroup label={t("settings.section.companion")} block="companion">
          {remoteAccess.pairing}
          {remoteAccess.companion}
          {remoteAccess.client}
        </SettingsGroup>
      )}
      {has("desktopWorkspaces") && <SettingsGroup label={t("settings.section.desktopWorkspaces")} block="desktopWorkspaces">{servers}</SettingsGroup>}
      {has("computer") && <SettingsGroup label={t("settings.section.computer")} block="computer"><LocalComputerSection /></SettingsGroup>}
      {has("computer") && (
        <SettingsGroup label={t("settings.experimental.browser")} block="browser">
          <SettingsRows><BuiltInBrowserRow /></SettingsRows>
          <BrowserProfilesRow />
        </SettingsGroup>
      )}
      {has("logins") && <div data-settings-block="logins" className="scroll-mt-4"><LoginsSettings /></div>}
      {has("companion") && remoteAccess.domain && (
        <SettingsDisclosure label={t("settings.more")} {...disclose("computer-more")}>
          {remoteAccess.domain}
        </SettingsDisclosure>
      )}
    </>
  );
}

export function SimpleBillingPage({ has, disclose, cloudAccount }: { has: (id: AppSettingsSection) => boolean; disclose: Disclose; cloudAccount: ReactNode }) {
  const { usage, upgrade, dialog } = useCloudUsageSettings();
  return (
    <>
      <div data-settings-block="usage" className="scroll-mt-4">
        {usage ? <CloudUsageSummaryView usage={usage} upgrade={upgrade}>{dialog}</CloudUsageSummaryView> : <PlanUsageSummary />}
      </div>
      {has("cloudAccount") && <div data-settings-block="cloudAccount" className="flex scroll-mt-4 flex-col gap-4">{cloudAccount}</div>}
      {(usage || has("usage")) && (
        <SettingsDisclosure label={t("settings.billing.details")} {...disclose("billing-details")}>
          {usage && <CloudUsageDetails usage={usage} upgrade={upgrade} />}
          {has("usage") && <UsageSection />}
        </SettingsDisclosure>
      )}
    </>
  );
}

const versionTitle = () => `${brand().name} ${appVersion()}`;

function ServerUpdatesRow() {
  const entry = useServerUpdateItem(true);
  if (!entry) return null;
  const status = entry.phase === "idle" ? undefined : [entry.label, entry.item.subtitle].filter(Boolean).join(" ");
  const action = entry.phase === "available" ? t("settings.updates.seeRelease")
    : entry.phase === "reload" ? t("settings.updates.reload")
      : entry.phase === "checking" ? t("common.checking") : t("settings.updates.check");
  return (
    <SettingRow title={versionTitle()} subtitle={status}>
      <button type="button" className="ui-button" disabled={entry.item.disabled} onClick={entry.item.onSelect}>{action}</button>
    </SettingRow>
  );
}

export function SimpleUpdatesPage({ disclose }: { disclose: Disclose }) {
  return (
    <>
      <SettingsGroup block="updates">
        <SettingsRows>
          {window.ogb?.updater ? <UpdatesRow title={versionTitle()} /> : <ServerUpdatesRow />}
          <UpdatesConsentRow />
        </SettingsRows>
      </SettingsGroup>
      <SettingsDisclosure label={t("settings.more")} {...disclose("updates-more")}>
        <SettingsRows>
          <AnalyticsRow />
          <DiagnosticsRow />
        </SettingsRows>
      </SettingsDisclosure>
    </>
  );
}

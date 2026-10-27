import { Search } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

import { SidebarPlaceStatus, useSimplePlace } from "./SidebarFooter";
import { SidebarFooterNav } from "./SidebarFooterNav";
import { SidebarProfileMenu, useSimpleAccount } from "./SidebarProfileMenu";
import { SIMPLE_RAIL_BUTTON } from "./SidebarSimpleTop";
import { UpdateIndicator } from "./UpdateIndicator";

export function SidebarRailSeparator() {
  return <div aria-hidden="true" data-sidebar-rail-separator="" className="mx-auto my-1.5 h-px w-8 shrink-0 bg-hairline/70" />;
}

export function SimpleRailFooter({ onSearch, plus, owner = null }: {
  onSearch: () => void;
  plus: ReactNode;
  owner?: string | null;
}) {
  const place = useSimplePlace();
  const account = useSimpleAccount(place, owner);
  return (
    <div data-sidebar-rail-footer="" className="relative flex flex-col items-center gap-0.5 px-2 pb-3 pt-2">
      <button type="button" onClick={onSearch} aria-label={t("sidebar.searchAria")} title={t("sidebar.searchAria")} className={SIMPLE_RAIL_BUTTON}>
        <Search size={18} aria-hidden="true" />
      </button>
      <div className="relative flex w-full justify-center">{plus}</div>
      <SidebarFooterNav density="icons" rail />
      <UpdateIndicator />
      <div className="mt-1.5">
        <SidebarProfileMenu iconOnly rail simple={account} />
      </div>
      <SidebarPlaceStatus place={place} className="absolute bottom-3 left-full z-40 ml-2 w-56 rounded-md bg-menu px-2 py-1 text-[11px] shadow-lg" />
    </div>
  );
}

import { useId, type ComponentProps, type ReactNode } from "react";
import { Check, ChevronRight, Copy, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";

export const SIMPLE_CARD = "rounded-2xl border-[0.5px] border-ink/[0.06] bg-menu";

export const SIMPLE_SELECT = "[&>select]:h-7 [&>select]:py-0 [&>select]:border-[0.5px] [&>select]:border-ink/10 [&>select]:bg-ink/[0.04] [&>select]:text-[14px] [&>select]:font-normal";

export function Switch({
  checked,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "role" | "aria-checked"> & { checked: boolean }) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative cursor-pointer h-6 w-11 shrink-0 rounded-full transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        "in-data-[settings-look=simple]:h-5 in-data-[settings-look=simple]:w-8",
        checked ? "bg-accent" : "bg-control in-data-[settings-look=simple]:bg-ink/[0.14]",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] motion-reduce:transition-none",
          "in-data-[settings-look=simple]:top-0.5 in-data-[settings-look=simple]:size-4",
          checked ? "left-[21px] in-data-[settings-look=simple]:left-[14px]" : "left-[3px] in-data-[settings-look=simple]:left-0.5",
        )}
      />
    </button>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-4 max-md:rounded-2xl in-data-[settings-look=simple]:rounded-2xl in-data-[settings-look=simple]:border-[0.5px] in-data-[settings-look=simple]:border-ink/[0.06] in-data-[settings-look=simple]:bg-menu in-data-[settings-look=simple]:p-3.5">
      {title && <div className="text-[16px] font-semibold text-ink in-data-[settings-look=simple]:text-[14px] in-data-[settings-look=simple]:font-medium">{title}</div>}
      {subtitle && <div className={title ? "mt-0.5 text-[13px] leading-relaxed text-ink-secondary" : "text-[13px] leading-relaxed text-ink-secondary"}>{subtitle}</div>}
      {children && <div className={title || subtitle ? "mt-4" : undefined}>{children}</div>}
    </div>
  );
}

export function SettingRow({
  title,
  subtitle,
  children,
  message,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  message?: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={cn("px-4 in-data-[settings-look=simple]:px-3.5 in-data-[settings-look=simple]:py-2.5", className)}>
      <div className="grid min-w-0 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
        <div className="min-w-0">
          <div id={titleId} className="text-[14px] font-medium text-ink in-data-[settings-look=simple]:font-normal in-data-[settings-look=simple]:leading-5">{title}</div>
          {subtitle && <div className="mt-1 text-[12px] leading-relaxed text-pretty text-ink-secondary in-data-[settings-look=simple]:mt-0.5 in-data-[settings-look=simple]:text-[13px] in-data-[settings-look=simple]:leading-[18px]">{subtitle}</div>}
        </div>
        <div className="min-w-0 sm:max-w-[240px] in-data-[settings-look=simple]:sm:max-w-[320px]">{children}</div>
      </div>
      {message && <div className="mt-2 text-[12px]">{message}</div>}
    </div>
  );
}

export function SettingsGroup({ label, block, actions, children }: { label?: string; block?: string; actions?: ReactNode; children: ReactNode }) {
  const labelId = useId();
  return (
    <section
      data-settings-block={block}
      aria-labelledby={label ? labelId : undefined}
      className="flex scroll-mt-4 flex-col gap-2 has-[>[data-settings-rows]:empty]:hidden"
    >
      {(label || actions) && (
        <div className="flex min-h-5 items-center justify-between gap-3 px-3.5">
          {label && <h3 id={labelId} className="text-[13px] leading-[18px] text-ink-secondary">{label}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsRows({ children }: { children: ReactNode }) {
  return <div data-settings-rows="" className={cn(SIMPLE_CARD, "flex flex-col py-1.5 empty:hidden")}>{children}</div>;
}

export function SettingsDisclosure({ id, label, open, onToggle, children }: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const regionId = useId();
  return (
    <section data-settings-disclosure={id} className="flex flex-col gap-7">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
        className="flex w-fit cursor-pointer items-center gap-1 rounded-lg px-3.5 py-1 text-[14px] text-ink-secondary transition-colors hover:text-ink motion-reduce:transition-none"
      >
        {label}
        <ChevronRight size={14} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      <div id={regionId} hidden={!open} className="flex flex-col gap-7">{children}</div>
    </section>
  );
}

export function CommandLine({ command, copyLabel = "Copy command" }: { command: string; copyLabel?: string }) {
  const { state, copy } = useCopyFeedback(command);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "failed" ? t("common.copyFailed") : copyLabel}
        className="ui-icon-button shrink-0"
      >
        {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

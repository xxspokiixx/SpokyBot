import type { InstanceInfo, ModelSelection } from "@/state/store";

type ModelOption = InstanceInfo["models"]["options"][number];

export type ModelChoice = ModelOption & { nativeModel?: string; variant?: string };

/** Antigravity exposes one model plus a thinking level; present its levels wherever models are picked. */
export function modelChoices(instance: InstanceInfo, options: readonly ModelOption[]): ModelChoice[] {
  if (instance.driverKind !== "antigravityAgent") return [...options];
  return options.flatMap((option) => option.variants?.length
    ? option.variants.map((variant) => ({
      ...option,
      id: JSON.stringify([option.id, variant.id]),
      label: `${option.label} · ${variant.label}`,
      nativeModel: option.id,
      variant: variant.id,
    }))
    : [option]);
}

export function choiceIsSelected(choice: ModelChoice, selection: ModelSelection): boolean {
  return (choice.nativeModel ?? choice.id) === selection.model && choice.variant === selection.variant;
}

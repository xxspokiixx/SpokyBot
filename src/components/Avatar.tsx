import type { BlobColor } from "@/state/store";

const FILLS: Record<BlobColor, string> = {
  red: "#e5484d",
  orange: "#f28a30",
  blue: "#3f8cff",
  green: "#46a758",
  purple: "#8e4ec6",
};

// Squishy blob creature with two eyes, in the spirit of Grok Bot's avatars.
export function BlobAvatar({
  color,
  size = 44,
}: {
  color: BlobColor;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      className="shrink-0"
      aria-hidden
    >
      <path
        d="M22 5
           C 31 4, 39 8, 40 17
           C 41 25, 39 34, 31 37
           C 25 39.5, 17 39.5, 11.5 36
           C 4.5 31.5, 3.5 22, 6 14.5
           C 8 8, 14 5.5, 22 5 Z"
        fill={FILLS[color]}
      />
      <circle cx="16.5" cy="20" r="2.6" fill="#141416" />
      <circle cx="27.5" cy="20" r="2.6" fill="#141416" />
    </svg>
  );
}

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

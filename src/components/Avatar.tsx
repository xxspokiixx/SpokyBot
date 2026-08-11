import type { BlobColor } from "@/state/store";

const FILLS: Record<BlobColor, string> = {
  red: "#e5484d",
  orange: "#f28a30",
  blue: "#3f8cff",
  green: "#46a758",
  purple: "#8e4ec6",
};

// Each color gets its own squishy silhouette, like Grok Bot's avatars:
// red is a lumpy cloud, orange a rounded square, blue near-round.
const SHAPES: Record<BlobColor, string> = {
  red: "M13 14 C 14 8.5, 20 6.5, 24 9.5 C 27 6, 34 7, 36 12 C 40 13, 42 18, 40.5 22.5 C 42 28, 39 33.5, 33.5 35 C 28 38.5, 16 38.5, 10.5 34.5 C 5.5 31, 4.5 24, 7 19 C 8 16, 10 14.5, 13 14 Z",
  orange: "M14 6.5 L 30 6.5 C 35.5 6.5, 38.5 9.5, 38.5 15 L 38.5 29 C 38.5 34.5, 35.5 37.5, 30 37.5 L 14 37.5 C 8.5 37.5, 5.5 34.5, 5.5 29 L 5.5 15 C 5.5 9.5, 8.5 6.5, 14 6.5 Z",
  blue: "M22 5 C 32.5 5, 39.5 12, 39.5 22 C 39.5 32, 32.5 39, 22 39 C 11.5 39, 4.5 32, 4.5 22 C 4.5 12, 11.5 5, 22 5 Z",
  green: "M22 5.5 C 31 4, 38 10, 38.5 19 C 39 28, 34 36.5, 24.5 38 C 15 39.5, 6.5 34, 5.5 24.5 C 4.5 15, 12 7, 22 5.5 Z",
  purple: "M21 5.5 C 27 3.5, 34 6, 37.5 12 C 41 18, 40 26, 35.5 31.5 C 31 37, 22 39.5, 15 36.5 C 8 33.5, 4 26.5, 5.5 19 C 7 12, 14 7.5, 21 5.5 Z",
};

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
      <path d={SHAPES[color]} fill={FILLS[color]} />
      <circle cx="16.5" cy="20.5" r="2.6" fill="#141416" />
      <circle cx="27.5" cy="20.5" r="2.6" fill="#141416" />
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

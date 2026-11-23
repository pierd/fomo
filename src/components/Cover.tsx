import { BookOpen, Clapperboard, Gamepad2, Headphones, Mic, Sparkles, Tv } from "lucide-react";
import { kindOfTags, type Kind } from "../../convex/lib/tags";

type CoverItem = { title: string; coverUrl: string | null; aiStatus?: string };

const KIND_ICONS: Record<Kind, typeof BookOpen> = {
  book: BookOpen,
  audiobook: Headphones,
  movie: Clapperboard,
  series: Tv,
  game: Gamepad2,
  podcast: Mic,
};

// Palette for placeholder covers, picked by title so each item keeps its color.
const HUES = [262, 200, 160, 30, 340, 120, 15, 290];

export function Cover({ item, className = "", tags = [] }: { item: CoverItem; className?: string; tags?: string[] }) {
  if (item.coverUrl) {
    return (
      <img
        src={item.coverUrl}
        alt=""
        loading="lazy"
        className={`rounded-md border border-line bg-sunken object-cover ${className}`}
      />
    );
  }
  let h = 0;
  for (const c of item.title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  const kind = kindOfTags(tags);
  const Icon = item.aiStatus === "pending" ? Sparkles : kind ? KIND_ICONS[kind] : null;
  return (
    <div
      className={`flex flex-col items-center justify-center overflow-hidden rounded-md border border-line p-1 text-center ${className}`}
      style={{ background: `linear-gradient(160deg, hsl(${hue} 55% 55% / 0.35), hsl(${hue} 55% 40% / 0.15))` }}
      aria-hidden
    >
      {Icon ? (
        <Icon size={18} className={`opacity-60 ${item.aiStatus === "pending" ? "animate-pulse" : ""}`} />
      ) : (
        <span className="text-lg font-bold opacity-60">{item.title.trim().charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}

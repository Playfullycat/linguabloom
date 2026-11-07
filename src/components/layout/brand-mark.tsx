import { cn } from "@/lib/utils";

/** Original LinguaBloom mark: five overlapping petals, one per palette accent. */
export function BrandMark({ className }: { className?: string }) {
  const petals = ["fill-primary", "fill-blue", "fill-mint", "fill-yellow", "fill-coral"];
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      {petals.map((fill, i) => (
        <ellipse
          key={fill}
          cx="16"
          cy="9.5"
          rx="4.6"
          ry="6.6"
          transform={`rotate(${i * 72} 16 16)`}
          className={cn(fill, "opacity-90")}
        />
      ))}
      <circle cx="16" cy="16" r="3.6" className="fill-surface" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span lang="en" className={cn("text-[1.0625rem] font-semibold tracking-tight text-ink", className)}>
      Lingua<span className="text-primary-ink">Bloom</span>
    </span>
  );
}

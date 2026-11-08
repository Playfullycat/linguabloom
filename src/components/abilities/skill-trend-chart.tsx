"use client";

import { useState } from "react";

export type TrendPoint = { at: string; level: string; levelLabel: string; source: string; confidence: string; evidence: number };
export type TrendSeries = { skill: string; label: string; points: TrendPoint[] };

const LEVELS = ["pre_a1", "a1", "a2", "b1", "b2", "c1", "c2"] as const;
const LEVEL_LABELS: Record<string, string> = { pre_a1: "Pre-A1", a1: "A1", a2: "A2", b1: "B1", b2: "B2", c1: "C1", c2: "C2" };

const W = 320;
const H = 150;
const PAD = { top: 12, right: 14, bottom: 24, left: 46 };

const dateFmt = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

/**
 * Skill estimates over time as small multiples (spec §5.15 "CEFR 各技能分项趋势").
 * One series per chart in one hue, so the title names it (no legend). A step
 * line, because an estimate holds until the next one replaces it. Every point
 * has a hover / keyboard tooltip, and a table carries the same values.
 */
export function SkillTrendChart({ series, now }: { series: TrendSeries[]; now: string }) {
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) return <p className="text-sm text-muted">做过水平诊断或积累了练习记录后，这里会显示各项技能估计的变化。</p>;
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {withData.map((s) => (
          <li key={s.skill}>
            <SmallMultiple series={s} now={now} />
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">用表格查看全部估计</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">技能</th>
                <th className="py-1 pr-3 font-medium">日期</th>
                <th className="py-1 pr-3 font-medium">估计</th>
                <th className="py-1 pr-3 font-medium">把握</th>
                <th className="py-1 pr-3 font-medium">依据</th>
                <th className="py-1 font-medium">来源</th>
              </tr>
            </thead>
            <tbody>
              {withData.flatMap((s) =>
                s.points.map((p, i) => (
                  <tr key={`${s.skill}-${i}`} className="border-t border-border">
                    <td className="py-1 pr-3">{s.label}</td>
                    <td className="py-1 pr-3 tabular-nums">{dateFmt.format(new Date(p.at))}</td>
                    <td className="py-1 pr-3 font-medium text-ink">{p.levelLabel}</td>
                    <td className="py-1 pr-3">{p.confidence}</td>
                    <td className="py-1 pr-3 tabular-nums">{p.evidence}</td>
                    <td className="py-1">{p.source}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function SmallMultiple({ series, now }: { series: TrendSeries; now: string }) {
  const [active, setActive] = useState<number | null>(null);
  const idx = (l: string) => Math.max(0, LEVELS.indexOf(l as (typeof LEVELS)[number]));
  const values = series.points.map((p) => idx(p.level));
  const lo = Math.max(0, Math.min(...values) - 1);
  const hi = Math.min(LEVELS.length - 1, Math.max(Math.max(...values) + 1, lo + 2));
  const rows = LEVELS.slice(lo, hi + 1);
  const t0 = new Date(series.points[0]!.at).getTime();
  const t1 = Math.max(new Date(now).getTime(), t0 + 86_400_000);
  const x = (at: string) => PAD.left + ((new Date(at).getTime() - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (level: number) => PAD.top + ((hi - level) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  // Step-after: each estimate holds until the next one (or today).
  let d = "";
  series.points.forEach((p, i) => {
    const px = x(p.at);
    const py = y(idx(p.level));
    d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
  });
  d += `H${x(now)}`;
  const last = series.points.at(-1)!;
  const tip = active === null ? null : series.points[active]!;

  return (
    <figure className="relative flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{series.label}</span>
        <span className="text-muted">
          最新：<span className="font-semibold text-ink">{last.levelLabel}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={`${series.label}的估计变化：${series.points.map((p) => `${dateFmt.format(new Date(p.at))} ${p.levelLabel}`).join("，")}`}>
        {rows.map((l) => {
          const yy = y(idx(l));
          return (
            <g key={l}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={yy} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
                {LEVEL_LABELS[l]}
              </text>
            </g>
          );
        })}
        <text x={PAD.left} y={H - 6} fontSize={11} fill="var(--color-muted)">
          {dateFmt.format(new Date(series.points[0]!.at))}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize={11} textAnchor="end" fill="var(--color-muted)">
          今天
        </text>
        <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {series.points.map((p, i) => {
          const cx = x(p.at);
          const cy = y(idx(p.level));
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={i === active ? 6 : 4.5} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={2} />
              {/* Hit area larger than the mark; same details on keyboard focus. */}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${dateFmt.format(new Date(p.at))}：${p.levelLabel}，${p.confidence}，${p.source}`}
                className="cursor-pointer outline-none focus-visible:stroke-[var(--color-primary)]"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>
      {tip ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-raised"
          style={{ left: `${(x(tip.at) / W) * 100}%`, top: `${(y(idx(tip.level)) / H) * 100}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
        >
          <p className="text-sm font-semibold text-ink">{tip.levelLabel}</p>
          <p className="whitespace-nowrap text-muted">
            {dateFmt.format(new Date(tip.at))} · {tip.confidence} · 依据 {tip.evidence}
          </p>
          <p className="whitespace-nowrap text-muted">{tip.source}</p>
        </div>
      ) : null}
    </figure>
  );
}

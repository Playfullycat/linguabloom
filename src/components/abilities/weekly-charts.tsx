"use client";

import { useState } from "react";

export type WeekPoint = { start: string; value: number | null; detail: string };

// Narrow enough that labels stay readable when the chart is scaled down to a phone screen.
const W = 380;
const H = 180;
const PAD = { top: 16, right: 10, bottom: 26, left: 40 };

const weekLabel = (start: string) => `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`;

/** Round axis maximum: 1, 2, 2.5 or 5 × 10ⁿ steps, at most 4 intervals. */
function niceMax(v: number) {
  if (v <= 0) return { max: 1, ticks: [0, 1] };
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  const max = Math.ceil(v / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100) };
}

/**
 * One weekly series as bars or a line (spec §5.15). A single series per chart
 * in one hue, so the title names it (no legend); study time and retention are
 * two aligned charts, never one chart with two y-axes. Every week has a hover
 * and keyboard tooltip; the table below carries the same numbers.
 */
/** Units the chart can format (plain data, so a Server Component can pass it). */
export type WeeklyUnit = "minutes" | "percent";

export function WeeklyChart({ title, points, kind, unit, emptyText }: { title: string; points: WeekPoint[]; kind: "bar" | "line"; unit: WeeklyUnit; emptyText: string }) {
  const [active, setActive] = useState<number | null>(null);
  const format = (v: number) => (unit === "percent" ? `${Math.round(v * 100)}%` : `${v} 分钟`);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const percent = kind === "line";
  const { max, ticks } = percent ? { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] } : niceMax(Math.max(0, ...values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / points.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const barW = Math.min(22, band * 0.5);
  const tip = active === null ? null : points[active]!;

  // Line segments skip weeks without enough data (no invented values).
  let d = "";
  points.forEach((p, i) => {
    if (p.value === null) return;
    const prev = points[i - 1];
    d += `${i === 0 || !prev || prev.value === null ? "M" : "L"}${x(i)},${y(p.value)} `;
  });

  return (
    <figure className="relative flex flex-col gap-1">
      <figcaption className="text-sm font-medium text-ink">{title}</figcaption>
      {!values.some((v) => v > 0) ? (
        <p className="py-6 text-sm text-muted">{emptyText}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={`${title}：${points.map((p) => `${weekLabel(p.start)} 起的一周 ${p.value === null ? "数据不足" : format(p.value)}`).join("，")}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
                {percent ? `${Math.round(t * 100)}%` : t}
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.start} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
              {weekLabel(p.start)}
            </text>
          ))}
          {kind === "bar"
            ? points.map((p, i) => {
                if (!p.value) return null;
                const top = y(p.value);
                const h = PAD.top + plotH - top;
                const r = Math.min(4, h);
                const left = x(i) - barW / 2;
                const right = x(i) + barW / 2;
                const base = PAD.top + plotH;
                return <path key={p.start} d={`M${left},${base} V${top + r} Q${left},${top} ${left + r},${top} H${right - r} Q${right},${top} ${right},${top + r} V${base} Z`} fill="var(--color-primary)" opacity={active === null || active === i ? 1 : 0.55} />;
              })
            : (
                <>
                  <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {points.map((p, i) => (p.value === null ? null : <circle key={p.start} cx={x(i)} cy={y(p.value)} r={i === active ? 6 : 4.5} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={2} />))}
                </>
              )}
          {/* Hit areas: the whole week column, focusable for keyboard users. */}
          {points.map((p, i) => (
            <rect
              key={p.start}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${weekLabel(p.start)} 起的一周：${p.value === null ? "数据不足" : format(p.value)}，${p.detail}`}
              className="cursor-pointer outline-none focus-visible:stroke-[var(--color-primary)]"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
      )}
      {tip ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-raised"
          style={{ left: `${(x(points.indexOf(tip)) / W) * 100}%`, top: `${((tip.value === null ? PAD.top + plotH / 2 : y(tip.value)) / H) * 100}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
        >
          <p className="text-sm font-semibold text-ink">{tip.value === null ? "数据不足" : format(tip.value)}</p>
          <p className="whitespace-nowrap text-muted">
            {weekLabel(tip.start)} 起的一周 · {tip.detail}
          </p>
        </div>
      ) : null}
    </figure>
  );
}

/**
 * Counts per row and week as a shaded table: one hue, light to dark by count
 * (sequential), with the number printed in every cell so color is never the
 * only carrier.
 */
export function WeeklyHeatTable({ caption, rowHeader, weeks, rows, testId }: { caption: string; rowHeader: string; weeks: string[]; rows: { key: string; label: string; perWeek: number[]; total: number }[]; testId?: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.perWeek));
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[34rem] border-separate border-spacing-0.5 text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-3 font-medium">{rowHeader}</th>
            {weeks.map((w) => (
              <th key={w} className="px-1 py-1 text-center font-medium tabular-nums">
                {weekLabel(w)}
              </th>
            ))}
            <th className="py-1 pl-2 text-right font-medium">合计</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="py-1 pr-3 font-normal whitespace-nowrap text-ink">
                {r.label}
              </th>
              {r.perWeek.map((n, i) => {
                const share = n / max;
                return (
                  <td
                    key={weeks[i]}
                    title={`${r.label} · ${weekLabel(weeks[i]!)} 起的一周：${n}`}
                    className={`rounded px-1 py-1 text-center tabular-nums ${share > 0.55 ? "text-white" : "text-ink"}`}
                    style={{ background: n === 0 ? "var(--color-surface-soft)" : `color-mix(in oklab, var(--color-primary) ${Math.round(18 + share * 72)}%, var(--color-surface))` }}
                  >
                    {n === 0 ? <span className="text-muted">·</span> : n}
                  </td>
                );
              })}
              <td className="py-1 pl-2 text-right font-medium tabular-nums text-ink">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

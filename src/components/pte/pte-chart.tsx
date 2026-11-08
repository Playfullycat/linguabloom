import type { Chart } from "@/modules/pte/content";

const W = 520;
const H = 300;
const PAD = { top: 28, right: 20, bottom: 44, left: 48 };

/** A round axis: step 1, 2, 2.5 or 5 × 10ⁿ with at most 5 intervals above the data. */
function niceAxis(v: number) {
  const target = (v * 1.1) / 5;
  const p = 10 ** Math.floor(Math.log10(Math.max(1e-9, target)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= target)!;
  const max = Math.ceil((v * 1.1) / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100) };
}

/**
 * An original chart for "Describe Image": one series in one hue (the title
 * names it, so no legend), thin bars with a rounded data end or a 2px line
 * with ringed markers, hairline gridlines, every value printed on its mark
 * (the learner has to describe them), and a table with the same numbers.
 */
export function PteChart({ chart }: { chart: Chart }) {
  const { max, ticks } = niceAxis(Math.max(...chart.values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const band = plotW / chart.categories.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const barW = Math.min(24, band * 0.5);
  const fmt = (v: number) => `${v}${chart.unit}`;

  return (
    <figure className="flex flex-col gap-2" data-testid="pte-chart">
      <figcaption className="text-sm font-semibold text-ink" lang="en">
        {chart.title}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label={`${chart.title}：${chart.categories.map((c, i) => `${c} ${fmt(chart.values[i]!)}`).join("，")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {t}
            </text>
          </g>
        ))}
        <text x={14} y={PAD.top + plotH / 2} fontSize={11} fill="var(--color-muted)" textAnchor="middle" transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}>
          {chart.y_label}
        </text>
        {chart.type === "bar" ? (
          chart.values.map((v, i) => {
            const top = y(v);
            const h = PAD.top + plotH - top;
            const r = Math.min(4, h);
            const left = x(i) - barW / 2;
            const right = x(i) + barW / 2;
            // Rounded data end, square at the baseline.
            const d = `M${left},${PAD.top + plotH} V${top + r} Q${left},${top} ${left + r},${top} H${right - r} Q${right},${top} ${right},${top + r} V${PAD.top + plotH} Z`;
            return (
              <g key={i}>
                <path d={d} fill="var(--color-primary)" />
                <text x={x(i)} y={top - 6} textAnchor="middle" fontSize={12} fill="var(--color-ink)">
                  {fmt(v)}
                </text>
              </g>
            );
          })
        ) : (
          <g>
            <path d={chart.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ")} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {chart.values.map((v, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(v)} r={4.5} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={2} />
                <text x={x(i)} y={y(v) - 10} textAnchor="middle" fontSize={12} fill="var(--color-ink)">
                  {fmt(v)}
                </text>
              </g>
            ))}
          </g>
        )}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--color-border-strong)" strokeWidth={1} />
        {chart.categories.map((c, i) => (
          <text key={c} x={x(i)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={12} fill="var(--color-muted)">
            {c}
          </text>
        ))}
      </svg>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">用表格查看数据</summary>
        <table className="mt-1 text-left">
          <tbody>
            {chart.categories.map((c, i) => (
              <tr key={c} className="border-t border-border">
                <td className="py-0.5 pr-6" lang="en">
                  {c}
                </td>
                <td className="py-0.5 tabular-nums">{fmt(chart.values[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

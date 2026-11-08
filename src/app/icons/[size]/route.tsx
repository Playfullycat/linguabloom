import { ImageResponse } from "next/og";

/**
 * PNG app icons for the web app manifest, drawn from the same flower as
 * src/app/icon.svg. "maskable" keeps the flower inside the safe zone (80%).
 */
const SIZES = { "192": { px: 192, maskable: false }, "512": { px: 512, maskable: false }, "maskable-512": { px: 512, maskable: true } } as const;

const PETALS = ["#6257d9", "#5b9beb", "#51b99a", "#f4c75e", "#f18a78"];

export async function GET(_request: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size } = await ctx.params;
  const spec = SIZES[size as keyof typeof SIZES];
  if (!spec) return new Response("Not found", { status: 404 });
  const inner = spec.maskable ? spec.px * 0.62 : spec.px * 0.86;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: spec.maskable ? "#f7f8fc" : "transparent" }}>
        <svg width={inner} height={inner} viewBox="0 0 32 32">
          <g opacity={0.9}>
            {PETALS.map((fill, i) => (
              <ellipse key={fill} cx="16" cy="9.5" rx="4.6" ry="6.6" fill={fill} transform={`rotate(${i * 72} 16 16)`} />
            ))}
          </g>
          <circle cx="16" cy="16" r="3.6" fill="#ffffff" />
        </svg>
      </div>
    ),
    { width: spec.px, height: spec.px, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}

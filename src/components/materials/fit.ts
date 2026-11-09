/** Labels and colours for how a material's level compares with the learner's (shared by server and client). */
export const FIT_TONES = { easier: "mint", right: "primary", stretch: "yellow", hard: "coral" } as const;
export const FIT_LABELS = { easier: "偏简单", right: "适合你", stretch: "稍有挑战", hard: "比较难" } as const;

/** Known-word coverage bands (≥98% extensive, 95–98% intensive, below that many new words). */
export const COVERAGE_TONES = { extensive: "mint", intensive: "primary", hard: "coral" } as const;
export const coveragePercent = (ratio: number) => `认识约 ${Math.floor(ratio * 100)}%`;

import type { MetadataRoute } from "next";

/** Web app manifest (Next.js PWA guide): installable, opens on Today, works offline for reviews. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LinguaBloom",
    short_name: "LinguaBloom",
    description: "个人英语学习工作站：系统课程、真实输入、主动输出与间隔复习。断网时也能做到期复习。",
    lang: "zh-CN",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fc",
    theme_color: "#6257d9",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "离线复习", short_name: "离线复习", url: "/offline" },
      { name: "今日计划", short_name: "今日", url: "/today" },
    ],
  };
}

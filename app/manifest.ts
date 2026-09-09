import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MIVO V2 — Meet the vibe",
    short_name: "MIVO V2",
    description: "Talk first. Feel the vibe. Reveal by choice. Connect by consent.",
    start_url: "/",
    display: "standalone",
    background_color: "#050610",
    theme_color: "#080b1e",
    orientation: "portrait-primary",
    categories: ["social"],
    icons: [
      { src: "/icon-192.jpg", sizes: "192x192", type: "image/jpeg", purpose: "any" },
      { src: "/icon-512.jpg", sizes: "512x512", type: "image/jpeg", purpose: "any" },
      { src: "/icon-512.jpg", sizes: "512x512", type: "image/jpeg", purpose: "maskable" },
    ],
  };
}

import type { MetadataRoute } from "next";
import { APP_NAME, DESCRIPTION } from "@/lib/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: DESCRIPTION,
    start_url: "/",
    display: "standalone",
    // Matches the app's actual dark-mode --background (globals.css /
    // layout.tsx's viewport.themeColor) — was a generic scaffold near-black
    // unrelated to either of the app's real theme colors, which mismatched
    // the PWA splash screen/task-switcher color against the app itself.
    background_color: "#181233",
    theme_color: "#181233",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

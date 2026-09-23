import type { MetadataRoute } from "next";

// A single-page app today — this exists mainly so robots.ts has something
// valid to point at, and so a future second route (e.g. a blog or /about)
// has a place to be added without introducing the file for the first time.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://namernut.com",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

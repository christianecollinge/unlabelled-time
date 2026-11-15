import type { MetadataRoute } from "next";

/** Makes Unlabelled Time installable as an app, with "Pause or resume" on its Dock or taskbar icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Unlabelled Time",
    short_name: "Time",
    description: "Record the time you spend on each project.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f7",
    theme_color: "#f7f7f7",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      {
        name: "Pause or resume",
        short_name: "Pause/resume",
        description: "Pause the timer, or resume the last thing you worked on",
        url: "/?do=toggle",
        icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Start a project…",
        short_name: "Start…",
        description: "Type a few letters of a project and start its timer",
        url: "/?do=switch",
        icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}

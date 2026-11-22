import { RouterProvider, createRouter } from "@tanstack/react-router";
// Bare import: attaching the audio-unlock window listeners at module
// load time (before any route mounts) so the very first user gesture
// anywhere in the app — including the login button on "/" — unlocks
// audio playback. See lib/audio-unlock.ts for details.
import "./lib/audio-unlock";
import { Route as rootRoute } from "./routes/__root";
import { Route as gameRoute } from "./routes/game";
import { Route as indexRoute } from "./routes/index";

const routeTree = rootRoute.addChildren([indexRoute, gameRoute]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return <RouterProvider router={router} />;
}

// @ts-check
import { defineConfig } from "astro/config";

import { execSync } from "node:child_process";
import { satteri } from "@astrojs/markdown-satteri";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import {
  devEndpoints,
  perfProxy,
  startPerfServer,
} from "./src/dev/endpoints.js";

// each build writes its commit into a meta tag, so an open tab can tell a deploy landed. a copy without git (a
// tarball, say) still builds
const buildId = (() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

// in dev, the key and frame log routes, /dev (which opens the home page with ?dev), and the test panel and window.spike
// on every page opened with ?dev. a build has none of them, so /dev there is the not found page. with PERF=1, astro
// preview passes /__perf on to a small server of its own
/** @returns {import("astro").AstroIntegration} */
const devTools = () => ({
  name: "dev-tools",
  hooks: {
    "astro:config:setup": async ({
      command,
      injectRoute,
      injectScript,
      updateConfig,
    }) => {
      if (command === "dev") {
        injectRoute({ pattern: "/dev", entrypoint: "./src/dev/dev.astro" });
        updateConfig({ vite: { plugins: [devEndpoints()] } });
        injectScript(
          "page",
          `if (import.meta.env.DEV && new URLSearchParams(location.search).has("dev")) {
  import("/src/dev/panel.js");
  import("/src/dev/spikeApi.js");
}`,
        );
      }
      if (command === "preview" && process.env.PERF === "1") {
        const { url } = await startPerfServer();
        updateConfig({ vite: { preview: { proxy: perfProxy(url) } } });
      }
    },
  },
});

// https://astro.build/config
export default defineConfig({
  site: "https://jasonyue.ca",
  // the imported posts keep their straight quotes, dashes, and three periods
  markdown: { processor: satteri({ features: { smartPunctuation: false } }) },
  integrations: [
    react(),
    // the links have no trailing slash anywhere else, so the sitemap's urls match them
    sitemap({
      serialize: (item) =>
        new URL(item.url).pathname === "/"
          ? item
          : { ...item, url: item.url.replace(/\/$/, "") },
    }),
    devTools(),
  ],
  // the toolbar sits over the phone's home bar on the dev page
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
    // the privacy check refuses an inline image, so the build never inlines an asset as a data: URI
    build: { assetsInlineLimit: 0 },
    // CAPTURE=1 builds in window.__capture (src/scene/capture.js) for the tests, and PERF=1 marks a build for the
    // frame log. the build that ships has neither
    define: {
      "import.meta.env.BUILD_ID": JSON.stringify(buildId),
      __CAPTURE__: JSON.stringify(process.env.CAPTURE === "1"),
      __PERF__: JSON.stringify(process.env.PERF === "1"),
    },
  },
});

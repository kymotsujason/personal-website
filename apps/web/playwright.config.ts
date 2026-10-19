import { defineConfig, devices } from "@playwright/test";

const devServer = {
  command: "pnpm dev --host 127.0.0.1",
  env: { ASTRO_DEV_BACKGROUND: "0" },
  url: "http://127.0.0.1:4321",
  reuseExistingServer: false,
};

// the prod preview is a capture build (window.__capture, see src/scene/capture.js), built into dist-capture so that dist
// stays the build that ships. the ship project builds the way a deploy does, with pnpm build and no CAPTURE, and checks
// that build and its dist folder
const prodServer = {
  command:
    "pnpm exec astro build --outDir dist-capture && node ../../tools/html-rules.mjs --dist dist-capture && node ../../tools/privacy/check.mjs --dist dist-capture && pnpm exec astro preview --ignore-lock --outDir dist-capture --host 127.0.0.1 --port 4173",
  env: { ASTRO_PREVIEW_BACKGROUND: "0", CAPTURE: "1" },
  url: "http://127.0.0.1:4173",
  reuseExistingServer: false,
  timeout: 300000,
};

const shipServer = {
  command:
    "pnpm build && pnpm preview --ignore-lock --host 127.0.0.1 --port 4174",
  env: { ASTRO_PREVIEW_BACKGROUND: "0", CAPTURE: "0" },
  url: "http://127.0.0.1:4174",
  reuseExistingServer: false,
  timeout: 300000,
};

// start only the servers the selected projects need
function selectedProjects(): string[] {
  const names: string[] = [];
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      names.push(args[i + 1]);
    } else if (args[i].startsWith("--project=")) {
      names.push(args[i].slice("--project=".length));
    }
  }
  if (names.length === 0 && process.env.PW_PROJECT) {
    names.push(...process.env.PW_PROJECT.split(","));
  }
  return names;
}

// COMPARE_CAPTURE=1 runs the compare project against the capture build's preview instead of the dev server
const compareCapture = process.env.COMPARE_CAPTURE === "1";
const selected = selectedProjects();
const compareOnDev = selected.includes("compare") && !compareCapture;
const compareOnProd = selected.includes("compare") && compareCapture;
// the builds go first, since an astro build while the dev server is up breaks the dev server's dynamic imports
const servers = [
  ...(selected.length === 0 ||
  selected.includes("prod") ||
  selected.includes("firefox") ||
  compareOnProd
    ? [prodServer]
    : []),
  ...(selected.length === 0 || selected.includes("ship") ? [shipServer] : []),
  ...(selected.length === 0 || selected.includes("dev") || compareOnDev
    ? [devServer]
    : []),
];

// headless chromium falls back to swiftshader, which renders the scene on the cpu at about 125 ms a frame. angle on
// the desktop gl driver puts it on the gpu instead. PW_GPU=0 keeps swiftshader for a machine without one
const gpuLaunch =
  process.env.PW_GPU === "0"
    ? {}
    : {
        launchOptions: {
          args: ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"],
        },
      };

// the compare project runs only when asked for (playwright test --project compare). it takes about a minute on the gpu
const compareProject = {
  name: "compare",
  testMatch: "compare/**/*.spec.ts",
  use: {
    ...devices["Desktop Chrome"],
    ...gpuLaunch,
    baseURL: compareCapture ? "http://127.0.0.1:4173" : "http://127.0.0.1:4321",
  },
};

export default defineConfig({
  testDir: "./tests",
  projects: [
    {
      name: "dev",
      testMatch: "dev/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        ...gpuLaunch,
        baseURL: "http://127.0.0.1:4321",
      },
    },
    {
      name: "prod",
      testMatch: "prod/**/*.spec.ts",
      testIgnore: "prod/prod.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        ...gpuLaunch,
        baseURL: "http://127.0.0.1:4173",
      },
    },
    {
      name: "ship",
      testMatch: "prod/prod.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        ...gpuLaunch,
        baseURL: "http://127.0.0.1:4174",
      },
    },
    // checks for bugs only firefox shows, against the prod preview. they need playwright's firefox
    // (pnpm exec playwright install firefox)
    {
      name: "firefox",
      testMatch: "firefox/**/*.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
        baseURL: "http://127.0.0.1:4173",
      },
    },
    ...(selected.includes("compare") ? [compareProject] : []),
  ],
  webServer: servers,
});

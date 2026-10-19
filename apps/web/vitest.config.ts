/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,js}", "worker/**/*.test.js"],
    exclude: ["src/scene/**"],
  },
});

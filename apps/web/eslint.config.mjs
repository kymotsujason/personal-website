import tsParser from "@typescript-eslint/parser";
import * as astroParser from "astro-eslint-parser";
import astro from "eslint-plugin-astro";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "dist-capture/**",
      "node_modules/**",
      ".astro/**",
      "src/scene/**",
      "src/dev/**",
      "public/keys/**",
      "public/models/**",
      "src/data/*.json",
    ],
  },
  ...astro.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: { parser: tsParser },
    },
  },
]);

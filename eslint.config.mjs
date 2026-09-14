import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // main.js is esbuild's bundled output (repo root, not a dist/ folder),
  // so it isn't covered by ESLint's default ignores -- it must never be
  // linted as if it were source.
  { ignores: ["main.js"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.json only includes src/**/*.ts, so any root-level
        // config file needs to opt into being linted with default
        // compiler options instead of erroring "not included in any
        // tsconfig.json".
        projectService: {
          allowDefaultProject: ["eslint.config.*", "esbuild.config.mjs", "vitest.config.ts"],
        },
      },
    },
  },
  {
    // A build script, never part of the shipped main.js bundle -- Node
    // built-ins here can't crash a mobile install.
    files: ["esbuild.config.mjs"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
]);

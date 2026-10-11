import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  target: "node22",
  format: "esm",
  fixedExtension: false,
  // Bundle workspace packages (they ship TypeScript source); keep npm deps external.
  noExternal: [/^@nonna\//],
});

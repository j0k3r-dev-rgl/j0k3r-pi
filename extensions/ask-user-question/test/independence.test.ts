import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

it("owns its test packages and declares Pi-provided runtime imports only as peers", () => {
  expect(manifest.dependencies).toBeUndefined();
  for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
    expect(manifest.peerDependencies[name]).toBe("*");
    expect(manifest.devDependencies[name]).toBeTruthy();
    expect(readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8")).toBeTruthy();
  }
  for (const file of readdirSync(resolve(root, "src"), { recursive: true }).filter((name) => String(name).endsWith(".ts"))) {
    const source = readFileSync(resolve(root, "src", String(file)), "utf8");
    expect(source).not.toMatch(/createRequire|node_modules|gentle-pi:|GENTLE_|\/home\//);
    for (const [, specifier] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (specifier.startsWith(".")) expect(resolve(root, "src", String(file), "..", specifier).startsWith(root)).toBe(true);
      else expect(manifest.peerDependencies[specifier]).toBe("*");
    }
  }
});

it("loads through Pi's real extension loader without another extension or settings", async () => {
  const loaded = await discoverAndLoadExtensions([resolve(root, "index.ts")], root, root);
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions).toHaveLength(1);
  expect([...loaded.extensions[0].tools.keys()]).toEqual(["ask_user_question"]);
  expect(loaded.extensions[0].handlers.size).toBe(0);
});

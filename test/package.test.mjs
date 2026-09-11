import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, packageRoot, run, tscArgs, typeUsage } from "./helpers.mjs";

test("published tarball works in an independent consumer via CLI and standard emitter", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "enum-package-consumer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let result = run("pnpm", ["pack", "--pack-destination", root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const tarball = (await readdir(root)).find((name) => name.endsWith(".tgz"));
  assert.ok(tarball);
  await writeFile(join(root, "package.json"), JSON.stringify({
    private: true, type: "module",
    dependencies: {
      "typespec-enum-plus-emitter": `file:./${tarball}`,
      "@typespec/compiler": "1.15.0", "enum-plus": "3.3.0", typescript: "6.0.2",
    },
  }));
  result = run("pnpm", ["install", "--ignore-scripts", "--registry=https://registry.npmjs.org"], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const installed = join(root, "node_modules/typespec-enum-plus-emitter");
  assert.deepEqual((await readdir(installed)).filter((name) => name !== "node_modules").sort(), ["LICENSE", "README.md", "cli", "lib", "package.json", "runtime"]);
  await writeFile(join(root, "main.tsp"), `import "typespec-enum-plus-emitter";\n${fixture}`);
  result = run("pnpm", ["exec", "typespec-enum-plus-emitter", "--output", "generated"], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  result = run("pnpm", ["exec", "typespec-enum-plus-emitter", "--output", "generated", "--check"], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  await writeFile(join(root, "tspconfig.yaml"), `emit:\n  - typespec-enum-plus-emitter\noptions:\n  typespec-enum-plus-emitter:\n    emitter-output-dir: "{output-dir}/enums"\n`);
  result = run("pnpm", ["exec", "tsp", "compile", ".", "--output-dir", "standard"], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const file of await readdir(join(root, "generated"))) {
    assert.equal(await readFile(join(root, "generated", file), "utf8"), await readFile(join(root, "standard/enums", file), "utf8"));
  }
  await writeFile(join(root, "usage.ts"), typeUsage);
  result = run("pnpm", ["exec", "tsc", ...tscArgs], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  // The consumer is outside the source repository and never imports its runtime paths.
  assert.ok(!root.startsWith(packageRoot));
});

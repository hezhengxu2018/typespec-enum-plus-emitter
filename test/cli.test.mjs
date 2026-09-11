import assert from "node:assert/strict";
import { test } from "node:test";
import { access, appendFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, fixture, packageRoot, run } from "./helpers.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "enum cli space-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, "main.tsp");
  await writeFile(main, `import ${JSON.stringify(join(packageRoot, "lib/main.tsp").replaceAll("\\", "/"))};\n${fixture}`);
  return { root, main, output: join(root, "generated") };
}

async function contents(root) {
  return Object.fromEntries(await Promise.all((await readdir(root)).sort().map(async (name) => [name, await readFile(join(root, name), "utf8")])));
}

test("CLI uses caller cwd, generates deterministically, cleans managed files and checks without writing", async (t) => {
  const { root, output } = await setup(t);
  // The standalone CLI must not discover or execute project configuration.
  await writeFile(join(root, "tspconfig.yaml"), "emit:\n  - missing-emitter-for-cli-isolation\n");
  const invoke = (...args) => run(process.execPath, [cli, "--output", "generated", ...args], root);
  let result = invoke();
  assert.equal(result.status, 0, result.stderr);
  const first = await contents(output);
  assert.match(first["status.ts"], /hidden: true/);
  assert.match(first["priority.ts"], /value: 0/);
  assert.deepEqual(JSON.parse(first["enum-manifest.json"]).types, ["Priority", "Status"]);
  assert.equal(invoke().status, 0);
  assert.deepEqual(await contents(output), first);

  const manifestPath = join(output, "enum-manifest.json");
  const manifest = JSON.parse(first["enum-manifest.json"]);
  manifest.files.push("stale.ts");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(output, "stale.ts"), "old");
  await writeFile(join(output, "keep.txt"), "user-owned");
  let before = await contents(output);
  result = invoke("--check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale.ts/);
  assert.deepEqual(await contents(output), before);
  assert.equal(invoke().status, 0);
  await assert.rejects(access(join(output, "stale.ts")));
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "user-owned");
  before = await contents(output);
  assert.equal(invoke("--check").status, 0);
  assert.deepEqual(await contents(output), before);
  await appendFile(join(output, "status.ts"), "// drift\n");
  before = await contents(output);
  result = invoke("--check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /status.ts/);
  assert.deepEqual(await contents(output), before);
});

test("CLI accepts an explicit input from another cwd and preserves output on compilation failure", async (t) => {
  const { root, main, output } = await setup(t);
  const caller = join(root, "other cwd");
  await mkdir(caller);
  const invoke = () => run(process.execPath, [cli, "../main.tsp", "--output", "../generated"], caller);
  assert.equal(invoke().status, 0);
  const before = await contents(output);
  await appendFile(main, "\nthis is invalid TypeSpec");
  assert.equal(invoke().status, 1);
  assert.deepEqual(await contents(output), before);
});

test("CLI rejects invalid manifests before modifying target files", async (t) => {
  const { root, output } = await setup(t);
  const invoke = () => run(process.execPath, [cli, "--output", output], root);
  assert.equal(invoke().status, 0);
  const manifestPath = join(output, "enum-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const invalid of [
    { ...manifest, version: 1 },
    { ...manifest, types: ["Status", "Status"] },
    { ...manifest, files: ["../outside.ts"] },
    { ...manifest, files: [join(root, "outside.ts")] },
  ]) {
    await writeFile(manifestPath, JSON.stringify(invalid));
    const before = await contents(output);
    assert.equal(invoke().status, 1);
    assert.deepEqual(await contents(output), before);
  }
});

test("CLI help, version, invalid arguments and check against missing output", async (t) => {
  const { root } = await setup(t);
  const invoke = (...args) => run(process.execPath, [cli, ...args], root);
  assert.match(invoke("--help").stdout, /\[entrypoint\]/);
  assert.equal(invoke("--version").stdout.trim(), "0.1.0");
  for (const args of [[], ["--output"], ["--output", "--check"], ["--unknown"], ["folder", "--output", "out"], ["missing.tsp", "--output", "out"]]) {
    assert.equal(invoke(...args).status, 1);
  }
  assert.equal(invoke("--output", "missing", "--check").status, 1);
  await assert.rejects(access(join(root, "missing")));
});

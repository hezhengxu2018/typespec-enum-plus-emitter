import assert from "node:assert/strict";
import { test } from "node:test";
import { access, appendFile, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
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
    null,
    { ...manifest, version: 1 },
    { ...manifest, files: ["status.ts", "status.ts"] },
    { ...manifest, files: ["keep.txt"] },
    { ...manifest, files: ["enum-manifest.json"] },
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


test("CLI refuses unmanaged collisions and skips writing unchanged files", async (t) => {
  const { root, output } = await setup(t);
  const invoke = (...args) => run(process.execPath, [cli, "--output", output, ...args], root);
  await mkdir(output);
  await writeFile(join(output, "status.ts"), "user-owned");
  let before = await contents(output);
  let result = invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unmanaged file/);
  assert.deepEqual(await contents(output), before);
  await rm(join(output, "status.ts"));
  assert.equal(invoke().status, 0);
  const timestamps = async () => Object.fromEntries(await Promise.all((await readdir(output)).map(async (name) =>
    [name, (await stat(join(output, name), { bigint: true })).mtimeNs])));
  const initialTimes = await timestamps();
  assert.equal(invoke().status, 0);
  assert.deepEqual(await timestamps(), initialTimes);
  const external = join(root, "external.ts");
  await writeFile(external, "external");
  await rm(join(output, "status.ts"));
  await symlink(external, join(output, "status.ts"));
  for (const args of [[], ["--check"]]) {
    result = invoke(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symbolic link/);
    assert.equal(await readFile(external, "utf8"), "external");
  }
});

test("CLI explicitly loads config, preserves imports, and overrides emitter and output settings", async (t) => {
  const { root, output } = await setup(t);
  const config = join(root, "config.yaml");
  const configuredOutput = join(root, "must-not-write");
  const imported = join(root, "extra.tsp");
  await writeFile(imported, `
    @EnumExport.exportEnum(#{ domain: "extra", name: "ExtraStatus" })
    enum Extra { @EnumExport.enumItem(#{ label: "Extra" }) Value: "extra" }
  `);
  await writeFile(join(root, "base.yaml"), `options:
  typespec-enum-plus-emitter:
    api-types-mode: standalone
    emitter-output-dir: "{output-dir}/enums"
`);
  await writeFile(config, `extends: ./base.yaml
output-dir: "{project-root}/must-not-write"
emit:
  - missing-emitter-must-not-run
imports:
  - "${imported.replaceAll("\\", "/")}"
`);
  const invoke = (...args) => run(process.execPath, [cli, "../main.tsp", "--output", "../generated", "--config", "../config.yaml", ...args], join(root, "caller"));
  await mkdir(join(root, "caller"));
  let result = invoke();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  let types = await readFile(join(output, "api-types.ts"), "utf8");
  assert.match(types, /export type ExtraStatus = 'extra'/);
  assert.doesNotMatch(types, /from /);
  await assert.rejects(access(configuredOutput));
  assert.equal(invoke("--check").status, 0);
  result = invoke("--api-types-mode", "re-export");
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(join(output, "api-types.ts"), "utf8"), /ExtraStatusValue as ExtraStatus/);
  const before = await contents(output);
  for (const configText of ["options: [broken", "options:\n  typespec-enum-plus-emitter:\n    unknown-option: true\n"]) {
    await writeFile(config, configText);
    result = invoke();
    assert.equal(result.status, 1);
    assert.deepEqual(await contents(output), before);
  }
  await rm(config);
  assert.equal(invoke().status, 1);
  assert.deepEqual(await contents(output), before);
});

test("CLI warning flags override config and retain strict default", async (t) => {
  const { root, main, output } = await setup(t);
  await appendFile(main, '\n#deprecated "Use NewModel"\nmodel OldModel {}\nmodel UsesOld extends OldModel {}\n');
  const invoke = (...args) => run(process.execPath, [cli, "--output", output, ...args], root);
  let result = invoke();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /deprecated/);
  result = invoke("--no-warnings-as-errors");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /deprecated/);
  const before = await contents(output);
  await writeFile(join(root, "config.yaml"), "warn-as-error: false\n");
  assert.equal(invoke("--config", "config.yaml").status, 0);
  assert.equal(invoke("--config", "config.yaml", "--warnings-as-errors").status, 1);
  await writeFile(join(root, "config.yaml"), "warn-as-error: true\n");
  assert.equal(invoke("--config", "config.yaml").status, 1);
  assert.equal(invoke("--config", "config.yaml", "--no-warnings-as-errors").status, 0);
  assert.deepEqual(await contents(output), before);
});

test("CLI validates new option arguments", async (t) => {
  const { root, output } = await setup(t);
  for (const args of [["--config"], ["--config", "--check"], ["--api-types-mode"], ["--api-types-mode", "other"]]) {
    const result = run(process.execPath, [cli, "--output", output, ...args], root);
    assert.equal(result.status, 1);
    await assert.rejects(access(output));
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest, synchronize } from "../cli/output.mjs";

async function setup(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "enum-sync-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generated = join(root, "generated");
  const target = join(root, "target");
  await fs.mkdir(generated);
  await fs.mkdir(target);
  const oldManifest = { version: 2, files: ["status.ts", "stale.ts"], types: ["Old"] };
  const manifest = { version: 2, files: ["status.ts", "added.ts"], types: ["New"] };
  for (const [directory, files] of [
    [target, { "status.ts": "old status", "stale.ts": "old stale", "keep.txt": "user-owned", "enum-manifest.json": JSON.stringify(oldManifest) }],
    [generated, { "status.ts": "new status", "added.ts": "new added", "enum-manifest.json": JSON.stringify(manifest) }],
  ]) {
    for (const [name, content] of Object.entries(files)) await fs.writeFile(join(directory, name), content);
  }
  return { generated, target, manifest };
}

async function contents(root) {
  return Object.fromEntries(await Promise.all((await fs.readdir(root)).sort().map(async (name) =>
    [name, await fs.readFile(join(root, name), "utf8")])));
}

test("synchronization rolls back failures at every commit rename, including manifest publication", async (t) => {
  // Existing replacement (2), new file (1), stale removal (1), manifest (2).
  for (let failAt = 1; failAt <= 6; failAt += 1) {
    await t.test(`rename ${failAt}`, async (t) => {
      const { generated, target, manifest } = await setup(t);
      const before = await contents(target);
      let renames = 0;
      const io = {
        ...fs,
        async rename(source, destination) {
          if (++renames === failAt) throw new Error("injected commit failure");
          return fs.rename(source, destination);
        },
      };
      await assert.rejects(synchronize(generated, target, manifest, io), /injected commit failure/);
      assert.deepEqual(await contents(target), before);
    });
  }
});

test("staging failure leaves all target files intact", async (t) => {
  const { generated, target, manifest } = await setup(t);
  const before = await contents(target);
  await assert.rejects(synchronize(generated, target, manifest, {
    ...fs,
    async writeFile() { throw new Error("injected staging failure"); },
  }), /injected staging failure/);
  assert.deepEqual(await contents(target), before);
});

test("preflight rejects a stale directory before replacing any generated file", async (t) => {
  const { generated, target, manifest } = await setup(t);
  await fs.rm(join(target, "stale.ts"));
  await fs.mkdir(join(target, "stale.ts"));
  await assert.rejects(synchronize(generated, target, manifest), /regular file/);
  assert.equal(await fs.readFile(join(target, "status.ts"), "utf8"), "old status");
  assert.equal((await fs.stat(join(target, "stale.ts"))).isDirectory(), true);
});

test("successful sync publishes manifest last and preserves user files", async (t) => {
  const { generated, target, manifest } = await setup(t);
  const destinations = [];
  await synchronize(generated, target, manifest, {
    ...fs,
    async rename(source, destination) {
      destinations.push(destination);
      return fs.rename(source, destination);
    },
  });
  assert.equal(destinations.at(-1), join(target, "enum-manifest.json"));
  assert.deepEqual(await readManifest(target), manifest);
  assert.deepEqual(await contents(target), {
    "added.ts": "new added", "enum-manifest.json": JSON.stringify(manifest),
    "keep.txt": "user-owned", "status.ts": "new status",
  });
});

test("rollback failure keeps backups and reports their recovery location", async (t) => {
  const { generated, target, manifest } = await setup(t);
  let renames = 0;
  let error;
  try {
    await synchronize(generated, target, manifest, {
      ...fs,
      async rename(source, destination) {
        if (++renames >= 2) throw new Error("disk unavailable");
        return fs.rename(source, destination);
      },
    });
  } catch (caught) { error = caught; }
  assert.match(error?.message ?? "", /Rollback also failed; recovery files are preserved in/);
  const backup = (await fs.readdir(target)).find((name) => name.startsWith(".enum-sync-"));
  assert.ok(backup);
  assert.ok(error.message.includes(join(target, backup)));
  assert.equal(await fs.readFile(join(target, backup, "backup", "status.ts"), "utf8"), "old status");
});

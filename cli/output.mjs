import * as fs from "node:fs/promises";
import { join } from "node:path";

export const manifestName = "enum-manifest.json";
const managedFilePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const codeNamePattern = /^[A-Z][A-Za-z0-9]*$/;

async function readOptionalFile(path, io = fs) {
  let stat;
  try {
    stat = await io.lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Expected a regular file, refusing directory or symbolic link: ${path}`);
  }
  return io.readFile(path);
}

export async function readManifest(root, io = fs) {
  const text = await readOptionalFile(join(root, manifestName), io);
  if (text === undefined) return { version: 2, files: [], types: [] };
  const manifest = JSON.parse(text.toString("utf8"));
  if (!manifest || typeof manifest !== "object" || manifest.version !== 2) {
    throw new Error(`Unsupported enum manifest version in ${root}: expected 2.`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.every((name) => typeof name === "string" && managedFilePattern.test(name))) {
    throw new Error(`Enum manifest contains invalid managed filenames in ${root}; expected flat kebab-case .ts files.`);
  }
  if (new Set(manifest.files).size !== manifest.files.length) {
    throw new Error(`Enum manifest contains duplicate filenames in ${root}.`);
  }
  if (!Array.isArray(manifest.types) || !manifest.types.every((name) => typeof name === "string" && codeNamePattern.test(name))) {
    throw new Error(`Enum manifest contains invalid type names in ${root}.`);
  }
  if (new Set(manifest.types).size !== manifest.types.length) {
    throw new Error(`Enum manifest contains duplicate type names in ${root}.`);
  }
  return manifest;
}

export async function compareOutputs(generatedRoot, targetRoot, manifest) {
  const previousManifest = await readManifest(targetRoot);
  const differences = [];
  for (const filename of [...manifest.files, manifestName]) {
    const generated = await fs.readFile(join(generatedRoot, filename));
    const current = await readOptionalFile(join(targetRoot, filename));
    if (current === undefined || !current.equals(generated)) differences.push(filename);
  }
  for (const filename of previousManifest.files) {
    if (!manifest.files.includes(filename)) differences.push(filename);
  }
  return [...new Set(differences)].sort();
}

// Stage on the target filesystem so each rename is atomic. The io argument is
// internal and lets tests inject a real I/O failure during commit or rollback.
export async function synchronize(generatedRoot, targetRoot, manifest, io = fs) {
  const previousManifest = await readManifest(targetRoot, io);
  const previousFiles = new Set(previousManifest.files);
  const nextFiles = new Set(manifest.files);
  const changes = [];

  // Validate every destination and load every input before changing any file.
  for (const filename of [...manifest.files, manifestName]) {
    const target = join(targetRoot, filename);
    const current = await readOptionalFile(target, io);
    if (filename !== manifestName && current !== undefined && !previousFiles.has(filename)) {
      throw new Error(`Refusing to overwrite unmanaged file: ${target}. Move it or choose a different output directory.`);
    }
    const content = await io.readFile(join(generatedRoot, filename));
    if (current === undefined || !current.equals(content)) {
      changes.push({ filename, content, existed: current !== undefined });
    }
  }
  for (const filename of previousFiles) {
    if (nextFiles.has(filename)) continue;
    if (await readOptionalFile(join(targetRoot, filename), io) !== undefined) {
      changes.push({ filename, existed: true });
    }
  }
  if (changes.length === 0) return;

  // Publish the manifest last, after both writes and stale-file removals.
  changes.sort((left, right) => Number(left.filename === manifestName) - Number(right.filename === manifestName));
  await io.mkdir(targetRoot, { recursive: true });
  const stagingRoot = await io.mkdtemp(join(targetRoot, ".enum-sync-"));
  const applied = [];
  let keepBackup = false;
  try {
    await io.mkdir(join(stagingRoot, "new"));
    await io.mkdir(join(stagingRoot, "backup"));
    for (const change of changes) {
      if (change.content !== undefined) {
        await io.writeFile(join(stagingRoot, "new", change.filename), change.content);
      }
    }
    for (const change of changes) {
      const target = join(targetRoot, change.filename);
      const step = { ...change, backedUp: false, installed: false };
      applied.push(step);
      if (change.existed) {
        await io.rename(target, join(stagingRoot, "backup", change.filename));
        step.backedUp = true;
      }
      if (change.content !== undefined) {
        await io.rename(join(stagingRoot, "new", change.filename), target);
        step.installed = true;
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const step of applied.reverse()) {
      try {
        const target = join(targetRoot, step.filename);
        if (step.installed) await io.unlink(target);
        if (step.backedUp) await io.rename(join(stagingRoot, "backup", step.filename), target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      keepBackup = true;
      throw new Error(`Synchronization failed: ${error.message}. Rollback also failed; recovery files are preserved in ${stagingRoot}: ${rollbackErrors.map((item) => item.message).join("; ")}`, { cause: error });
    }
    throw error;
  } finally {
    if (!keepBackup) await io.rm(stagingRoot, { recursive: true, force: true });
  }
}

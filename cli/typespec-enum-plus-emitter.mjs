#!/usr/bin/env node

import { compile, formatDiagnostic, NodeHost } from "@typespec/compiler";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emitterRoot = packageRoot;
const manifestName = "enum-manifest.json";
const codeNamePattern = /^[A-Z][A-Za-z0-9]*$/;

function usage() {
  return [
    "Usage:typespec-enum-plus-emitter [entrypoint] --output <directory> [--check]",
    "",
    "  entrypoint            TypeSpec file (default: ./main.tsp in the current directory).",
    "  --version             Print the package version.",
    "  --output <directory>  Destination for generated enum modules.",
    "  --check               Compare generated output without writing files.",
  ].join("\n");
}

function parseArgs(args) {
  let output;
  let entrypoint;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      output = args[++index];
      if (!output || output.startsWith("--")) throw new Error("--output requires a directory.");
    } else if (argument === "--check") {
      check = true;
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--version") {
      return { version: true };
    } else if (!argument.startsWith("-") && !entrypoint) {
      entrypoint = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!output) throw new Error("--output is required.");
  entrypoint ??= "main.tsp";
  if (!entrypoint.endsWith(".tsp")) throw new Error("Entrypoint must be a .tsp file.");
  return { entrypoint: resolve(entrypoint), output: resolve(output), check };
}

function resolveManagedPath(root, filename) {
  if (isAbsolute(filename)) throw new Error(`Manifest contains an absolute path: ${filename}`);
  const target = resolve(root, filename);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Manifest path escapes the output directory: ${filename}`);
  }
  return target;
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readManifest(root) {
  const text = await readOptional(join(root, manifestName));
  if (text === undefined) return { version: 2, files: [], types: [] };
  const manifest = JSON.parse(text);
  if (manifest.version !== 2) {
    throw new Error(`Unsupported enum manifest version in ${root}: expected 2, received ${JSON.stringify(manifest.version)}.`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.every((filename) => typeof filename === "string")) {
    throw new Error(`Unsupported enum manifest in ${root}.`);
  }
  if (!Array.isArray(manifest.types) || !manifest.types.every((name) => typeof name === "string" && codeNamePattern.test(name))) {
    throw new Error(`Enum manifest contains invalid type names in ${root}.`);
  }
  if (new Set(manifest.types).size !== manifest.types.length) {
    throw new Error(`Enum manifest contains duplicate type names in ${root}.`);
  }
  for (const filename of manifest.files) resolveManagedPath(root, filename);
  return manifest;
}

async function compileEnums(entrypoint, outputDir) {
  const program = await compile(NodeHost, entrypoint, {
    emit: [emitterRoot],
    outputDir,
    warningAsError: true,
    options: {
      "typespec-enum-plus-emitter": {
        "emitter-output-dir": outputDir,
      },
    },
  });

  if (program.diagnostics.length > 0) {
    for (const diagnostic of program.diagnostics) console.error(formatDiagnostic(diagnostic));
  }
  if (program.hasError()) throw new Error("TypeSpec enum compilation failed.");
}

async function compareOutputs(generatedRoot, targetRoot, manifest) {
  const differences = [];
  for (const filename of [...manifest.files, manifestName]) {
    const generated = await readFile(resolveManagedPath(generatedRoot, filename), "utf8");
    const current = await readOptional(resolveManagedPath(targetRoot, filename));
    if (current !== generated) differences.push(filename);
  }

  const previousManifest = await readManifest(targetRoot);
  for (const filename of previousManifest.files) {
    if (!manifest.files.includes(filename)) differences.push(filename);
  }
  return [...new Set(differences)].sort();
}

async function synchronize(generatedRoot, targetRoot, manifest) {
  const previousManifest = await readManifest(targetRoot);
  await mkdir(targetRoot, { recursive: true });

  for (const filename of manifest.files) {
    const source = resolveManagedPath(generatedRoot, filename);
    const target = resolveManagedPath(targetRoot, filename);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(source));
  }

  for (const filename of previousManifest.files) {
    if (manifest.files.includes(filename)) continue;
    const stalePath = resolveManagedPath(targetRoot, filename);
    try {
      await unlink(stalePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  await writeFile(join(targetRoot, manifestName), await readFile(join(generatedRoot, manifestName)));
}

async function main() {
  const { entrypoint, output, check, version } = parseArgs(process.argv.slice(2));
  if (version) {
    console.log(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version);
    return;
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "typespec-enum-plus-emitter-"));
  try {
    await compileEnums(entrypoint, temporaryRoot);
    const manifest = await readManifest(temporaryRoot);

    if (check) {
      const differences = await compareOutputs(temporaryRoot, output, manifest);
      if (differences.length > 0) {
        console.error(`Generated enums are out of date: ${differences.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Generated enums are up to date in ${output}.`);
      return;
    }

    await synchronize(temporaryRoot, output, manifest);
    console.log(`Generated ${manifest.files.length} enum files in ${output}.`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

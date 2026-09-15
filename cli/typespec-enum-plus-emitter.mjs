#!/usr/bin/env node

import { compile, formatDiagnostic, NodeHost, resolveCompilerOptions } from "@typespec/compiler";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareOutputs, readManifest, synchronize } from "./output.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emitterRoot = packageRoot;
const emitterName = "typespec-enum-plus-emitter";

function usage() {
  return [
    "Usage: typespec-enum-plus-emitter [entrypoint] --output <directory> [--check]",
    "",
    "  entrypoint            TypeSpec file (default: ./main.tsp in the current directory).",
    "  --version             Print the package version.",
    "  --output <directory>  Destination for generated enum modules.",
    "  --check               Compare generated output without writing files.",
    "  --config <path>       Explicit TypeSpec YAML config; only this emitter runs.",
    "  --warnings-as-errors  Treat warnings as errors (default unless configured).",
    "  --no-warnings-as-errors  Allow compilation warnings.",
    "  --api-types-mode <re-export|standalone>  API type output (default: re-export).",
    "  --help, -h            Print this help.",
  ].join("\n");
}

function parseArgs(args) {
  let output;
  let entrypoint;
  let check = false;
  let configPath;
  let warningAsError;
  let apiTypesMode;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      output = args[++index];
      if (!output || output.startsWith("--")) throw new Error("--output requires a directory.");
    } else if (argument === "--config" || argument === "--api-types-mode") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--config") configPath = resolve(value);
      else {
        if (!["re-export", "standalone"].includes(value)) throw new Error("--api-types-mode must be re-export or standalone.");
        apiTypesMode = value;
      }
    } else if (argument === "--warnings-as-errors" || argument === "--no-warnings-as-errors") {
      warningAsError = argument === "--warnings-as-errors";
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
  return { entrypoint: resolve(entrypoint), output: resolve(output), check, configPath, warningAsError, apiTypesMode };
}

async function compileEnums(args, outputDir) {
  let configured = {};
  if (args.configPath) {
    const [options, diagnostics] = await resolveCompilerOptions(NodeHost, {
      entrypoint: args.entrypoint,
      cwd: process.cwd(),
      configPath: args.configPath,
      env: process.env,
    });
    for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic));
    const warningAsError = args.warningAsError ?? options.warningAsError ?? true;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error" || warningAsError)) {
      throw new Error("TypeSpec configuration failed.");
    }
    configured = options;
  }
  const emitterOptions = { ...configured.options?.[emitterName] };
  if (args.apiTypesMode !== undefined) emitterOptions["api-types-mode"] = args.apiTypesMode;
  const program = await compile(NodeHost, args.entrypoint, {
    ...configured,
    emit: [emitterRoot],
    outputDir,
    noEmit: false,
    warningAsError: args.warningAsError ?? configured.warningAsError ?? true,
    options: {
      [emitterName]: { ...emitterOptions, "emitter-output-dir": outputDir },
    },
  });

  for (const diagnostic of program.diagnostics) console.error(formatDiagnostic(diagnostic));
  if (program.hasError()) throw new Error("TypeSpec enum compilation failed.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { output, check, version } = args;
  if (version) {
    console.log(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version);
    return;
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "typespec-enum-plus-emitter-"));
  try {
    await compileEnums(args, temporaryRoot);
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

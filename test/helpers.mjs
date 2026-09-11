import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const cli = resolve(packageRoot, "cli/typespec-enum-plus-emitter.mjs");

export function run(command, args, cwd = packageRoot) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
}

export const fixture = `
using EnumExport;
@exportEnum(#{ domain: "status" })
enum Status {
  @enumItem(#{ label: "启用", order: 1 }) Active: "active",
  @enumItem(#{ label: "", hidden: true }) Empty: "",
}
@exportEnum(#{ domain: "priority" })
enum Priority {
  @enumItem(#{ label: "低" }) Low: 0,
  @enumItem(#{ label: "高" }) High: 1,
}
`;

export const typeUsage = `
import { Status, Priority } from "./generated/index";
import type { StatusValue } from "./generated/status";
import type { Status as ApiStatus } from "./generated/api-types";
const valid: StatusValue = "active";
const apiValid: ApiStatus = valid;
const numeric: typeof Priority.valueType = 0;
void apiValid; void numeric; void Status.Active;
// @ts-expect-error invalid enum value
const invalid: StatusValue = "unknown";
// @ts-expect-error numeric enum does not accept strings
const invalidNumeric: typeof Priority.valueType = "0";
void invalid; void invalidNumeric;
`;

export const tscArgs = ["--noEmit", "--strict", "--skipLibCheck", "--module", "ESNext",
  "--moduleResolution", "Bundler", "--target", "ES2022", "usage.ts", "generated/index.ts"];

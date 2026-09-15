import { createTypeSpecLibrary, paramMessage } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "typespec-enum-plus-emitter",
  emitter: {
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        "api-types-mode": {
          type: "string",
          enum: ["re-export", "standalone"],
          description: "Re-export enum-plus types, or emit independent literal union types. Defaults to re-export.",
        },
      },
      required: [],
    },
  },
  diagnostics: {
    "reserved-domain": {
      severity: "error",
      messages: { default: paramMessage`Enum export domain '${"domain"}' is reserved for generated entrypoints.` },
    },
    "generated-name-conflict": {
      severity: "error",
      messages: { default: paramMessage`Generated name '${"name"}' conflicts with another export or the enum-plus import.` },
    },
    "invalid-domain": {
      severity: "error",
      messages: {
        default: paramMessage`Enum export domain '${"domain"}' must be a kebab-case slug.`,
      },
    },
    "invalid-code-name": {
      severity: "error",
      messages: {
        default: paramMessage`Exported ${"kind"} name '${"name"}' must be an ASCII PascalCase identifier.`,
      },
    },
    "missing-item-metadata": {
      severity: "error",
      messages: {
        default: paramMessage`Exported enum member '${"name"}' must have @enumItem metadata.`,
      },
    },
    "implicit-value": {
      severity: "error",
      messages: {
        default: paramMessage`Exported enum member '${"name"}' must declare an explicit string or numeric value.`,
      },
    },
    "mixed-value-types": {
      severity: "error",
      messages: {
        default: paramMessage`Exported enum '${"name"}' cannot mix string and numeric values.`,
      },
    },
    "duplicate-value": {
      severity: "error",
      messages: {
        default: paramMessage`Exported enum '${"name"}' contains duplicate value ${"value"}.`,
      },
    },
    "duplicate-export-name": {
      severity: "error",
      messages: {
        default: paramMessage`Exported enum name '${"name"}' is already used by another exported enum.`,
      },
    },
  },
});

export const { reportDiagnostic } = $lib;

export const stateKeys = {
  exportedEnums: Symbol.for("EnumExport.exportedEnums"),
  enumItems: Symbol.for("EnumExport.enumItems"),
};

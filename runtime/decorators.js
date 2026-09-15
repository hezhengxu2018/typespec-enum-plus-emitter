import { validateDecoratorUniqueOnNode } from "@typespec/compiler";
import { reportDiagnostic, stateKeys } from "./lib.js";

const domainPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function $exportEnum(context, target, options) {
  if (!validateDecoratorUniqueOnNode(context, target, $exportEnum)) return;

  const domain = options.domain;
  if (!domainPattern.test(domain)) {
    reportDiagnostic(context.program, {
      code: "invalid-domain",
      format: { domain },
      target,
    });
    return;
  }

  if (["index", "api-types"].includes(domain)) {
    reportDiagnostic(context.program, { code: "reserved-domain", format: { domain }, target });
    return;
  }

  context.program.stateMap(stateKeys.exportedEnums).set(target, { domain, name: options.name });
}

export function $enumItem(context, target, options) {
  if (!validateDecoratorUniqueOnNode(context, target, $enumItem)) return;
  context.program.stateMap(stateKeys.enumItems).set(target, { ...options });
}

using TypeSpec.Reflection;

namespace EnumExport;

/** Selects the generated module for an exported enum. */
model ExportEnumOptions {
  /** Safe kebab-case module name, for example `status`. `index` and `api-types` are reserved. */
  domain: string;

  /** Optional generated PascalCase name; defaults to the source enum name. */
  name?: string;
}

/** UI metadata exported with an enum member. */
model EnumItemOptions {
  /** Human-readable display label. */
  label: string;

  /** Longer help text. */
  description?: string;

  /** UI color token. */
  color?: string;

  /** Explicit display order. Ordered items precede unordered items. */
  order?: int32;

  /** Whether the option should be disabled in UI controls. */
  disabled?: boolean;

  /** Whether the value should be excluded from selectable UI options. */
  hidden?: boolean;
}

/** Marks an enum for enum-plus generation. */
extern dec exportEnum(target: Enum, options: valueof ExportEnumOptions);

/** Defines the UI metadata for an exported enum member. */
extern dec enumItem(target: EnumMember, options: valueof EnumItemOptions);

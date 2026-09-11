# typespec-enum-plus-emitter

> English | [中文](#中文)

Generate [enum-plus](https://www.npmjs.com/package/enum-plus) modules with UI metadata from TypeSpec enums. This package provides decorators, a standard TypeSpec emitter, and a CLI with synchronization and drift checking.

## Installation

Requires Node.js >=22. The first release supports TypeSpec `~1.15.0`.

```sh
pnpm add -D typespec-enum-plus-emitter @typespec/compiler@~1.15.0
```

Applications that consume the generated code must install `enum-plus` separately. Version `3.3.0` has been verified:

```sh
pnpm add enum-plus@^3.3.0
```

## Define enums

In `main.tsp`:

```tsp
import "typespec-enum-plus-emitter";
using EnumExport;

@exportEnum(#{ domain: "status" })
enum Status {
  @enumItem(#{ label: "Enabled", color: "success", order: 1 })
  Active: "active",
  @enumItem(#{ label: "Disabled", disabled: true })
  Inactive: "inactive",
}
```

`@exportEnum` specifies the output module's `domain`. `@enumItem` provides the required `label` and the optional `description`, `color`, `order` (`int32`), `disabled`, and `hidden` fields.

- Only TypeSpec `enum` declarations marked for export are processed; unions are not supported.
- Enum and member names must use ASCII PascalCase. Enum names must be globally unique and must not conflict with the generated `FooValue` type or the `Enum` import.
- Every member must have metadata and an explicit string or numeric value. An enum cannot mix value types or contain duplicate values.
- `domain` must use lowercase kebab-case. `index` and `api-types` are reserved names.
- Members with an `order` are sorted in ascending order. Members with the same order, as well as unordered members, retain declaration order.
- `hidden` and `disabled` are emitted as metadata only; they do not remove members or change their value types. The consuming application decides how to display them.

## CLI

```sh
typespec-enum-plus-emitter --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums --check
typespec-enum-plus-emitter --help
typespec-enum-plus-emitter --version
```

The default input is `main.tsp` in the caller's current directory. Relative input and output paths are resolved from the current working directory. The input must be a `.tsp` file. The CLI does not read `tspconfig.yaml`; it runs this package's emitter directly. Use the standard emitter integration below when compiler configuration is required.

Compilation takes place in a temporary directory and the target directory is synchronized only after compilation succeeds. Only stale files listed in the previous manifest are removed; other user files are preserved. Compilation or manifest validation failures do not modify the target directory. Keep the output directory dedicated to generated content and do not edit the manifest manually.

`--check` does not write to the target directory. It exits with code 0 when the output is current, and with code 1 when there is drift, a missing file, or another error, making it suitable for CI checks.

## Standard TypeSpec emitter

Configure `tspconfig.yaml`:

```yaml
emit:
  - typespec-enum-plus-emitter
options:
  typespec-enum-plus-emitter:
    emitter-output-dir: "{output-dir}/enums"
```

Then run `tsp compile .`. The standard emitter only generates files; it does not provide the CLI's stale-file cleanup or drift-checking behavior.

## Generated output

Each domain generates `<domain>.ts`, exporting a runtime constant and a literal union type:

```ts
import { Enum } from 'enum-plus'

export const Status = Enum({
  Active: { value: 'active', label: 'Enabled', color: 'success', order: 1 },
  Inactive: { value: 'inactive', label: 'Disabled', disabled: true },
} as const)

export type StatusValue = typeof Status.valueType
```

- `index.ts` re-exports the constants and `FooValue` types for all domains.
- `api-types.ts` exports types only, for example `export type { StatusValue as Status } from './status'`. It is intended for reuse by API generators and is not included in `index.ts`.
- `enum-manifest.json` has the shape `{ version: 2, files: string[], types: string[] }` and records the managed files and sorted enum names. `files` does not include the manifest itself.

Generated output has no timestamps and can be committed to version control. Even when there are no enums, the generator creates the two entry files and an empty manifest. Generated TypeScript uses extensionless relative imports and targets front-end projects using a bundler.

For specification projects, it is recommended to generate and commit the complete output directory, then consume those artifacts from the front end. This package does not include business specifications and does not download them.

## Development and release

```sh
pnpm install
pnpm test
pnpm test:package
pnpm pack
```

The tests cover installing the tarball into an isolated temporary project, importing the package by name, the CLI, the standard emitter, and type-checking the generated code. Registry access is required for the first test run. CI uses Node.js 22 and 24 with a frozen lockfile.

This repository uses native JavaScript ESM and does not require a build step. Before publishing, confirm ownership of the npm package name and run `pnpm test`, then execute `pnpm publish --access public`. The `prepublishOnly` script runs the tests again. The initial version is `0.1.0`; validate the corresponding TypeSpec version before widening the supported compatibility range.

Before publication, consumer projects can use `file:../typespec-enum-plus-emitter` for local integration testing. Replace it with the registry version after publication.

## License

MIT

---

<a id="中文"></a>

# typespec-enum-plus-emitter（中文）

将 TypeSpec 枚举生成带 UI 元数据的 [enum-plus](https://www.npmjs.com/package/enum-plus) 模块。本工具包提供装饰器、标准 TypeSpec emitter，以及支持同步和漂移检查的 CLI。

## 安装

要求 Node.js >=22。首版支持 TypeSpec `~1.15.0`。

```sh
pnpm add -D typespec-enum-plus-emitter @typespec/compiler@~1.15.0
```

使用生成代码的应用需要自行安装 `enum-plus`。已验证版本为 `3.3.0`：

```sh
pnpm add enum-plus@^3.3.0
```

## 定义枚举

在 `main.tsp` 中：

```tsp
import "typespec-enum-plus-emitter";
using EnumExport;

@exportEnum(#{ domain: "status" })
enum Status {
  @enumItem(#{ label: "启用", color: "success", order: 1 })
  Active: "active",
  @enumItem(#{ label: "停用", disabled: true })
  Inactive: "inactive",
}
```

`@exportEnum` 指定输出模块的 `domain`。`@enumItem` 提供必填的 `label`，以及可选的 `description`、`color`、`order`（`int32`）、`disabled` 和 `hidden`。

- 仅处理标记为导出的 TypeSpec `enum`，不处理 union。
- 枚举和成员名称必须使用 ASCII PascalCase。枚举名称必须全局唯一，且不能与生成的 `FooValue` 类型或 `Enum` 导入冲突。
- 每个成员都必须有元数据和显式的字符串或数字值。单个枚举不得混合值类型或包含重复值。
- `domain` 必须使用小写 kebab-case；`index` 和 `api-types` 是保留名称。
- 有 `order` 的成员按升序排列。同序成员和未设置 `order` 的成员保持声明顺序。
- `hidden` 和 `disabled` 只会作为元数据输出，不会删除成员或改变值类型；由使用方应用决定如何展示。

## CLI

```sh
typespec-enum-plus-emitter --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums --check
typespec-enum-plus-emitter --help
typespec-enum-plus-emitter --version
```

默认输入是调用者当前目录下的 `main.tsp`。输入和输出的相对路径均相对当前工作目录解析。输入必须是 `.tsp` 文件。CLI 不读取 `tspconfig.yaml`，而是直接运行本工具包的 emitter；需要编译配置时，请使用下方的标准 emitter 接入方式。

编译会先在临时目录中完成，只有成功后才同步到目标目录。工具只会清理上一次 manifest 记录的过期文件，并保留其他用户文件。编译或 manifest 校验失败不会修改目标目录。请将输出目录专用于生成内容，不要手动修改 manifest。

`--check` 不会写入目标目录。输出一致时退出码为 0；存在漂移、缺失文件或其他错误时退出码为 1，适合用于 CI 检查。

## 标准 TypeSpec emitter

在 `tspconfig.yaml` 中配置：

```yaml
emit:
  - typespec-enum-plus-emitter
options:
  typespec-enum-plus-emitter:
    emitter-output-dir: "{output-dir}/enums"
```

然后运行 `tsp compile .`。标准 emitter 只负责生成文件，不提供 CLI 的旧文件清理或漂移检查功能。

## 生成产物

每个领域会生成 `<domain>.ts`，导出运行时常量和字面量联合类型：

```ts
import { Enum } from 'enum-plus'

export const Status = Enum({
  Active: { value: 'active', label: '启用', color: 'success', order: 1 },
  Inactive: { value: 'inactive', label: '停用', disabled: true },
} as const)

export type StatusValue = typeof Status.valueType
```

- `index.ts` 统一导出所有领域的常量和 `FooValue` 类型。
- `api-types.ts` 仅导出类型，例如 `export type { StatusValue as Status } from './status'`，便于 API 生成器复用；它不会被纳入 `index.ts`。
- `enum-manifest.json` 的结构为 `{ version: 2, files: string[], types: string[] }`，记录受管理的文件和排序后的枚举名称。`files` 不包含 manifest 自身。

生成结果不包含时间戳，可以提交到版本控制。即使没有任何枚举，也会生成两个入口文件和一个空 manifest。生成的 TypeScript 使用无扩展名的相对导入，面向使用 bundler 的前端工程。

在规范项目中，建议生成并提交完整的产物目录，再由前端消费这些产物。本工具包不包含业务规范，也不会下载规范。

## 开发与发布

```sh
pnpm install
pnpm test
pnpm test:package
pnpm pack
```

测试覆盖在独立临时项目中安装 tarball、按包名导入、CLI、标准 emitter，以及生成代码的类型检查。首次运行测试需要访问 registry。CI 使用 Node.js 22 和 24，并启用冻结 lockfile。

本仓库使用原生 JavaScript ESM，无需构建。发布前请确认 npm 包名的所有权，运行 `pnpm test`，然后执行 `pnpm publish --access public`。`prepublishOnly` 会再次执行测试。初始版本为 `0.1.0`；扩大 TypeSpec 兼容范围前，请先验证对应版本。

发布前，消费项目可以使用 `file:../typespec-enum-plus-emitter` 进行本地联调；发布后替换为 registry 版本。

## 许可证

MIT

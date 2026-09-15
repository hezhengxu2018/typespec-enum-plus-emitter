# typespec-enum-plus-emitter

> English | [中文](#中文)

Generate [enum-plus](https://www.npmjs.com/package/enum-plus) modules with UI metadata from TypeSpec enums. This package provides decorators, a standard TypeSpec emitter, and a CLI with synchronization and drift checking.

## Installation

Requires Node.js >=22. The first release supports TypeSpec `~1.15.0`.

```sh
pnpm add -D typespec-enum-plus-emitter @typespec/compiler@~1.15.0
```

Applications that consume the generated runtime modules must install `enum-plus` separately. Consumers of a standalone `api-types.ts` do not need it. Version `3.3.0` has been verified:

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

`@exportEnum` specifies the output module's `domain` and an optional generated `name`. `@enumItem` provides the required `label` and the optional `description`, `color`, `order` (`int32`), `disabled`, and `hidden` fields.

- Only TypeSpec `enum` declarations marked for export are processed; unions are not supported.
- Generated enum names and member names must use ASCII PascalCase. Generated enum names must be globally unique and must not conflict with the generated `FooValue` type or the `Enum` import. Set `name` to keep a different source name or resolve collisions between namespaces.
- Every member must have metadata and an explicit string or numeric value. An enum cannot mix value types or contain duplicate values.
- `domain` must use lowercase kebab-case. `index` and `api-types` are reserved names.
- Members with an `order` are sorted in ascending order. Members with the same order, as well as unordered members, retain declaration order.
- `hidden` and `disabled` are emitted as metadata only; they do not remove members or change their value types. The consuming application decides how to display them.

### Export aliases

```tsp
namespace Sales {
  @exportEnum(#{ domain: "sales", name: "SalesStatus" })
  enum Status {
    @enumItem(#{ label: "Open" }) Open: "open",
  }
}
```

This generates `SalesStatus`, `SalesStatusValue`, and the `SalesStatus` API type without renaming the source `Sales.Status` enum.

## CLI

```sh
typespec-enum-plus-emitter --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums --check
typespec-enum-plus-emitter --help
typespec-enum-plus-emitter --version
```

The default input is `main.tsp` in the caller's current directory. Relative input, output and config paths are resolved from the current working directory. The input must be a `.tsp` file. By default the CLI does not read `tspconfig.yaml`; pass `--config <path>` to load a TypeSpec YAML config explicitly.

```sh
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums --config ./spec/tspconfig.yaml
typespec-enum-plus-emitter --output generated/enums --no-warnings-as-errors
typespec-enum-plus-emitter --output generated/enums --api-types-mode standalone
```

- Precedence: explicit CLI flags > loaded configuration > defaults. The CLI defaults to treating warnings as errors; use `--no-warnings-as-errors` to allow warnings or `--warnings-as-errors` to enforce them. The config equivalent is `warn-as-error`.
- Config imports, lint rules, interpolation and `extends` use TypeSpec's native resolution. In TypeSpec 1.15, a child config's `options` replaces the parent's entire `options` block rather than merging individual emitter settings.
- The CLI always runs only this package's emitter and generates into its temporary directory before syncing to `--output`. Configured `emit`, `output-dir` and `emitter-output-dir` do not change this behavior. Input selection remains the positional `.tsp` argument or `./main.tsp`.
- `--api-types-mode re-export|standalone` overrides the corresponding emitter option. The default is `re-export`.

Compilation takes place in a temporary directory and the target directory is synchronized only after compilation succeeds. Only stale files listed in the previous manifest are removed. An existing file with a generated filename must already be listed in that manifest; otherwise synchronization fails without overwriting it, even if its contents match. Move the conflicting file or choose a different output directory. Other user files are preserved.

Synchronization validates all managed paths before replacing files, rejects symbolic links and directories at managed file paths, and skips files whose contents have not changed (preserving their modification times). Changed files are staged on the destination filesystem and installed by rename, with the manifest published last. If an I/O operation fails during staging or commit, the CLI attempts to restore the previous files. If recovery also fails, the error reports a `.enum-sync-*` directory containing recovery files; preserve it until recovery is complete.

This is per-file replacement with rollback, not an atomic switch of the entire directory. Process termination, power loss and concurrent writers are not covered by rollback; run one writer per output directory. Compilation or manifest validation failures leave existing target files unchanged. Keep the output directory dedicated to generated content and do not edit the manifest manually.

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

The emitter accepts the following options; unknown options and invalid values are rejected:

| Option | Values | Default |
| --- | --- | --- |
| `emitter-output-dir` | Output directory (TypeSpec built-in) | TypeSpec emitter output directory |
| `api-types-mode` | `re-export`, `standalone` | `re-export` |

For independent API types, add `api-types-mode: standalone` next to `emitter-output-dir`.

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
- `api-types.ts` exports types only and is not included in `index.ts`. By default it re-exports types, for example `export type { StatusValue as Status } from './status'`. With `api-types-mode: standalone`, it instead declares literal unions such as `export type Status = 'active' | 'inactive'`, with no imports or dependency on the runtime modules or `enum-plus`. Empty enums become `never`. Both modes use the generated alias, when supplied.
- `enum-manifest.json` has the shape `{ version: 2, files: string[], types: string[] }` and records the managed files and sorted generated enum names (including aliases). `files` contains unique flat kebab-case `.ts` filenames and does not include the manifest itself.

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

使用生成的运行时模块的应用需要自行安装 `enum-plus`；仅使用独立模式 `api-types.ts` 的项目不需要它。已验证版本为 `3.3.0`：

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

`@exportEnum` 指定输出模块的 `domain`，并支持通过可选的 `name` 指定生成名称。`@enumItem` 提供必填的 `label`，以及可选的 `description`、`color`、`order`（`int32`）、`disabled` 和 `hidden`。

- 仅处理标记为导出的 TypeSpec `enum`，不处理 union。
- 生成的枚举名称和成员名称必须使用 ASCII PascalCase。生成的枚举名称必须全局唯一，且不能与生成的 `FooValue` 类型或 `Enum` 导入冲突。可以通过 `name` 保留不同风格的源枚举名称，或解决不同命名空间中的重名问题。
- 每个成员都必须有元数据和显式的字符串或数字值。单个枚举不得混合值类型或包含重复值。
- `domain` 必须使用小写 kebab-case；`index` 和 `api-types` 是保留名称。
- 有 `order` 的成员按升序排列。同序成员和未设置 `order` 的成员保持声明顺序。
- `hidden` 和 `disabled` 只会作为元数据输出，不会删除成员或改变值类型；由使用方应用决定如何展示。

### 导出别名

```tsp
namespace Sales {
  @exportEnum(#{ domain: "sales", name: "SalesStatus" })
  enum Status {
    @enumItem(#{ label: "开放" }) Open: "open",
  }
}
```

生成的常量为 `SalesStatus`，值类型为 `SalesStatusValue`，API 类型为 `SalesStatus`，无需修改源枚举 `Sales.Status` 的名称。

## CLI

```sh
typespec-enum-plus-emitter --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums --check
typespec-enum-plus-emitter --help
typespec-enum-plus-emitter --version
```

默认输入是调用者当前目录下的 `main.tsp`。输入、输出和配置文件的相对路径均相对当前工作目录解析。输入必须是 `.tsp` 文件。CLI 默认不读取 `tspconfig.yaml`；通过 `--config <path>` 显式加载 TypeSpec YAML 配置。

```sh
typespec-enum-plus-emitter ./spec/main.tsp --output generated/enums --config ./spec/tspconfig.yaml
typespec-enum-plus-emitter --output generated/enums --no-warnings-as-errors
typespec-enum-plus-emitter --output generated/enums --api-types-mode standalone
```

- 优先级：显式 CLI 参数 > 已加载的配置 > 默认值。CLI 默认将警告视为错误；使用 `--no-warnings-as-errors` 允许警告，使用 `--warnings-as-errors` 强制警告阻断生成。配置文件中的对应选项为 `warn-as-error`。
- 配置中的 imports、lint 规则、变量插值和 `extends` 使用 TypeSpec 原生解析。在 TypeSpec 1.15 中，子配置的 `options` 会整体替换父配置的 `options`，不会逐项合并 emitter 配置。
- CLI 始终只运行本工具包的 emitter，在临时目录中生成后再同步到 `--output`。配置中的 `emit`、`output-dir` 和 `emitter-output-dir` 不会改变这一行为。输入入口仍由位置参数指定，默认为 `./main.tsp`。
- `--api-types-mode re-export|standalone` 覆盖 emitter 中的同名配置，默认为 `re-export`。

编译会先在临时目录中完成，只有成功后才同步到目标目录。工具只会清理上一次 manifest 记录的过期文件。如果目标目录已存在与生成文件同名、但未被旧 manifest 记录的文件，即使内容相同也会拒绝覆盖；请移动冲突文件或更换输出目录。其他用户文件会被保留。

同步会在替换文件前检查所有受管理路径，拒绝这些文件路径上的符号链接和目录；内容未变化的文件会跳过写入，保留修改时间。变化文件先在目标文件系统中暂存，再通过重命名安装，最后更新 manifest。暂存或提交过程中出现 I/O 错误时，CLI 会尝试恢复原文件；如果恢复也失败，错误信息会指出保存恢复文件的 `.enum-sync-*` 目录，请在完成恢复前保留该目录。

此机制提供逐文件替换和失败回滚，不保证整个目录同时切换。进程被终止、断电和并发写入不在回滚保证范围内；同一输出目录请只运行一个写入任务。编译或 manifest 校验失败不会改变已有目标文件。请将输出目录专用于生成内容，不要手动修改 manifest。

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

emitter 支持以下配置；未知配置和非法值会报错：

| 配置 | 可选值 | 默认值 |
| --- | --- | --- |
| `emitter-output-dir` | 输出目录（TypeSpec 内置） | TypeSpec emitter 输出目录 |
| `api-types-mode` | `re-export`、`standalone` | `re-export` |

需要独立 API 类型时，在 `emitter-output-dir` 同级添加 `api-types-mode: standalone`。

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
- `api-types.ts` 仅导出类型，不会被纳入 `index.ts`。默认重新导出类型，例如 `export type { StatusValue as Status } from './status'`。设置 `api-types-mode: standalone` 后，直接生成 `export type Status = 'active' | 'inactive'` 这样的字面量联合类型，没有任何导入，也不依赖运行时模块或 `enum-plus`。空枚举生成为 `never`。两种模式都会使用配置的导出别名。
- `enum-manifest.json` 的结构为 `{ version: 2, files: string[], types: string[] }`，记录受管理的文件和排序后的生成枚举名称（包含别名）。`files` 只接受不重复、不含子目录的小写 kebab-case `.ts` 文件名，不包含 manifest 自身。

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

## 许可证

MIT

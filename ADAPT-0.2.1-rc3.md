# dsh-purge × DSH 0.2.1-rc.3 适配说明

fork 基线：上游 tag `v1.1.82`
本地版本：`1.1.82-dsh0.2.1rc3`
适配对象：`D:\DSH`，`@deepseek-ai/dsh-desktop 0.2.1-rc.3`，Electron 44.7.0 / Node 24.21.0

---

## 为什么需要这次适配

上游 1.1.82 的 `dshTarget` 是 `0.2.1-rc.2`，release-notes 里明写了 **#176：不支持 0.2.1-rc.3 及更新的 rc**。
但实测后发现：**真正会让插件当场炸掉的只有一个地方**，其余失配都是"跳过但不阻断"。

### 致命项：`{{cwd}}` 让整轮对话失败

上一轮装完 dsh-purge 后立刻出现：

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
registered variables: provider, model
```

链路（DSH 侧）：

- `dsh-system-prompt/lib/index.js:241` — `text: config.personaSuffix ?? ""`
- 同文件 `:118` — `renderPrompt()` 对 `interpolate !== false` 的段逐个插值
- 同文件 `:172-174` — 变量没注册就 throw，**整轮对话作废**
- rc.3 只注册 `provider` / `model` 两个变量，**没有 `cwd`**

来源（dsh-purge 侧）：

- 旧版 1.1.71 的 `cordis.patch.yml` 写着 `personaSuffix: Your working directory is {{cwd}}.`
- 1.1.82 已改成 `personaSuffix: ""`，但**防护不完整**：`sanitizeCwdTokens()` 只做文案替换，没关插值开关

### 修法

`lib/identity.js` 的 `sanitizeCwdTokens()` 加了两层：

1. 原有逻辑：`cwd` 不可用就把 `{{cwd}}` 换成静态文案
2. **新增兜底**：替换后若仍含任何未注册的 `{{name}}`，整段打 `interpolate: false`

```js
function hasUnregisteredVar(text, variables) {
  const re = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
  for (const m of String(text || "").matchAll(re)) {
    if (!variables || !Object.hasOwn(variables, m[1])) return true;
  }
  return false;
}
```

关键点：**不能只盯着 `cwd`**。宿主的 `interpolate()` 对任何未注册变量都抛错，所以认的是"未注册"这个集合，不是单个名字。

实测对照（用 DSH 的 `renderPrompt` 逻辑复刻）：

| 场景 | 结果 |
|---|---|
| 修复前：裸段 `{{cwd}}` + 只注册 provider/model | `抛出 unknown prompt variable "{{cwd}}"` |
| 修复后：同段加 `interpolate: false` | `渲染出 "Your working directory is {{cwd}}."`，不抛错 |

---

## 补丁可用性：82 个的真实分布

用 `applyReplacementsToText` 的**真实语义**判：每条 pattern 独立判定，命中就替换、未命中跳过。所以判据是「至少一条 pattern 命中」，**不是「全部命中」**。

| 分类 | 数量 | 阻断 Apply？ |
|---|---|---|
| `applied`（可落地） | 63 | 否 |
| `already`（已应用） | 6 | 否 |
| `missing_file`（rc.3 无此文件） | 7 | **否** |
| `pattern_not_found`（锚点失配） | 6 | **否** |
| **blocking** | **0** | — |

`core.js` 的 `ALWAYS_SOFT_STATUSES` 明确包含 `missing_file` / `skipped` / `na`：

```js
const ALWAYS_SOFT_STATUSES = new Set(["applied", "already", "missing_file", "skipped", "na", "off"]);
```

`summarizeApplyReport()` 里 blocking 的判定是：

```js
blocking = failed.filter(row => row.status !== "pattern_not_found");
```

→ **实测 `failed = 0`、`blocking = 0`**。点「应用」不会中断。

### 7 个 `missing_file` 是什么

官方 rc.3 **重构掉了这些文件**，不是补丁写错：

| 补丁 | 缺失的文件键 | 现实 |
|---|---|---|
| `#30` `#31` `#64` `#65` | `hooks-claude-code` / `hooks-codex` | rc.3 已无 `dsh-hooks-*` 包 |
| `#71` | `preset-liangshen` / `preset-liangshen-pkg` | 无 liangshen 预设 |
| `#76` `#24` `#28` | `preset-unrestricted` / `liangshen-tool-bootstrap` | 同上 |

这些都是 `optional`（`#71` 靠 `strictFiles` + `pattern_not_found` 归入 soft），不影响主流程。

### 6 个 `pattern_not_found` 是什么

| 补丁 | 原因 |
|---|---|
| `#21 BASH_TIMEOUT_RESTORE` | 历史迁移：清掉旧版曾写死的 `timeoutMs: 60000`。本机从未命中，空操作 |
| `#80 MINIMAL_OFFICIAL_TOOLSET` | 撤销自己曾往 minimal 预设追加的 tool-fs/tool-web；rc.3 上从未追加过 |
| `#50` `#53` `#77` `#88` | 文案随 0.2.1 变了，但都是 `optional` |

---

## 版本声明

```json
"version": "1.1.82-dsh0.2.1rc3",
"dshTarget": "0.2.1-rc.3"
```

`dshTarget` 从上游的 `0.2.1-rc.2` 改成 `rc.3`，让面板状态判定按实际目标计算。

---

## 已做的现场清理

| 项 | 处理 |
|---|---|
| `node_modules\.ignored\dsh-purge.disabled`（1.1.71，含 `{{cwd}}`） | **已移出**到 `插件备份\dsh-purge-1.1.71-ignored-residual`，防止日后被自愈逻辑捞回 |
| profile 旧 `package.json` | 备份为 `package.json.before-purge-20261030-023147` |

---

## 桌面宿主定位（rc.3 关键差异）

rc.3 把 **305 个 `@deepseek-ai` 包全塞进 `app.asar`**（174 MB），`resources\app.asar.unpacked` 只有 3 个包。
所以 `resources\app` 不存在时，`targetFiles()` 找不到任何补丁目标 —— **必须先解包**。

实测路径探测全部正确：

```
isOfficialHarnessExecutable  → true
appAsarPath                  → D:\DSH\resources\app.asar
appDirForExecutable          → D:\DSH\resources\app
sealedAsarHandoff            → {exe, asar, swapAsar: true}
detectSurface(真实 exe)       → desktop
```

一个测试期的假象：在 `node.exe` 里调 `detectSurface()` 会返回 `web`，因为 `process.execPath` 是 `node.exe`。
真实宿主里 `execPath` 是 `DeepSeek Harness.exe`，正确判成 `desktop`。所以自检脚本必须**显式传入真实 exe 路径**，不能靠 `process.execPath`。

---

## 复验方式

```powershell
cd E:\必要插件维护\dsh-purge-fix
node scripts\selftest.mjs
```

- 解包前：16 项结构检查全过，补丁明细跳过
- 点「应用」解包后复跑：会逐条列出 82 个补丁的落地状态

`scripts\anchor-diff.mjs`：逐补丁锚点诊断，`--bad` 只看失配，`--id 15` 看单条详情。

---

## 尚未验证的部分（如实标注）

1. **解包后的真实 apply 未跑过** —— 需要宿主进程里点「应用」才会触发，我只能在沙盘里模拟。沙盘结论是 `blocking = 0`，但真机结果以点完「应用」后的面板为准。
2. **Web 端 client 半边未验证** —— `client.js`（515 KB）依赖 `@deepseek-ai/dsh-client-*` 运行时，需要浏览器里加载才算数。
3. **`#71` 保留为 `optional: false`** —— 没有改成 optional，因为真正的软判定路径是 `strictFiles` + `pattern_not_found`，改标记反而会让状态语义失真。

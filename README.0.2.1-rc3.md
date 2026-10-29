# dsh-purge (0.2.1-rc.3 fork)

> **这是 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 的派生版本。**
> 上游采用 Apache License 2.0；本派生作品保留原 `LICENSE`、`NOTICE` 与署名，改动内容在下方逐条列明。

---

## 这个 fork 做了什么

只做一件事：**让 dsh-purge 在 DSH `0.2.1-rc.3` 上不炸、不中断**。

上游 1.1.82 的 `dshTarget` 是 `0.2.1-rc.2`，release-notes #176 明写"不支持 0.2.1-rc.3 及更新的 rc"。本次适配基于实测，不是照抄声明。

### 1. 修掉 `{{cwd}}` 导致的整轮对话失败（关键）

**现象**

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
registered variables: provider, model
```

**链路**

| 侧 | 位置 | 行为 |
|---|---|---|
| DSH | `dsh-system-prompt/lib/index.js:241` | `text: config.personaSuffix ?? ""` |
| DSH | 同文件 `:118` | `renderPrompt()` 对 `interpolate !== false` 的段逐个插值 |
| DSH | 同文件 `:172-174` | 变量未注册即 `throw`，**整轮作废** |
| dsh-purge | 旧版 `cordis.patch.yml` | 写入 `personaSuffix: Your working directory is {{cwd}}.` |

rc.3 只注册 `provider` / `model`，**没有 `cwd`**。

**改法** — `lib/identity.js` 的 `sanitizeCwdTokens()` 增加兜底：

```js
const ANY_VAR_TOKEN_TEST = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/;

function hasUnregisteredVar(text, variables) {
  const t = String(text || "");
  if (!t.includes("{{")) return false;
  const re = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
  for (const m of t.matchAll(re)) {
    if (!variables || !Object.hasOwn(variables, m[1])) return true;
  }
  return false;
}
```

替换后若仍含**任何**未注册的 `{{name}}`，整段打 `interpolate: false`。

要点：**不能只盯 `cwd`**。宿主的 `interpolate()` 对任何未注册变量都抛错，认的是"未注册"这个集合。

### 2. 版本声明

```json
"version": "1.1.82-dsh0.2.1rc3",
"dshTarget": "0.2.1-rc.3"
```

### 3. 两个诊断/自检工具

| 文件 | 用途 |
|---|---|
| `scripts/anchor-diff.mjs` | 逐补丁锚点诊断。`--bad` 只看失配，`--id 15` 看单条详情 |
| `scripts/selftest.mjs` | 16 项结构检查 + 解包后逐条核对 82 个补丁 |

---

## 82 个补丁在 rc.3 上的实际情况

判据用 `applyReplacementsToText` 的真实语义：每条 pattern 独立判定，命中就替换、未命中的跳过。所以判据是「**至少一条**命中」，不是「全部命中」。

| 分类 | 数量 | 阻断 Apply |
|---|---|---|
| `applied` | 63 | 否 |
| `already` | 6 | 否 |
| `missing_file` | 7 | **否** |
| `pattern_not_found` | 6 | **否** |
| **blocking** | **0** | — |

依据：`core.js` 的 `ALWAYS_SOFT_STATUSES` 含 `missing_file` / `skipped` / `na`，且 blocking 判定为 `status !== "pattern_not_found"`。

### 7 个 `missing_file`：官方 rc.3 重构掉了源文件

| 补丁 | 缺失键 | 现实 |
|---|---|---|
| `#30` `#31` `#64` `#65` | `hooks-claude-code` / `hooks-codex` | rc.3 已无 `dsh-hooks-*` 包 |
| `#71` | `preset-liangshen` / `preset-liangshen-pkg` | 无 liangshen 预设 |
| `#76` `#24` `#28` | `preset-unrestricted` / `liangshen-tool-bootstrap` | 同上 |

### 6 个 `pattern_not_found`：文案变了或本就是空操作

| 补丁 | 原因 |
|---|---|
| `#21 BASH_TIMEOUT_RESTORE` | 历史迁移：清掉旧版写死的 `timeoutMs: 60000`，本机从未命中 |
| `#80 MINIMAL_OFFICIAL_TOOLSET` | 撤销自己曾往 minimal 追加的行；rc.3 从未追加过 |
| `#50` `#53` `#77` `#88` | 文案随 0.2.1 变化 |

---

## 复验

```powershell
node scripts\selftest.mjs                        # 默认 D:\DSH
node scripts\selftest.mjs --install <DSH目录>
```

- 解包前：16 项结构检查
- 点「应用」解包后复跑：逐条列出 82 个补丁状态

---

## 未验证的部分（如实标注）

1. **解包后的真机 apply 未跑过** —— rc.3 把 305 个包全塞进 174 MB 的 `app.asar`，`resources\app` 不存在，必须先点「应用」解包。沙盘结论 `blocking = 0`，真机以面板为准。
2. **Web 端 client 半边未验证** —— `client.js` 依赖 `@deepseek-ai/dsh-client-*`，需浏览器实载。
3. **`#71` 保留 `optional: false`** —— 真正的软判定路径是 `strictFiles` + `pattern_not_found`，改标记会失真。

---

## 安装

```powershell
# 本机已有 profile 时，替换 node_modules\dsh-purge 内容即可
# 并把 dsh-purge 加进 profile package.json 的 dsh.profile.bundles
```

profile 路径：`%DSH_HOME%\profiles\desktop`

---

## 许可与署名

- 上游仓库：https://github.com/YuJunZhiXue/dsh-purge
- 许可证：Apache License 2.0（见 `LICENSE`）
- 派生作品须保留 `NOTICE` 与署名（见 `NOTICE`）
- 商业授权：见 `LICENSE-COMMERCIAL.md`

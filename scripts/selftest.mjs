/**
 * selftest.mjs — dsh-purge 0.2.1-rc.3 适配自检
 *
 * 不依赖宿主进程，用真实 exe 路径模拟桌面判定，逐项给出 PASS/FAIL。
 *
 * 用法：
 *   node scripts/selftest.mjs                     # 用默认 D:\DSH
 *   node scripts/selftest.mjs --install <目录>     # 指定 DSH 安装目录
 *
 * 退出码：0 全过 / 1 有 FAIL
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const INSTALL = opt("--install", "D:\\DSH");
const EXE = path.join(INSTALL, "DeepSeek Harness.exe");
const RES = path.join(INSTALL, "resources");
const ASAR = path.join(RES, "app.asar");

const PURGE = "C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\dsh-purge";

const results = [];
const check = (name, fn) => {
  try {
    const r = fn();
    results.push({ name, ok: r === true || r === undefined, detail: typeof r === "string" ? r : "" });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};

const core    = await import(`file:///${PURGE.replace(/\\/g, "/")}/lib/core.js`);
const surface = await import(`file:///${PURGE.replace(/\\/g, "/")}/lib/surface.js`);
const desktop = await import(`file:///${PURGE.replace(/\\/g, "/")}/lib/desktop.js`);
const idn     = await import(`file:///${PURGE.replace(/\\/g, "/")}/lib/identity.js`);

// ── 1. 安装与版本 ────────────────────────────────────────────────────────────
check("安装存在", () => fs.existsSync(path.join(PURGE, "package.json")) || "package.json 缺失");
check("版本已声明 0.2.1-rc.3", () => {
  const j = JSON.parse(fs.readFileSync(path.join(PURGE, "package.json"), "utf8"));
  return j.dshTarget === "0.2.1-rc.3" || `dshTarget=${j.dshTarget}`;
});
check("bundle patch 文件存在", () => fs.existsSync(path.join(PURGE, "cordis.patch.yml")));
check("bundle patch 不含 {{cwd}}", () => {
  const t = fs.readFileSync(path.join(PURGE, "cordis.patch.yml"), "utf8");
  return !t.includes("{{cwd}}") || "cordis.patch.yml 仍写入 {{cwd}}";
});

// ── 2. 宿主定位 ──────────────────────────────────────────────────────────────
check("DSH 可执行文件", () => fs.existsSync(EXE) || `${EXE} 不存在`);
check("app.asar 存在", () => fs.existsSync(ASAR) || `${ASAR} 不存在`);
check("官方 exe 识别", () => desktop.isOfficialHarnessExecutable(EXE) === true);
check("asar 路径解析", () => {
  const p = desktop.appAsarPath(EXE);
  return p === ASAR || `得到 ${p}`;
});
check("桌面面判定（真实 execPath）", () => {
  const s = surface.detectSurface({ execPath: EXE, resourcesPath: RES });
  return s === "desktop" || `detectSurface=${s}`;
});
check("sealedAsarHandoff（真实 execPath）", () => {
  const h = core.sealedAsarHandoff({ execPath: EXE, resourcesPath: RES });
  return (h && h.asar === ASAR) || `handoff=${JSON.stringify(h)}`;
});

// ── 3. {{cwd}} 加固 ──────────────────────────────────────────────────────────
check("CWD 常量存在", () => typeof idn.CWD_ONLY_SUFFIX === "string");
check("无 cwd 时 cwdVariableSupported=false", () => {
  const asm = { variables: { provider: "p", model: "m" } };
  return idn.cwdVariableSupported(asm) === false;
});
check("persona-suffix 的 {{cwd}} 被改写", () => {
  const asm = { variables: { provider: "p", model: "m" } };
  const out = idn.overlayOfficialIdentity(
    [{ name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}." }],
    { cwdSupported: idn.cwdVariableSupported(asm) },
  );
  const joined = JSON.stringify(out);
  return !joined.includes("{{cwd}}") || `仍残留 {{cwd}}: ${joined}`;
});

// ── 4. 补丁可用性 ────────────────────────────────────────────────────────────
check("补丁总数 82", () => core.ALL_PATCHES.length === 82 || `实际 ${core.ALL_PATCHES.length}`);

const patsOf = (p) => {
  const a = [];
  if (p.patterns) a.push(...p.patterns);
  if (p.replacements) for (const r of p.replacements) if (r.pattern) a.push(r.pattern);
  return a;
};

/**
 * 判断补丁在「已解包的 aiBase」上能否落地。
 * 未解包时只能做结构性检查：依赖的 file 键是否能在 rc.3 的包布局里找到。
 */
function aiBaseFromUnpacked() {
  const u = path.join(RES, "app.asar.unpacked", "dsh", "node_modules", "@deepseek-ai");
  if (!fs.existsSync(u)) return null;
  // rc.3 的 asar.unpacked 里只有 3 个包；真正的 305 个在 asar 内。
  // 少于 50 个包即视为「尚未解包」，补丁无法逐条核对。
  const n = fs.readdirSync(u).length;
  return n >= 50 ? u : null;
}
const AI = aiBaseFromUnpacked();

if (!AI) {
  const u = path.join(RES, "app.asar.unpacked", "dsh", "node_modules", "@deepseek-ai");
  const n = fs.existsSync(u) ? fs.readdirSync(u).length : 0;
  results.push({
    name: "aiBase 尚未解包",
    ok: true,
    detail: `app.asar.unpacked 下仅 ${n} 个 @deepseek-ai 包（<50 视为未解包）。补丁明细跳过 —— 在插件面板点「应用」完成解包后复跑本脚本即可逐条核对。`,
  });
}
if (AI) {
  const EXTRA = {
    "desktop-shell":            [path.join(RES, "app", "lib", "main.js")],
    "pi-ai-anthropic-messages": [path.join(RES, "app", "dsh", "node_modules", "@earendil-works", "pi-ai", "dist", "api", "anthropic-messages.js")],
    "pi-ai-completions":        [path.join(RES, "app", "dsh", "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js")],
    "pi-ai-responses-shared":   [path.join(RES, "app", "dsh", "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-responses-shared.js")],
    "system-prompt-nested":     [path.join(AI, "dsh-system-prompt", "lib", "index.js")],
    "tool-web-nested":          [path.join(AI, "dsh-tool-web", "lib", "index.js")],
    "user-approval-invariant":  [path.join(AI, "dsh-user-approval", "lib", "types", "index.js")],
  };
  const files = { ...core.targetFiles(AI), ...EXTRA };
  const keysOf = (p) => (Array.isArray(p.file) ? p.file : [p.file]);
  const pathsOf = (k) => { const v = files[k]; return v ? (Array.isArray(v) ? v : [v]) : []; };

  const report = [];
  for (const p of core.ALL_PATCHES) {
    const keys = keysOf(p);
    const pats = patsOf(p);
    let applied = 0, already = 0, missing = 0, notFound = 0;
    for (const k of keys) {
      const fps = pathsOf(k);
      if (!fps.length) { missing++; continue; }
      for (const fp of fps) {
        let t;
        try { t = fs.readFileSync(fp, "utf8"); } catch { missing++; continue; }
        if (p.markers && p.markers.some((m) => t.includes(m))) { already++; continue; }
        let hit = false;
        for (const pat of pats) {
          if (pat instanceof RegExp ? pat.test(t) : t.includes(pat)) { hit = true; break; }
        }
        if (hit) applied++; else notFound++;
      }
    }
    let status;
    if (p.strictFiles && notFound > 0) status = "pattern_not_found";
    else if (applied > 0) status = "applied";
    else if (already > 0 && notFound === 0) status = "already";
    else if (missing === keys.length) status = "missing_file";
    else if (notFound === 0) status = "skipped";
    else status = "pattern_not_found";
    report.push({ patch_id: p.id, name: p.name, status });
  }

  const sum = core.summarizeApplyReport(report, core.ALL_PATCHES);
  const blocking = sum.failed.filter((r) => r.status !== "pattern_not_found");

  check("无阻塞补丁（blocking=0）", () =>
    blocking.length === 0 || `blocking=${blocking.map((b) => "#" + b.patch_id + " " + b.status).join(", ")}`);
  check("可落地的补丁数 ≥ 60", () => {
    const n = report.filter((r) => r.status === "applied" || r.status === "already").length;
    return n >= 60 || `仅 ${n}`;
  });

  results.push({ name: "— 补丁落地明细 —", ok: true, detail: "" });
  for (const r of report) {
    results.push({
      name: `#${String(r.patch_id).padStart(2)} ${r.name}`,
      ok: r.status === "applied" || r.status === "already",
      detail: r.status,
    });
  }
} else {
  results.push({ name: "补丁明细跳过", ok: true, detail: "解包后复跑即可逐条核对" });
}

// ── 输出 ─────────────────────────────────────────────────────────────────────
console.log("");
console.log("dsh-purge × DSH 0.2.1-rc.3 自检");
console.log("=".repeat(64));
console.log(`  安装: ${INSTALL}`);
console.log(`  插件: ${PURGE}`);
console.log("");

let fails = 0;
for (const r of results) {
  if (r.name.startsWith("—")) { console.log("\n" + r.name); continue; }
  const mark = r.ok ? "PASS" : "FAIL";
  if (!r.ok) fails++;
  console.log(`  ${mark}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
}

console.log("");
console.log("=".repeat(64));
console.log(`  PASS ${results.filter((r) => r.ok && !r.name.startsWith("—")).length}   FAIL ${fails}`);
console.log("");
process.exit(fails ? 1 : 0);

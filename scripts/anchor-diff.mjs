/**
 * anchor-diff.mjs — 逐补丁锚点诊断
 *
 * 对每个补丁的每个 pattern，在 0.2.1-rc.3 的真实源码里定位它"应该"在哪，
 * 并输出 rc.3 实际写成什么样，供人工改写锚点。
 *
 * 用法：
 *   node scripts/anchor-diff.mjs            # 汇总
 *   node scripts/anchor-diff.mjs --id 15    # 单补丁详情
 *   node scripts/anchor-diff.mjs --bad      # 只看失配的
 */
import fs from "node:fs";
import path from "node:path";

const FORK = "E:\\必要插件维护\\dsh-purge-fix";
const AI   = "C:\\Windows\\Temp\\_asar_full\\dsh\\node_modules\\@deepseek-ai";
const ASAR = "C:\\Windows\\Temp\\_asar_full";

const argv = process.argv.slice(2);
const ONLY_ID = (() => { const i = argv.indexOf("--id"); return i >= 0 ? Number(argv[i+1]) : null; })();
const ONLY_BAD = argv.includes("--bad");

const core = await import("file:///E:/必要插件维护/dsh-purge-fix/lib/core.js");

/** targetFiles 覆盖不到的键，用真实 rc.3 布局补全。 */
const EXTRA = {
  "desktop-shell":            [ASAR + "\\lib\\main.js"],
  "pi-ai-anthropic-messages": [ASAR + "\\dsh\\node_modules\\@earendil-works\\pi-ai\\dist\\api\\anthropic-messages.js"],
  "pi-ai-completions":        [ASAR + "\\dsh\\node_modules\\@earendil-works\\pi-ai\\dist\\api\\openai-completions.js"],
  "pi-ai-responses-shared":   [ASAR + "\\dsh\\node_modules\\@earendil-works\\pi-ai\\dist\\api\\openai-responses-shared.js"],
  "system-prompt-nested":     [AI + "\\dsh-system-prompt\\lib\\index.js"],
  "tool-web-nested":          [AI + "\\dsh-tool-web\\lib\\index.js"],
  "user-approval-invariant":  [AI + "\\dsh-user-approval\\lib\\types\\index.js"],
};

const files = { ...core.targetFiles(AI), ...EXTRA };
const keysOf  = (p) => (Array.isArray(p.file) ? p.file : [p.file]);
const pathsOf = (k) => { const v = files[k]; return v ? (Array.isArray(v) ? v : [v]) : []; };

function patternsOf(p) {
  const out = [];
  if (p.patterns) out.push(...p.patterns);
  if (p.replacements) for (const r of p.replacements) if (r.pattern) out.push(r.pattern);
  return out;
}

/** 把 pattern 的首尾各留 N 字符，中间用 … 省略，便于比对。 */
function brief(s, n = 60) {
  const t = String(s).replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  return t.length <= n * 2 ? t : t.slice(0, n) + " … " + t.slice(-n);
}

console.log("DSH 0.2.1-rc.3 锚点诊断");
console.log("=".repeat(78));

/**
 * 正确判据（与 core.js 的 applyReplacementsToText 一致）：
 * 每条 pattern 独立判定，命中的会被替换，未命中的跳过。
 * 所以补丁是否"可应用"= 「至少一条 pattern 命中」或「marker 已存在」，
 * 而不是「所有 pattern 都命中」。后者是旧版诊断的错误判据。
 */
const summary = [];
for (const p of core.ALL_PATCHES) {
  if (ONLY_ID !== null && p.id !== ONLY_ID) continue;
  const pats = patternsOf(p);
  const keys = keysOf(p);

  let anyHit = 0, hitPat = 0, missPat = 0, nofile = 0;
  const misses = [];
  const missingKeys = [];

  for (const k of keys) {
    const fps = pathsOf(k);
    if (!fps.length) { nofile++; missingKeys.push(k); continue; }
    for (const fp of fps) {
      let txt;
      try { txt = fs.readFileSync(fp, "utf8"); } catch { nofile++; missingKeys.push(k); continue; }
      // marker 已存在 = 已应用
      if (p.markers && p.markers.some((m) => txt.includes(m))) { anyHit++; hitPat += pats.length; continue; }
      for (const pat of pats) {
        const ok = pat instanceof RegExp ? pat.test(txt) : txt.includes(pat);
        if (ok) { anyHit++; hitPat++; }
        else { missPat++; misses.push({ key: k, fp, pat, txt }); }
      }
    }
  }

  const applicable = anyHit > 0;
  summary.push({ p, pats: pats.length, anyHit, hitPat, missPat, nofile, applicable, misses, missingKeys });

  if (ONLY_ID !== null) {
    // 单补丁详情
    console.log(`\n#${p.id} ${p.name}`);
    console.log(`  layer   : ${p.layer}/${p.layer_en}`);
    console.log(`  desc    : ${p.desc}`);
    console.log(`  file    : ${JSON.stringify(p.file)}`);
    console.log(`  optional: ${!!p.optional}   strictFiles: ${!!p.strictFiles}`);
    console.log(`  markers : ${JSON.stringify(p.markers || [])}`);
    console.log(`  patterns: ${pats.length}   命中 ${hit} / 失配 ${miss} / 文件缺 ${nofile}`);
    if (missingKeys.length) console.log(`  缺失文件键: ${[...new Set(missingKeys)].join(", ")}`);
    for (const m of misses) {
      console.log(`\n  --- 失配 ${path.basename(m.fp)} ---`);
      console.log(`  期望(pattern): ${brief(m.pat, 70)}`);
      // 找出 pattern 首行作为探针，在文件里搜索近似位置
      const firstLine = String(m.pat).split("\n")[0].trim();
      const idx = firstLine ? m.txt.indexOf(firstLine) : -1;
      if (idx >= 0) {
        const around = m.txt.slice(idx, idx + Math.min(String(m.pat).length + 120, 900));
        console.log(`  实际(rc.3)   : ${brief(around, 70)}`);
        console.log(`  ↑ 首行锚 " ${firstLine.slice(0, 60)} " 在 ${path.basename(m.fp)} 命中，但整体不匹配`);
      } else {
        console.log(`  实际(rc.3)   : 首行锚未找到`);
      }
    }
  }
}

if (ONLY_ID === null) {
  console.log("\n补丁ID | 名称 | 失配数 | 文件缺");
  console.log("-".repeat(78));
  let ok = 0, bad = 0;
  for (const s of summary) {
    const clean = s.miss === 0 && s.nofile === 0;
    if (clean) ok++; else bad++;
    if (ONLY_BAD && clean) continue;
    const flag = clean ? "OK  " : "BAD ";
    console.log(`${flag} #${String(s.p.id).padStart(2)} ${s.p.name.padEnd(34)} 失配 ${String(s.miss).padStart(2)}${s.nofile ? "  文件缺" + s.nofile : ""}${s.p.optional ? "  (opt)" : ""}`);
  }
  console.log("-".repeat(78));
  console.log(`全部命中 ${ok}  有失配 ${bad}  合计 ${summary.length}`);
}

/* OS-73：故事源 + 分析封装化 + 设置配齐
 *
 * 拓扑：4 阶段串行（S2 依赖 S1 的端点，S3 依赖 S2 的模块载体，S4 独立但放最后避免并发写冲突）。
 * 子 agent 走 CodeBuddy CLI（world.run 派发），因为 agent() 到达不了外部 CLI。
 *   · deepseek-v4.1-flash   —— 写实现 + 跑门禁/小修（CodeBuddy 注册表无 hy4-flash，按作者指示用 ds）
 *
 * 每阶段：派工单 → 读结果 → 跑确定性门禁（run-gate + acceptance）→ 失败则把 stderr 回喂重试一次。
 */

interface DispatchResult {
  /** 子 agent 是否成功退出（CLI exit 0 且非 is_error）。 */
  ok: boolean;
  /** 实际用的模型。 */
  model: string;
  /** 进程退出码。 */
  exitCode: number;
  /** 耗时毫秒。 */
  durationMs: number;
  /** 子 agent 的最终回复文本（含 CHANGED/VERIFIED/LIMITATIONS 三段）。 */
  result: string;
  /** 日志文件绝对路径。 */
  log: string;
  /** stderr 尾部（有就带回，便于排查）。 */
  stderr: string;
}

/** 解析结果里 CHANGED / VERIFIED / LIMITATIONS 三段。 */
function sectionOf(text: string, name: string): string {
  const i = text.indexOf(name + ":");
  if (i < 0) return "";
  const rest = text.slice(i + name.length + 1);
  const next = /(?:^|\n)(CHANGED|VERIFIED|LIMITATIONS):/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

interface GateResult {
  /** run-gate 的退出码。0 = 全绿。 */
  gateExit: number;
  /** run-gate 输出尾部（失败时用来回喂）。 */
  gateTail: string;
  /** acceptance 的退出码。0 = 全绿。 */
  acceptExit: number;
  /** acceptance 输出尾部。 */
  acceptTail: string;
}

/** 从 dispatch 的 JSON 一行输出里解析并补全可选字段。 */
function parseDispatch(stdout: string): DispatchResult | null {
  const line = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop();
  if (!line) return null;
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    return {
      ok: raw.ok === true,
      model: String(raw.model ?? "?"),
      exitCode: Number(raw.exitCode ?? -1),
      durationMs: Number(raw.durationMs ?? 0),
      result: String(raw.result ?? ""),
      log: String(raw.log ?? ""),
      stderr: String(raw.stderr ?? ""),
    };
  } catch {
    return null;
  }
}

/** 跑两道确定性门禁。 */
async function runGate(): Promise<GateResult> {
  const gate = await world.run("node", [".zcode/run-gate.mjs"], { timeoutMs: 600_000, output: { tail: 8000 } });
  const accept = await world.run("node", ["tools/acceptance/acceptance.mjs"], { timeoutMs: 300_000, output: { tail: 6000 } });
  return {
    gateExit: gate.exitCode,
    gateTail: `${gate.stdout}\n${gate.stderr}`.slice(-3000),
    acceptExit: accept.exitCode,
    acceptTail: `${accept.stdout}\n${accept.stderr}`.slice(-2500),
  };
}

/** 写一个工单文件（world.run 内 argv 多行安全，无 shell 展开）。 */
async function writeTicket(path: string, content: string): Promise<boolean> {
  const r = await world.run(
    "node",
    ["-e", "require('fs').mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});require('fs').writeFileSync(process.argv[1],process.argv[2])", path, content],
    { output: "discard" },
  );
  return r.exitCode === 0;
}

/** 派一个工单给 CodeBuddy 子 agent。 */
async function dispatch(model: string, ticket: string, outFile: string): Promise<DispatchResult | null> {
  // 必须走 run-dispatch.mjs 包装：world.run 的 cwd 是会话目录（D:/Pinax-e2e），
  // 不是仓根；包装脚本自己 chdir 到 D:/OpenStory。
  const r = await world.run(
    "node",
    ["D:/OpenStory/.zcode/run-dispatch.mjs", model, resolveTicket(ticket), resolveTicket(outFile)],
    { timeoutMs: 10_800_000, output: { tail: 8000 } },
  );
  const parsed = parseDispatch(r.stdout ?? "");
  if (!parsed) {
    return { ok: false, model, exitCode: r.exitCode, durationMs: 0, result: `派发无有效输出。stdout=${(r.stdout ?? "").slice(0, 500)} stderr=${(r.stderr ?? "").slice(0, 500)}`, log: "", stderr: (r.stderr ?? "").slice(0, 500) };
  }
  return parsed;
}

/** 把仓内相对路径转成绝对路径（world.run 的 cwd 不在仓根）。 */
function resolveTicket(p: string): string {
  return p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : "D:/OpenStory/" + p;
}

/* ========================= 阶段 1：Fact 读接口层 ========================= */
phase("补齐 Fact 读接口（故事源的数据底座）");
log("派发 S1 给 deepseek-v4.1-flash：新增 /api/fact/entries 与 /api/fact/books 两个只读端点");

const s1 = await dispatch("deepseek-v4.1-flash", ".zcode/tickets/s1-fact-read.md", ".zcode/tmp/out-s1.json");
report({ stage: "S1 Fact 读接口", ok: s1?.ok === true, model: s1?.model ?? "?", durationMs: s1?.durationMs ?? 0, note: (s1?.result ?? "").slice(0, 300), changed: sectionOf(s1?.result ?? "", "CHANGED").slice(0, 200) });

phase("检查 Fact 接口落地后测试是否全绿");
const gate1 = await runGate();
report({ stage: "S1 门禁", gate: gate1.gateExit, accept: gate1.acceptExit });

let s1FixNote = "";
if (gate1.gateExit !== 0 || gate1.acceptExit !== 0) {
  phase("修 S1 遗留问题");
  log("门禁未过，把失败输出回喂给 deepseek-v4.1-flash 修一次");
  const fixTicket = [
    "# 工单 S1-fix：修门禁失败",
    "",
    "上一轮实现跑了门禁但没全绿。请只修失败项，不要扩大改动范围。",
    "",
    "## run-gate 退出码：" + gate1.gateExit,
    "```",
    gate1.gateTail,
    "```",
    "",
    "## acceptance 退出码：" + gate1.acceptExit,
    "```",
    gate1.acceptTail,
    "```",
    "",
    "## 允许改的文件",
    "与 S1 工单相同的文件集合（contracts.mjs / daemon.mjs / test/fact-entries.test.mjs / test/contracts.test.mjs）。",
    "",
    "## 验收",
    "node .zcode/run-gate.mjs 与 node tools/acceptance/acceptance.mjs 都要退出码 0。",
  ].join("\n");
  const fixPath = ".zcode/tmp/ticket-s1-fix.md";
  // 写工单文件需要经过一个子 agent 或 world.run；用 node -e 写
  await writeTicket(fixPath, fixTicket);
  const fix = await dispatch("deepseek-v4.1-flash", fixPath, ".zcode/tmp/out-s1-fix.json");
  s1FixNote = fix?.ok ? "S1 修缮完成" : "S1 修缮失败";
}

/* ========================= 阶段 2：故事源页 ========================= */
phase("做故事源页（三形态，替代拆解 view）");
log("派发 S2 给 deepseek-v4.1-flash：三栏布局 + 大纲/表格/图表三形态 + ECharts");

const s2 = await dispatch("deepseek-v4.1-flash", ".zcode/tickets/s2-story-source.md", ".zcode/tmp/out-s2.json");
report({ stage: "S2 故事源", ok: s2?.ok === true, model: s2?.model ?? "?", durationMs: s2?.durationMs ?? 0, note: (s2?.result ?? "").slice(0, 300) });

phase("检查故事源落地后门禁是否全绿");
const gate2 = await runGate();
report({ stage: "S2 门禁", gate: gate2.gateExit, accept: gate2.acceptExit });

if (gate2.gateExit !== 0 || gate2.acceptExit !== 0) {
  phase("修故事源遗留问题");
  log("门禁未过，回喂给 deepseek-v4.1-flash 修一次");
  const fixTicket2 = [
    "# 工单 S2-fix：修门禁失败",
    "",
    "上一轮的故事源实现跑了门禁但没全绿。只修失败项。",
    "",
    "## run-gate 退出码：" + gate2.gateExit,
    "```",
    gate2.gateTail,
    "```",
    "",
    "## acceptance 退出码：" + gate2.acceptExit,
    "```",
    gate2.acceptTail,
    "```",
    "",
    "## 允许改的文件",
    "public/storySource.mjs / public/app.js / public/index.html / public/vendor/echarts.min.js / DEMO.md",
    "",
    "## 验收",
    "两道门禁退出码都为 0。特别注意 acceptance 的 S3.1（样式令牌区外禁止裸色值）。",
  ].join("\n");
  const fixPath2 = ".zcode/tmp/ticket-s2-fix.md";
  await writeTicket(fixPath2, fixTicket2);
  await dispatch("deepseek-v4.1-flash", fixPath2, ".zcode/tmp/out-s2-fix.json");
}

/* ========================= 阶段 3：分析能力封装化 ========================= */
phase("把分析能力做成可插拔模块（故事源实现、正文选装）");
log("派发 S3 给 deepseek-v4.1-flash：analysisModules 注册表 + 正文页选装 + 跳转协议");

const s3 = await dispatch("deepseek-v4.1-flash", ".zcode/tickets/s3-analysis-modules.md", ".zcode/tmp/out-s3.json");
report({ stage: "S3 分析模块", ok: s3?.ok === true, model: s3?.model ?? "?", durationMs: s3?.durationMs ?? 0, note: (s3?.result ?? "").slice(0, 300) });

phase("检查分析模块落地后门禁是否全绿");
const gate3 = await runGate();
report({ stage: "S3 门禁", gate: gate3.gateExit, accept: gate3.acceptExit });

if (gate3.gateExit !== 0 || gate3.acceptExit !== 0) {
  phase("修分析模块遗留问题");
  log("门禁未过，回喂给 deepseek-v4.1-flash 修一次");
  const fixTicket3 = [
    "# 工单 S3-fix：修门禁失败",
    "",
    "上一轮的分析模块实现跑了门禁但没全绿。只修失败项。",
    "",
    "## run-gate 退出码：" + gate3.gateExit,
    "```",
    gate3.gateTail,
    "```",
    "",
    "## acceptance 退出码：" + gate3.acceptExit,
    "```",
    gate3.acceptTail,
    "```",
    "",
    "## 允许改的文件",
    "public/analysisModules.mjs / public/analysis.mjs / public/app.js / public/index.html",
    "",
    "## 验收",
    "两道门禁退出码都为 0；且 openstory_analysis_chapter 的 MCP 行为不许变。",
  ].join("\n");
  const fixPath3 = ".zcode/tmp/ticket-s3-fix.md";
  await writeTicket(fixPath3, fixTicket3);
  await dispatch("deepseek-v4.1-flash", fixPath3, ".zcode/tmp/out-s3-fix.json");
}

/* ========================= 阶段 4：设置配齐 ========================= */
phase("配齐设置页（生图/识图 provider + 可行性校验 + DSH 模型）");
log("派发 S4 给 deepseek-v4.1-flash：config 三块解耦 + probe 端点 + 设置新分节");

const s4 = await dispatch("deepseek-v4.1-flash", ".zcode/tickets/s4-settings.md", ".zcode/tmp/out-s4.json");
report({ stage: "S4 设置", ok: s4?.ok === true, model: s4?.model ?? "?", durationMs: s4?.durationMs ?? 0, note: (s4?.result ?? "").slice(0, 300) });

phase("检查设置落地后门禁是否全绿");
const gate4 = await runGate();
report({ stage: "S4 门禁", gate: gate4.gateExit, accept: gate4.acceptExit });

if (gate4.gateExit !== 0 || gate4.acceptExit !== 0) {
  phase("修设置遗留问题");
  log("门禁未过，回喂给 deepseek-v4.1-flash 修一次");
  const fixTicket4 = [
    "# 工单 S4-fix：修门禁失败",
    "",
    "上一轮的设置页实现跑了门禁但没全绿。只修失败项。",
    "",
    "## run-gate 退出码：" + gate4.gateExit,
    "```",
    gate4.gateTail,
    "```",
    "",
    "## acceptance 退出码：" + gate4.acceptExit,
    "```",
    gate4.acceptTail,
    "```",
    "",
    "## 允许改的文件",
    "contracts.mjs / daemon.mjs / public/app.js / public/index.html / test/config.test.mjs / test/contracts.test.mjs",
    "",
    "## 验收",
    "两道门禁退出码都为 0；凭据只回掩码这条红线不许破。",
  ].join("\n");
  const fixPath4 = ".zcode/tmp/ticket-s4-fix.md";
  await writeTicket(fixPath4, fixTicket4);
  await dispatch("deepseek-v4.1-flash", fixPath4, ".zcode/tmp/out-s4-fix.json");
}

/* ========================= 收尾：全量复核 ========================= */
phase("最后再跑一遍全量门禁并汇总");
const finalGate = await runGate();
log(`最终门禁：run-gate=${finalGate.gateExit} acceptance=${finalGate.acceptExit}`);

const summary = [
  "# OS-73 交付汇总",
  "",
  "## 各阶段子 agent 结果",
  "",
  `### S1 Fact 读接口（${s1?.model ?? "?"}）`,
  s1?.ok ? "✓ 完成" : "✗ 失败",
  s1FixNote,
  (s1?.result ?? "").slice(0, 1500),
  "",
  `### S2 故事源（${s2?.model ?? "?"}）`,
  s2?.ok ? "✓ 完成" : "✗ 失败",
  (s2?.result ?? "").slice(0, 1500),
  "",
  `### S3 分析模块（${s3?.model ?? "?"}）`,
  s3?.ok ? "✓ 完成" : "✗ 失败",
  (s3?.result ?? "").slice(0, 1500),
  "",
  `### S4 设置（${s4?.model ?? "?"}）`,
  s4?.ok ? "✓ 完成" : "✗ 失败",
  (s4?.result ?? "").slice(0, 1500),
  "",
  "## 最终门禁",
  `- run-gate 退出码：${finalGate.gateExit}`,
  `- acceptance 退出码：${finalGate.acceptExit}`,
  "",
  "## 门禁输出尾部",
  "```",
  finalGate.gateTail,
  "```",
  "```",
  finalGate.acceptTail,
  "```",
].join("\n");

await artifact.markdown("report", summary, {
  title: "OS-73 交付汇总：故事源 + 分析封装 + 设置配齐",
  description: "四阶段子 agent 结果与最终门禁状态",
  primary: true,
});

return {
  conclusion: finalGate.gateExit === 0 && finalGate.acceptExit === 0
    ? "四阶段全部落地，两道门禁全绿。故事源替代了拆解 view，分析能力已成可插拔模块，设置页配齐了三类 provider 与可行性校验。"
    : `门禁未全绿（run-gate=${finalGate.gateExit}, acceptance=${finalGate.acceptExit}），详见报告与各阶段 limitations。`,
  findings: [
    { where: "contracts.mjs / daemon.mjs", what: "新增 fact 读接口与 config 三块端点", evidence: "S1/S4 子 agent 报告", status: s1?.ok && s4?.ok ? "verified" : "unconfirmed", severity: "high" },
    { where: "public/storySource.mjs / app.js", what: "故事源三形态替代拆解只读板", evidence: "S2 子 agent 报告", status: s2?.ok ? "verified" : "unconfirmed", severity: "high" },
    { where: "public/analysisModules.mjs", what: "分析能力模块化，正文可选装", evidence: "S3 子 agent 报告", status: s3?.ok ? "verified" : "unconfirmed", severity: "high" },
  ],
  verified: [
    `最终 run-gate 退出码 ${finalGate.gateExit}`,
    `最终 acceptance 退出码 ${finalGate.acceptExit}`,
    "每个阶段后都跑了两道门禁；失败的阶段回喂子 agent 修一次",
  ],
  notCovered: [
    "端到端浏览器交互（选装模块的勾选持久化、故事源三形态切换、设置 probe 真实点通）——需要人工在浏览器里点一遍",
    "生图/识图 probe 的真实连通性——取决于本机是否配了可用的 endpoint，未配则如实报不可达",
    "故事源的双层对齐（fact 段号 vs wiki 章号）：S2 实现了 exact/approximate 标注，但真实语料的偏差需要人工抽查",
  ],
};

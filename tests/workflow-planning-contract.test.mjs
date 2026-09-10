import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Agent Plugins 1.0.0：插件根是仓库根下的 plugin/，skills/ 与 commands/ 都在它下面。
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");
const planningRoot = join(pluginRoot, "skills/workflow-planning");

function read(relativePath) {
  const absolutePath = join(pluginRoot, relativePath);
  assert.ok(existsSync(absolutePath), `缺少 ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertHeadingsInOrder(content, labels) {
  const headings = content
    .split("\n")
    .filter((line) => /^## /.test(line))
    .map((line) => line.slice(3));
  let previous = -1;
  for (const label of labels) {
    const index = headings.findIndex((heading, candidate) => candidate > previous && heading.includes(label));
    assert.ok(index >= 0, `缺少或错序阶段「${label}」`);
    previous = index;
  }
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  });
}

test("正确路由规划、单次操作与独立写入授权", () => {
  const skill = read("skills/workflow-planning/SKILL.md");
  assert.match(skill, /^---\nname: workflow-planning\ndescription: [^\n]+\n---/);
  assert.match(skill, /规划、梳理或拆解/);
  assert.match(skill, /独立写入确认/);
  assert.match(skill, /不用于字段已明确的单次建单/);
  // 「内容认可 ≠ 写入授权」现由硬闸门 G2 承担，技能内联该闸门块。
  assert.match(skill, /<!-- gates:start -->[\s\S]*不是写入授权[\s\S]*<!-- gates:end -->/);
  assert.match(skill, /用户只要求方案、PRD、拆解或提示词时.*停止/);

  const command = read("commands/plan.md");
  assert.match(command, /蓝图内容确认不等于线上写入授权/);
  assert.match(command, /目标 Workflow 项目/);
  assert.match(command, /不流转需求状态/);

  const ops = read("skills/workflow-ops/SKILL.md");
  assert.match(ops, /^---\nname: workflow-ops\ndescription: [^\n]*字段与内容已经明确[^\n]*workflow-planning[^\n]*\n---/);
  assert.match(ops, /\/me.*验证身份/);
  assert.match(ops, /\/projects\/current.*项目.*角色\/权限/);
  assert.doesNotMatch(ops, /`\/me` 返回的项目/);

  const setup = read("skills/workflow-setup/SKILL.md");
  assert.match(setup, /\/me` 返回 200/);
  assert.match(setup, /\/projects\/current` 返回 200/);
  assert.match(setup, /project\.subdomainPrefix/);
  assert.doesNotMatch(setup, /`\/me` 返回的项目/);

  const connection = read("skills/workflow-ops/references/connection.md");
  assert.match(connection, /\/me` \*\*只验证用户身份\*\*/);
  assert.match(connection, /\/projects\/current/);
  assert.doesNotMatch(connection, /grep -c[^\n]+\|\| echo 0/);
  // .workflow 解析落空必须停止，不得回落全局 profile（否则数据写进错项目）
  assert.match(connection, /解析不出 profile[\s\S]{0,80}停止/);

  // 凭证解析阶梯只能有一份：重复的那几份正是漂移源头。
  const ladderOwners = listFiles(join(pluginRoot, "skills"))
    .filter((file) => extname(file) === ".md")
    .filter((file) => /export WORKFLOW_API_BASE=/.test(readFileSync(file, "utf8")))
    .map((file) => relative(pluginRoot, file));
  assert.deepEqual(ladderOwners, [
    "skills/workflow-ops/references/connection.md",
  ], `凭证解析片段应只存在于 connection.md，实际出现在：${ladderOwners.join(", ")}`);

  // 版本号的四方一致性由 agent-plugins-conformance 统一断言，这里只锁描述口径。
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.match(manifest.description, /规划需求与需求室/);

  const marketplace = JSON.parse(
    readFileSync(join(pluginRoot, "..", ".claude-plugin/marketplace.json"), "utf8"),
  );
  assert.match(marketplace.plugins[0].description, /规划需求与需求室/);

  const readme = readFileSync(join(pluginRoot, "..", "README.md"), "utf8");
  assert.match(readme, /workflow-planning/);
  assert.match(readme, /\/workflow:plan/);
  assert.match(readme, /蓝图内容确认与线上写入是两个闸门/);
});

test("按独立交付拓扑拆单，并按变更类型选择质量路径", () => {
  const skill = read("skills/workflow-planning/SKILL.md");
  assert.match(skill, /可独立交付、独立验证/);
  assert.match(skill, /客户端、服务端、工具链或构建发布/);
  assert.match(skill, /不得把超出单 Agent 上下文或验证边界的大任务压成“简单需求”/);
  assert.match(skill, /纯美术、文案或配置交付不得.*Code Review/);
  assert.match(skill, /预研.*Requirement/);
  assert.match(skill, /下游此时只生成条件化提纲.*不得落单/);
  assert.match(skill, /预研结束.*递增蓝图修订号.*重新取得写入授权/);
  assert.match(skill, /接口先行与 AI 并行审查/);
  assert.match(skill, /消费卡准备标为可执行时没有版本化、可引用的合同/);
  assert.match(skill, /接口未清只能保留条件化草稿/);
  assert.match(skill, /尚未冻结时被标为 `ready` 或列入上传清单/);
  assert.match(skill, /普通消费边（`basis=interface`）.*`basis=implementation`/);
  assert.match(skill, /不修改历史 bundle/);
  assert.match(skill, /最长依赖链.*最大可并行 wave/);

  const process = read("skills/workflow-planning/references/planning-process.md");
  assertHeadingsInOrder(process, [
    "需求定义与可选预研",
    "体验、内容与资产设计",
    "测试与验证设计",
    "共享合同与公共底座",
    "程序实现与内容生产",
    "合入与合入后审查",
    "最终 QA 与领域验收",
  ]);
  // 冻结口径是「合入后审」：本 reference 是 planning 强制读取的文件，
  // 它曾要求「最终合入前对完整 diff 做整体 Review」——比主规则更严的另一道门。
  // reference 只能展开方法，不能自立闸门。
  assert.match(process, /审查发生在合入之后，不在合入之前/);
  assert.match(process, /不挡合入/);
  assert.doesNotMatch(process, /最终合入受保护分支、发布或状态完成前/);
  assert.match(process, /场景、Prefab、关卡、二进制资产.*唯一所有者/);
  assert.match(process, /不得制造无关失败或伪造测试输出/);
  assert.match(process, /没有可自动化测试缝/);
  assert.match(process, /没有代码就不创建空的 TDD 或 Code Review 卡/);
  assert.match(process, /总需求\/Room.*公共接口\/产出.*可并行执行卡.*收尾联调\/验收卡/);
  assert.match(process, /增量 bundle.*不修改旧 bundle/);
  assert.match(process, /旧单未完成但接口已冻结时.*并行/);
  assert.match(process, /longestChainCards/);
  assert.match(process, /parallelWidth/);
});

test("执行提示词具备 Agent 权限边界、验证证据与游戏研发覆盖层", () => {
  const template = read("skills/workflow-planning/references/requirement-template.md");
  assertHeadingsInOrder(template, [
    "任务元数据",
    "你的身份",
    "指令与真值优先级",
    "来源真值",
    "产品背景与已锁决策",
    "本需求目标",
    "执行前置",
    "决策权限与升级条件",
    "范围与协作边界",
    "详细要求",
    "验证计划与证据",
    "必须交付",
    "验收标准",
    "明确不做与禁止事项",
    "阻塞与升级",
    "交回格式",
  ]);
  assert.match(template, /不得撤销其他 Agent\/成员的改动/);
  assert.match(template, /不得声称未实际执行的验证通过/);
  assert.match(template, /与 Workflow 结构化验收项一一对应/);
  assert.match(template, /前置产物\(接口\)/);
  assert.match(template, /前置产物\(必须等待实现\)/);
  assert.match(template, /conditional.*ready.*blocked/);
  assert.match(template, /无外部接口.*待冻结.*本单合同/);
  assert.match(template, /接口冻结物已存在且可引用\(单号\/版本/);
  assert.match(template, /交付给收尾联调\/验收卡/);

  // 覆盖层是「索引 + 每层一个文件」：断言结构与可达性，不断言正文措辞。
  const index = read("skills/workflow-planning/references/discipline-overlays.md");
  const indexDir = join(planningRoot, "references");
  const linked = new Map(
    [...index.matchAll(/\|\s*`(\[[^\]]+\])`\s*\|[^|]*\|\s*\[[^\]]+\]\((overlays\/[a-z-]+\.md)\)\s*\|/g)]
      .map((match) => [match[1], match[2]]),
  );

  for (const discipline of [
    "[原始需求]",
    "[预研]",
    "[策划·系统/玩法]",
    "[策划·关卡/内容]",
    "[叙事/本地化]",
    "[UX/UI]",
    "[美术]",
    "[技术美术]",
    "[动画/VFX/音频]",
    "[测试·用例]",
    "[程序·协议/公共]",
    "[程序·服务端]",
    "[程序·客户端]",
    "[程序·工具/构建]",
    "[数据/运营/发布]",
    "[集成]",
    "[Review]",
    "[测试·收尾]",
  ]) {
    const target = linked.get(discipline);
    assert.ok(target, `选择表缺少覆盖层「${discipline}」或未给出文件链接`);
    const body = readFileSync(join(indexDir, target), "utf8");
    assert.ok(body.length > 120, `${target} 内容过短，疑似拆分时丢失正文`);
  }
  assert.equal(linked.size, 18, "选择表行数与覆盖层数量不一致");

  // 索引必须保持轻量：正文留在各自文件里，否则渐进披露就白做了。
  assert.ok(index.length < 4000, `选择表膨胀到 ${index.length} 字节，正文应留在 overlays/ 下`);

  // 跨切面关注点仍需被覆盖，但允许分布在索引或任一覆盖层里。
  const allOverlayText = listFiles(join(indexDir, "overlays"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n") + index;
  for (const concern of ["目标平台", "存档", "在引擎", "性能预算", "本地化", "回滚"]) {
    assert.match(allOverlayText, new RegExp(concern), `覆盖层整体缺少「${concern}」`);
  }

  const original = readFileSync(join(indexDir, linked.get("[原始需求]")), "utf8");
  assert.match(original, /来源记录/);
  assert.match(original, /不是等待某个 Agent“实现”的任务/);
});

test("规划技能保持上下文预算：强制读取的文件不得无限膨胀", () => {
  // 每张卡实际加载 = SKILL.md + 流程 + 模板 + 覆盖层索引 + 一个覆盖层。
  const mandatory = [
    "skills/workflow-planning/SKILL.md",
    "skills/workflow-planning/references/planning-process.md",
    "skills/workflow-planning/references/requirement-template.md",
    "skills/workflow-planning/references/discipline-overlays.md",
  ].reduce((total, path) => total + Buffer.byteLength(read(path), "utf8"), 0);

  const overlayDir = join(planningRoot, "references/overlays");
  const largestOverlay = Math.max(
    ...listFiles(overlayDir).map((file) => Buffer.byteLength(readFileSync(file, "utf8"), "utf8")),
  );

  // 1.2.0 上调到 32_000：planning-process.md 是本技能**强制读取**的文件，而它原先写着
  // 「最终合入受保护分支前做整体 Review」与「对可自动化代码行为一律 Red-Green-Refactor」——
  // 两道比冻结口径更严的门。改成合入后审 + TDD 按需用，措辞要同时讲清「做什么」与「不再是门」，
  // 比原文长。加之前已按「先删冗余」压过两轮。
  //
  // **余量政策**：上调时留 5–10% 余量，不要卡着当前值 +ε。余量只剩一两百字节的预算不是
  // 早期预警，是每次改动都要跨的仪式——那会把人训练成顺手上调，而不是想一想该不该加。
  // 预算保留：它防的是无意识膨胀，不是禁止修正错误口径。
  const budget = 32_000;
  assert.ok(
    mandatory + largestOverlay < budget,
    `单次规划需加载 ${mandatory + largestOverlay} 字节，超出预算 ${budget}——新增内容应放进按需读取的 references`,
  );
});

test("API 落单复用共享安全规则并读回原生验收项", () => {
  const delivery = read("skills/workflow-planning/references/api-delivery.md");
  for (const token of [
    "../../workflow-ops/SKILL.md",
    "../../workflow-ops/references/call-templates.md",
    "/me",
    "/projects/current",
    "acceptance-items",
    "blueprintId",
    "sourceKind=ai",
    "读回",
    "幂等恢复",
    "部分成功",
  ]) {
    assert.match(delivery, new RegExp(escapeRegExp(token)));
  }
  assert.match(delivery, /用户对这份确切清单明确授权后才能 POST\/PATCH/);
  assert.match(delivery, /不得为了伪装原子性删除用户可见 PM 数据/);
  assert.match(delivery, /不创建 WorkItem/);
});

test("规划 Skill 只含公开 Markdown、相对链接有效且不泄露内部信息", () => {
  assert.ok(existsSync(planningRoot), "缺少 workflow-planning 技能目录");

  const files = listFiles(planningRoot);
  assert.ok(files.length >= 5, "需求规划技能缺少模板或参考文件");
  for (const absolutePath of files) {
    const displayPath = relative(pluginRoot, absolutePath);
    assert.equal(extname(absolutePath), ".md", `${displayPath} 不是 Markdown`);
    const content = readFileSync(absolutePath, "utf8");
    // 与 tests/workflow-qa-contract.test.mjs 的脱敏禁令同一口径：`.spec/` 已移出禁令——它是本插件
    // 公开发布的项目脚手架约定（/workflow:init 生成、/workflow:lint 校验），不再是内部私有路径。
    // 内部仓名与凭据的禁令一条不减。
    assert.doesNotMatch(content, /LumioGameWorkFlow|localhost|wfp_[0-9a-z_-]{12,}/i, `${displayPath} 含内部项目名或疑似凭据`);
    assert.doesNotMatch(content, /TBD|TODO|适当处理/, `${displayPath} 含未决占位`);

    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const linkedPath = join(dirname(absolutePath), target);
      assert.ok(existsSync(linkedPath), `${displayPath} 的相对链接不存在：${target}`);
    }
  }
});

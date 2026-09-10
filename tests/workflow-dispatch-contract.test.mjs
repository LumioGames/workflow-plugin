// workflow-dispatch 与 agents/reviewer 的提示词契约。
//
// 存在的理由：调度规程最容易漂回旧口径——按「批」串行、每卡审一次、reviewer 自己写单、
// 复跑 worker 的测试、把状态名写死。下面每条断言对应一条被明令废止的旧做法或一条新硬规矩。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");

function read(relativePath) {
  const absolute = join(pluginRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

const skill = read("skills/workflow-dispatch/SKILL.md");
const implementer = read("skills/workflow-dispatch/references/implementer-prompt.md");
const reviewerPrompt = read("skills/workflow-dispatch/references/reviewer-prompt.md");
const reviewer = read("agents/reviewer.md");

describe("workflow-dispatch 边界", () => {
  test("frontmatter 只有 name + description，description 写清何时用并与 execute / planning 分流", () => {
    const fm = /^---\nname: workflow-dispatch\ndescription: ([^\n]+)\n---/.exec(skill);
    assert.ok(fm, "frontmatter 缺失或多了键");
    for (const token of ["派活", "并行", "合入", "reviewer", "workflow-execute", "workflow-planning"]) {
      assert.ok(fm[1].includes(token), `description 缺少「${token}」`);
    }
  });

  test("七步齐全且按序：取单 → 分组 → 派遣 → 收交回物 → 合入 → 审一次 → 写回", () => {
    const headings = ["### ① 取单", "### ② 分组", "### ③ 派遣", "### ④ 收交回物", "### ⑤ 合入", "### ⑥ 审一次", "### ⑦ 写回"];
    let previous = -1;
    for (const heading of headings) {
      const index = skill.indexOf(heading);
      assert.ok(index > previous, `缺少或错序「${heading}」`);
      previous = index;
    }
  });

  test("取单只派 readiness=ready；前置按 basis 分流，接口卡实现未完成不阻塞", () => {
    assert.match(skill, /readiness=ready/);
    assert.match(skill, /`basis=interface`[\s\S]{0,120}不阻塞/);
    assert.match(skill, /`basis=implementation`[\s\S]{0,80}不派/);
    assert.match(skill, /`conditional`[\s\S]{0,40}不派/);
    assert.match(skill, /`blocked`[\s\S]{0,20}不派/);
    assert.match(skill, /parallelWidth/);
  });

  test("分组按文件集互斥；每个 worker 独立 worktree 建在仓的兄弟目录", () => {
    assert.match(skill, /互不重叠 → 并行；重叠 → 串行/);
    assert.match(skill, /共享热点[\s\S]{0,80}唯一所有者/);
    assert.match(skill, /每个 worker 一个独立 git worktree/);
    assert.match(skill, /兄弟目录/);
    assert.match(skill, /不放仓内、不放系统临时目录/);
    assert.match(skill, /git-common-dir/);
  });

  test("派遣 prompt 四要素：单正文 + 【文件集边界】+ 【环境】+ 交回物规格", () => {
    for (const text of [skill, implementer]) {
      assert.match(text, /【文件集边界】/);
      assert.match(text, /【环境】/);
    }
    assert.match(skill, /不 push、不开 PR、本地 commit/);
    assert.match(skill, /推分支前不要求跑任何命令/);
    assert.match(skill, /不贴会话历史/);
    assert.match(implementer, /BRIEF_FILE/);
    assert.match(implementer, /REPORT_FILE/);
    assert.match(implementer, /不再派生子 Agent/);
    assert.match(implementer, /不调任何 Workflow API/);
    assert.match(implementer, /没跑的写「未执行」/);
  });

  test("worker 状态四分流；成功报告不作数，以 diff 为准；不复跑其测试", () => {
    for (const status of ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"]) {
      assert.ok(skill.includes(`**${status}**`), `SKILL 缺少状态「${status}」的处置`);
      assert.ok(implementer.includes(status), `implementer 模板缺少状态「${status}」`);
    }
    assert.match(skill, /worker 的成功报告不作数，以 diff 为准/);
    assert.match(skill, /不复跑 worker 的测试/);
    assert.match(skill, /先预演冲突/);
  });

  test("合入只守能编过；带红合入不等于改假绿；不等 CI", () => {
    assert.match(skill, /合入只守一条线：能编过/);
    assert.match(skill, /测试红是待办不是门/);
    assert.match(skill, /测试结果不作为合入条件/);
    assert.match(skill, /带红合入不等于可以把红改成假绿/);
    assert.match(skill, /等 CI 转绿」= 违规/);
  });

  test("合入后审一次；reviewer 只读、不跑命令、不挡合入、不写 Workflow；不预判 findings", () => {
    assert.match(skill, /合入后审一次\*\*，不每单审/);
    assert.match(skill, /只读 diff、不跑命令、不挡合入、只出报告/);
    assert.match(skill, /不预判 findings/);
    assert.match(skill, /「我已流转 \/ 我已建单」= 越权/);
    assert.match(reviewerPrompt, /不预判 findings/);
    assert.match(reviewerPrompt, /不让它复跑测试/);
    assert.match(reviewerPrompt, /git diff -U10/);
    assert.match(reviewerPrompt, /一个 fix worker 带完整清单/);
  });

  test("主 loop 是唯一写入方：四件代写、P0/P1 起 bug 单、P2 写评论、经 workflow-ops / workflow-upload 读回", () => {
    assert.match(skill, /单一写入方/);
    assert.match(skill, /遗留补单 → 附件 → 证据评论[\s\S]{0,40}交接纪要 → 流转/);
    assert.match(skill, /`P0` \/ `P1` 各起一张 bug 单/);
    assert.match(skill, /`P2`[\s\S]{0,40}评论/);
    assert.match(skill, /workflow-upload/);
    assert.match(skill, /G3/);
  });

  test("删 worktree / 分支前列出将丢失内容并取得确认；恢复不凭记忆重派", () => {
    assert.match(skill, /删 worktree 或分支之前，列出将丢失的内容并取得用户确认/);
    assert.match(skill, /git worktree remove/);
    assert.match(skill, /不凭记忆重派/);
  });

  test("状态只写语义，不写状态名", () => {
    assert.match(skill, /取语义为「进行中 \/ 待验收」的边/);
    assert.doesNotMatch(skill, /toStateKey"?\s*:\s*"[a-z_]+"/);
  });

  test("相对链接全部可达", () => {
    for (const absolutePath of listFiles(join(pluginRoot, "skills/workflow-dispatch"))) {
      const content = readFileSync(absolutePath, "utf8");
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split("#", 1)[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        assert.ok(existsSync(join(dirname(absolutePath), target)), `${relative(pluginRoot, absolutePath)} 的相对链接不存在：${target}`);
      }
    }
  });
});

describe("agents/reviewer.md", () => {
  test("frontmatter 只含 name / description / disallowedTools，且 disallowedTools 为 Bash", () => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(reviewer);
    assert.ok(fm, "frontmatter 缺失");
    const keys = fm[1].split("\n").map((line) => line.split(":", 1)[0].trim());
    assert.deepEqual(keys, ["name", "description", "disallowedTools"]);
    assert.match(fm[1], /^name: reviewer$/m);
    assert.match(fm[1], /^disallowedTools: Bash$/m);
    const description = /^description: (.+)$/m.exec(fm[1])?.[1];
    assert.ok(description?.length > 20, "description 过短");
    assert.match(description, /合入[\s\S]*只读|只读[\s\S]*合入/);
  });

  test("合入后审、只读 diff、不跑命令、不挡合入、只出报告不写 Workflow", () => {
    assert.match(reviewer, /合入后审，不挡合入/);
    assert.match(reviewer, /只读 diff/);
    assert.match(reviewer, /不跑测试、不跑 lint、不跑构建/);
    assert.match(reviewer, /只出报告，不写 Workflow/);
    assert.match(reviewer, /不流转、不建单、不评论/);
    assert.match(reviewer, /「我已流转 \/ 我已建单」= 越权/);
    assert.match(reviewer, /不改代码/);
    assert.match(reviewer, /不派活/);
  });

  test("材料 = 单正文 + 完整 diff + 交回物；缺一报材料不齐；深审也不是重跑", () => {
    assert.match(reviewer, /材料不齐/);
    assert.match(reviewer, /单号与单正文/);
    assert.match(reviewer, /完整 diff/);
    assert.match(reviewer, /交回物/);
    assert.match(reviewer, /快审（默认）/);
    assert.match(reviewer, /深审（主 loop 显式要求才启用）/);
    assert.match(reviewer, /不是重跑/);
  });

  test("审查清单七维 + findings 准入门槛 + 报告格式", () => {
    for (const dim of ["验收项", "正确性", "安全", "红线与规范", "测试", "提交卫生", "沉淀"]) {
      assert.ok(reviewer.includes(`**${dim}**`), `审查清单缺少「${dim}」`);
    }
    assert.match(reviewer, /宁可漏报，不误报/);
    assert.match(reviewer, /置信度定级/);
    assert.match(reviewer, /误报抑制/);
    assert.match(reviewer, /按交付类型聚焦/);
    assert.match(reviewer, /把红改成假绿/);
    for (const section of ["**结论**", "**Findings**", "**证据核验结果**", "`P0`", "`P1`", "`P2`"]) {
      assert.ok(reviewer.includes(section), `报告格式缺少 ${section}`);
    }
  });
});

describe("语汇替换：调度面不出现旧口径", () => {
  const forbidden = ["契约卡", "wave", ".spec/tasks", "收口门槛", "铁律", "in_progress", "pending"];
  const files = [...listFiles(join(pluginRoot, "skills/workflow-dispatch")), ...listFiles(join(pluginRoot, "agents"))];

  test("workflow-dispatch/** 与 agents/** 不含禁用词", () => {
    for (const absolutePath of files) {
      const content = readFileSync(absolutePath, "utf8");
      for (const term of forbidden) {
        assert.ok(!content.includes(term), `${relative(pluginRoot, absolutePath)} 出现禁用词「${term}」`);
      }
    }
  });

  test("只含 Markdown 文件", () => {
    for (const absolutePath of files) {
      assert.equal(extname(absolutePath), ".md", `${relative(pluginRoot, absolutePath)} 不是 Markdown`);
    }
  });
});

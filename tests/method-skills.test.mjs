// 五个方法技能（brainstorming / test-driven-development / systematic-debugging / spec-steward /
// receiving-code-review）的结构契约，以及整个 skills/ 树上旧口径词的棘轮。
//
// 存在的理由：这五个技能是从另一套调度体系吸收来的，最容易把那边的语汇（按批扇出、本地任务卡、
// 交付前必过的门、状态枚举）一起带进来。结构测试锁 frontmatter 与附件，棘轮测试保证旧口径词
// 只减不增——既有命中处逐条登记在案，新出现一处就红。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  const absolute = join(repoRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

const METHOD_SKILLS = {
  brainstorming: [],
  "test-driven-development": ["testing-anti-patterns.md"],
  "systematic-debugging": ["root-cause-tracing.md", "defense-in-depth.md", "condition-based-waiting.md"],
  "spec-steward": [],
  "receiving-code-review": [],
};

const FORBIDDEN = ["契约卡", "wave", ".spec/tasks", "收口门槛", "铁律", "in_progress", "pending"];

describe("方法技能结构", () => {
  for (const [name, attachments] of Object.entries(METHOD_SKILLS)) {
    test(`${name}：frontmatter 只有 name + description，description 写清何时用`, () => {
      const skill = read(`skills/${name}/SKILL.md`);
      const fm = /^---\n([\s\S]*?)\n---/.exec(skill);
      assert.ok(fm, "frontmatter 缺失");
      const keys = fm[1].split("\n").map((line) => line.split(":", 1)[0].trim());
      assert.deepEqual(keys, ["name", "description"], "frontmatter 只允许 name + description");
      assert.match(fm[1], new RegExp(`^name: ${name}$`, "m"));
      const description = /^description: (.+)$/m.exec(fm[1])?.[1];
      assert.ok(description?.length > 20, "description 过短");
      assert.match(description, /使用|时用/, "description 要写清何时用");
    });

    test(`${name}：附件齐全且被 SKILL.md 引用；目录里只有 Markdown`, () => {
      const skill = read(`skills/${name}/SKILL.md`);
      for (const attachment of attachments) {
        assert.ok(existsSync(join(repoRoot, "skills", name, attachment)), `缺少附件 ${attachment}`);
        assert.ok(skill.includes(`](${attachment})`), `SKILL.md 未链接附件 ${attachment}`);
      }
      for (const absolutePath of listFiles(join(repoRoot, "skills", name))) {
        assert.equal(extname(absolutePath), ".md", `${relative(repoRoot, absolutePath)} 不是 Markdown——技能包只允许 .md`);
      }
    });

    test(`${name}：不含旧口径禁用词`, () => {
      for (const absolutePath of listFiles(join(repoRoot, "skills", name))) {
        const content = readFileSync(absolutePath, "utf8");
        for (const term of FORBIDDEN) {
          assert.ok(!content.includes(term), `${relative(repoRoot, absolutePath)} 出现禁用词「${term}」`);
        }
      }
    });
  }
});

describe("方法技能口径", () => {
  test("brainstorming：设计门 + 落点为项目活文档与 ADR + 任务真值是 Workflow 单 + 交棒 workflow-planning", () => {
    const skill = read("skills/brainstorming/SKILL.md");
    assert.match(skill, /<HARD-GATE>/);
    // 落点写全路径：`.spec/` 是本插件公开发布的脚手架约定，不再避讳着写半截路径。
    assert.match(skill, /`\.spec\/knowledge\/features\/<topic>\.md`/);
    assert.match(skill, /`\.spec\/decisions\/`/);
    assert.match(skill, /任务真值只有 Workflow 单/);
    assert.match(skill, /交棒给 `workflow-planning`/);
  });

  test("test-driven-development：先失败测试是用它时的规矩，不是推分支前的门", () => {
    const skill = read("skills/test-driven-development/SKILL.md");
    assert.match(skill, /先有失败的测试，再有生产代码/);
    assert.match(skill, /不是推分支前的门/);
    assert.match(skill, /推分支前不要求跑任何命令/);
    assert.match(skill, /红是待办，不是门/);
    for (const step of ["### 红：", "### 验证红：", "### 绿：", "### 验证绿：", "### 重构："]) {
      assert.ok(skill.includes(step), `缺少 ${step}`);
    }
  });

  test("systematic-debugging：四阶段齐全，修 3 次不成质疑架构，修完如实写跑了什么", () => {
    const skill = read("skills/systematic-debugging/SKILL.md");
    for (const phase of ["### 第一阶段：根因调查", "### 第二阶段：模式分析", "### 第三阶段：假设与验证", "### 第四阶段：实施"]) {
      assert.ok(skill.includes(phase), `缺少 ${phase}`);
    }
    assert.match(skill, /3 次及以上 → 质疑架构/);
    assert.match(skill, /没跑的写「未执行」/);
  });

  test("spec-steward：删掉任务卡清理，新增落了单的地方写单号；lint 只报告不阻断", () => {
    const skill = read("skills/spec-steward/SKILL.md");
    assert.doesNotMatch(skill, /任务卡/);
    assert.match(skill, /### 流程 C · 落了单的地方写单号/);
    assert.match(skill, /索引只用来找单号和 Room，状态以线上为准/);
    assert.match(skill, /项目不抄插件任何一段/);
    assert.match(skill, /只报告不阻断/);
    assert.match(skill, /不能把红改成假绿/);
  });

  test("receiving-code-review：先核实再改、不表演性认同、退回项以 bug 单 / 评论为载体", () => {
    const skill = read("skills/receiving-code-review/SKILL.md");
    assert.match(skill, /先核实再实现/);
    assert.match(skill, /## 不表演性认同/);
    assert.match(skill, /bug 单 \/ 评论/);
    assert.match(skill, /一次一项，各自验证/);
  });
});

describe("旧口径词棘轮（整个 skills/ 树）", () => {
  // 既有命中处：都在本次吸收之前就存在，且要么被合同测试锁死（如 planning 的
  // 「最大可并行 wave」），要么是插件自己的上传状态词（bundle checkpoint 的 `pending`），
  // 要么是 workflow-docs 的标题。它们的去留由各自文件的 owner 决定；这里只保证不再新增。
  const baseline = {
    "skills/workflow-dependencies/SKILL.md": ["wave"],
    "skills/workflow-dependencies/references/dependency-model.md": ["wave"],
    "skills/workflow-docs/SKILL.md": ["铁律"],
    "skills/workflow-execute/references/execute-flow.md": ["pending"],
    "skills/workflow-execute/references/handoff.md": ["pending"],
    "skills/workflow-ops/SKILL.md": ["wave"],
    "skills/workflow-ops/references/call-templates.md": ["wave"],
    "skills/workflow-ops/references/delivery.md": ["pending"],
    "skills/workflow-ops/references/draft-format.md": ["pending"],
    "skills/workflow-planning/SKILL.md": ["wave"],
    "skills/workflow-planning/references/api-delivery.md": ["wave"],
    "skills/workflow-planning/references/planning-process.md": ["wave"],
    "skills/workflow-planning/references/requirement-template.md": ["wave"],
    "skills/workflow-upload/SKILL.md": ["wave", "pending"],
  };

  test("禁用词命中只能是登记在案的那些文件与词，不得新增", () => {
    const unexpected = [];
    for (const absolutePath of listFiles(join(repoRoot, "skills"))) {
      const rel = relative(repoRoot, absolutePath);
      const content = readFileSync(absolutePath, "utf8");
      const allowed = new Set(baseline[rel] ?? []);
      for (const term of FORBIDDEN) {
        if (content.includes(term) && !allowed.has(term)) unexpected.push(`${rel}：「${term}」`);
      }
    }
    assert.deepEqual(unexpected, [], `新增了旧口径词：\n${unexpected.join("\n")}`);
  });

  test("登记在案的命中若已被清掉，就从 baseline 里删掉（棘轮只能收紧）", () => {
    const stale = [];
    for (const [rel, terms] of Object.entries(baseline)) {
      const content = existsSync(join(repoRoot, rel)) ? readFileSync(join(repoRoot, rel), "utf8") : "";
      for (const term of terms) {
        if (!content.includes(term)) stale.push(`${rel}：「${term}」`);
      }
    }
    assert.deepEqual(stale, [], `baseline 里这些条目已不再命中，请删除：\n${stale.join("\n")}`);
  });
});

// workflow-qa 的提示词契约。
//
// 存在的理由：这个技能被授权在**真实生产环境**操作并回写线上单据，它的失败模式不是
// 「答得不好」，而是「把一个真 bug 关掉」或「拿本地表现冒充线上结论」。下面每条断言
// 都对应一个已经在真实项目里踩过的坑，不是风格检查。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const qaRoot = join(repoRoot, "skills/workflow-qa");

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

function read(relativePath) {
  const absolute = join(repoRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

const skill = read("skills/workflow-qa/SKILL.md");
const gates = read("skills/workflow-qa/references/qa-gates.md");
const environment = read("skills/workflow-qa/references/qa-environment.md");
const writeback = read("skills/workflow-qa/references/qa-writeback.md");

describe("workflow-qa 硬闸门", () => {
  test("Q1–Q7 闸门块与 qa-gates.md 逐字一致", () => {
    const extract = (text) => {
      const match = /<!-- qa-gates:start -->\n([\s\S]*?)\n<!-- qa-gates:end -->/.exec(text);
      return match?.[1].trim() ?? null;
    };
    const canonical = extract(gates);
    assert.ok(canonical, "qa-gates.md 里找不到闸门块");
    assert.equal(extract(skill), canonical, "SKILL.md 的闸门块与 qa-gates.md 不一致——闸门只能有一个版本");

    for (const id of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]) {
      assert.match(canonical, new RegExp(`\\*\\*${id}\\*\\*`), `闸门表缺少 ${id}`);
    }
  });

  test("显式声明 G5 例外的边界：可以跑测流转，仍不许改代码改资产", () => {
    // 落单闸门 G5 写的是「跑目标仓库测试的冲动 → 停止」，与 QA 的职责直接冲突。
    // 不把例外范围写死，这个技能就会被当成「可以顺手把 bug 修了」。
    assert.match(gates, /G5/);
    assert.match(skill, /G5/);
    assert.match(skill, /改代码/);
    assert.match(skill, /QA 不下场修/);
  });
});

describe("判定口径", () => {
  const verdicts = ["属实", "部分属实", "已修复", "未复现", "重复", "阻塞"];

  test("六个判定齐全，且各自写明状态处理", () => {
    for (const verdict of verdicts) {
      assert.match(skill, new RegExp(`\\*\\*${verdict}\\*\\*`), `判定表缺少「${verdict}」`);
    }
  });

  test("resolution 只用合同里的三个值，wontfix 明确排除", () => {
    for (const value of ["fixed", "duplicate", "cannot_reproduce"]) {
      assert.match(writeback, new RegExp(`\`${value}\``), `回写文档没写 ${value} 的用法`);
    }
    // wontfix 是产品决策：QA 判它等于替产品经理拍板要不要修。
    assert.match(writeback, /wontfix[\s\S]{0,120}QA 不用/);
    assert.match(skill, /wontfix[\s\S]{0,40}不由 QA 判定/);
  });

  test("「未复现」不得被当成「不存在」，且不流转", () => {
    assert.match(skill, /不把「没看到」写成「不存在」/);
    assert.match(skill, /未复现[\s\S]{0,200}保持当前状态/);
    // 关单要另取授权——这是把真 bug 关掉的唯一入口，必须有闸门守着。
    assert.match(skill, /cannot_reproduce[\s\S]{0,40}必须另取用户授权/);
  });

  test("已修复走终态 + fixed，且声明需要 run_acceptance 权限", () => {
    assert.match(skill, /run_acceptance/);
    assert.match(writeback, /run_acceptance/);
  });
});

describe("回写纪律", () => {
  test("description 的 QA 块有成对标记，且强调整块替换而非堆叠", () => {
    assert.match(writeback, /<!-- workflow-qa:start -->/);
    assert.match(writeback, /<!-- workflow-qa:end -->/);
    assert.match(writeback, /整块替换/);
    assert.match(writeback, /原文其余部分逐字保留/);
  });

  test("写 description 必须带乐观并发校验，409 不得硬覆盖", () => {
    // description 是读-改-写：不带 expectedUpdatedAt 就会静默抹掉别人的编辑。
    assert.match(writeback, /expectedUpdatedAt/);
    assert.match(writeback, /409[\s\S]{0,200}不硬覆盖/);
  });

  test("resolution 的时序约束写明：先流转终态再写结论", () => {
    // 合同 B-00221：非终态设 resolution 必 422。
    assert.match(writeback, /只能在条目已处于终态时写/);
    assert.match(writeback, /先流转到终态/);
    assert.match(skill, /先流转到终态，再写结论/);
  });

  test("状态一律现查 transitions 后 POST，不硬 PATCH", () => {
    assert.match(writeback, /永远不硬 `PATCH` 状态/);
    assert.match(writeback, /blockedReason/);
  });

  test("网络错误 / 5xx 后先读回确认再重发", () => {
    assert.match(writeback, /先读回确认是否已落库，确认没有才重发/);
  });
});

describe("线上实测的底线", () => {
  test("禁止用读代码、接口响应或本地环境代替线上结论", () => {
    assert.match(skill, /结论只来自线上实测/);
    assert.match(skill, /不得代替实测下结论/);
    assert.match(environment, /只能补强解释，不能替代/);
  });

  test("要求原路径至少两遍并记录复现率，首次未复现必做变体重试", () => {
    assert.match(skill, /至少跑两遍/);
    assert.match(skill, /复现率/);
    assert.match(skill, /变体重试（首次未复现时必做）/);
  });

  test("凭据只走环境变量，且不得让用户把密码贴进对话", () => {
    assert.match(environment, /只.*从 `username_env` \/ `password_env` 指名的环境变量读取/);
    assert.match(environment, /不要让用户把密码贴进对话/);
  });

  test("受测地址解析不出时停下问用户，不回落默认值", () => {
    assert.match(environment, /停下问用户/);
    assert.match(environment, /\*\*不回落\*\*/);
  });
});

describe("公开插件的脱敏与体量", () => {
  const publicFiles = [...listFiles(join(repoRoot, "skills")), ...listFiles(join(repoRoot, "commands"))]
    .filter((file) => extname(file) === ".md")
    .map((file) => ({ path: relative(repoRoot, file), text: readFileSync(file, "utf8") }));

  test("技能与命令里不得出现内部项目名、内部路径或疑似凭据", () => {
    // 两个原型技能来自内部仓库，直接抄会把内部线上地址带进公开插件。
    //
    // `.spec/` 曾经也在这张表里，现已移出：它是本插件公开发布的项目脚手架约定
    // （/workflow:init 生成、/workflow:lint 校验、技能要指向项目 .spec/knowledge 与
    // .spec/decisions），不再是某个内部仓的私有路径。内部仓名与凭据的禁令一条不减——
    // 带仓名的安装命令只写在 README（不在本扫描范围），技能与命令里一律用 /workflow:lint。
    const forbidden = [
      /LumioGameWorkFlow/i,
      /lumio/i,
      /danaoshao/i,
      /bestcodex/i,
      /cchaven/i,
      /localhost/i,
      /wfp_[0-9a-zA-Z]{12,}/,
    ];
    for (const file of publicFiles) {
      for (const pattern of forbidden) {
        assert.doesNotMatch(file.text, pattern, `${file.path} 命中内部信息模式 ${pattern}`);
      }
    }
  });

  test("技能与命令里出现的主机名只能是 workflow.games", () => {
    // 白名单比黑名单可靠：任何没想到的内部域名也会被挡下。
    for (const file of publicFiles) {
      for (const match of file.text.matchAll(/https?:\/\/([^/\s)"'`]+)/g)) {
        const host = match[1];
        if (host.includes("<")) continue; // 占位符如 https://<子域>.workflow.games
        assert.ok(
          host === "workflow.games" || host.endsWith(".workflow.games"),
          `${file.path} 出现非 workflow.games 主机：${host}`,
        );
      }
    }
  });

  test("QA 技能只含 Markdown，相对链接全部有效", () => {
    for (const absolute of listFiles(qaRoot)) {
      const display = relative(repoRoot, absolute);
      assert.equal(extname(absolute), ".md", `${display} 不是 Markdown`);
      const content = readFileSync(absolute, "utf8");
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split("#", 1)[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        assert.ok(existsSync(join(dirname(absolute), target)), `${display} 的相对链接不存在：${target}`);
      }
    }
  });

  test("保持上下文预算：一次验收强制加载的文件不得无限膨胀", () => {
    // 实际加载 = SKILL.md + 环境 + 回写（闸门已内联在 SKILL.md 里）。
    const mandatory = [skill, environment, writeback].reduce(
      (total, text) => total + Buffer.byteLength(text, "utf8"),
      0,
    );
    const budget = 24_000;
    assert.ok(mandatory < budget, `单次验收需加载 ${mandatory} 字节，超出预算 ${budget}——新增内容应放进按需读取的 references`);
  });
});

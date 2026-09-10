// workflow-feedback 的提示词契约。
//
// 存在的理由：这个技能把内容发进平台方的公开收件箱，它的失败模式不是「答得不好」，
// 而是「把凭证或项目正文发进收件箱」「未经用户确认替用户发声」「把收件回执说成已建单」。
// 下面每条断言都对应线上合同（createSupportTicket）与官方指南锁定的一条纪律，不是风格检查。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");
const feedbackRoot = join(pluginRoot, "skills/workflow-feedback");

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

function read(relativePath) {
  const absolute = join(pluginRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

const skill = read("skills/workflow-feedback/SKILL.md");
const gates = read("skills/workflow-feedback/references/feedback-gates.md");
const fields = read("skills/workflow-feedback/references/ticket-fields.md");
const flow = read("skills/workflow-feedback/references/submit-flow.md");
const command = read("commands/feedback.md");

const skillTexts = {
  "SKILL.md": skill,
  "references/feedback-gates.md": gates,
  "references/ticket-fields.md": fields,
  "references/submit-flow.md": flow,
};

describe("workflow-feedback 硬闸门", () => {
  test("F1–F7 闸门块与 feedback-gates.md 逐字一致", () => {
    const extract = (text) => {
      const match = /<!-- feedback-gates:start -->\n([\s\S]*?)\n<!-- feedback-gates:end -->/.exec(text);
      return match?.[1].trim() ?? null;
    };
    const canonical = extract(gates);
    assert.ok(canonical, "feedback-gates.md 里找不到闸门块");
    assert.equal(extract(skill), canonical, "SKILL.md 的闸门块与 feedback-gates.md 不一致——闸门只能有一个版本");

    for (const id of ["F1", "F2", "F3", "F4", "F5", "F6", "F7"]) {
      assert.match(canonical, new RegExp(`\\*\\*${id}\\*\\*`), `闸门表缺少 ${id}`);
    }
  });

  test("G 表不适用也不内联——不得撑起「本技能持有凭证」的假象", () => {
    assert.match(skill, /G1–G7[\s\S]{0,60}不适用/);
    for (const [name, text] of Object.entries(skillTexts)) {
      assert.ok(
        !text.includes("<!-- gates:start -->"),
        `${name} 内联了 G 表——G 的前提（持凭证写项目对象）在本技能不成立`,
      );
    }
  });
});

describe("凭证隔离", () => {
  test("明说不读 WORKFLOW_TOKEN、不带 Authorization 头与 Cookie", () => {
    assert.match(flow, /不读取 WORKFLOW_TOKEN/);
    assert.match(skill, /WORKFLOW_TOKEN/);
    assert.match(skill, /`Authorization` 头/);
    assert.match(skill, /Cookie/);
  });

  test("全部文件无凭证调用痕迹——复用 ops 调用模板是头号走样", () => {
    for (const [name, text] of Object.entries({ ...skillTexts, "commands/feedback.md": command })) {
      assert.doesNotMatch(
        text,
        /\$WORKFLOW_TOKEN|\$WORKFLOW_API_BASE|Authorization: Bearer/,
        `${name} 出现凭证调用痕迹`,
      );
    }
  });

  test("不指向持凭证技能的连接前置", () => {
    for (const [name, text] of Object.entries(skillTexts)) {
      assert.doesNotMatch(text, /connection\.md/, `${name} 指向了凭证前置——反馈技能不得引导读取凭证解析`);
    }
    assert.match(skill, /不走凭证三级解析/);
  });
});

describe("只收集不扫描", () => {
  test("素材只来自用户主动提供，不扫仓库", () => {
    assert.match(skill, /只收用户主动提供的/);
    assert.match(skill, /不去仓库里找/);
    assert.match(gates, /扫仓库/);
  });

  test("协议字段的唯二例外写明来源", () => {
    assert.match(skill, /workflow-update\/VERSION/);
    assert.match(gates, /workflow-update\/VERSION/);
  });

  test("复现素材必须已脱敏的最小复现，禁止完整请求体", () => {
    assert.match(fields, /已脱敏/);
    assert.match(fields, /最小复现/);
    assert.match(fields, /禁止完整 HTTP 请求体/);
    const operationIdRow = fields.split("\n").find((line) => line.startsWith("| `operationId`"));
    assert.ok(operationIdRow?.includes("公开 OpenAPI"), "operationId 行必须写明「仅允许公开 OpenAPI」");
    const traceIdRow = fields.split("\n").find((line) => line.startsWith("| `traceId`"));
    assert.ok(traceIdRow?.includes("ProblemDetails"), "traceId 行必须写明来源是 ProblemDetails");
  });
});

describe("反馈范围不限于报错", () => {
  test("description 分流与范围触发词齐全", () => {
    const fm = /^---\nname: workflow-feedback\ndescription: ([^\n]+)\n---/.exec(skill);
    assert.ok(fm, "frontmatter 结构不对（name/description 必须各占一行）");
    for (const token of ["体验", "卡", "慢", "缺失功能", "建议", "workflow-ops", "workflow-docs", "凭证"]) {
      assert.ok(fm[1].includes(token), `description 缺少「${token}」——范围与分流靠它触发`);
    }
  });

  test("体验与卡慢归 bug，缺失功能归 feature", () => {
    assert.match(fields, /卡顿慢 → `bug`/);
    assert.match(fields, /产品建议 → `feature`/);
    assert.match(skill, /体验不好、卡顿慢/);
    assert.match(skill, /缺失功能、产品建议/);
  });
});

describe("确认闸", () => {
  test("发送前四件套逐字展示", () => {
    for (const token of ["完整报告", "目标 Host", "文件名与大小", "不发送清单"]) {
      assert.match(skill, new RegExp(token), `SKILL.md 缺少确认四件套的「${token}」`);
    }
  });

  test("确认针对这一版；内容一改重新确认并换新 key", () => {
    assert.match(skill, /这一版是否发送/);
    assert.match(skill, /重新展示、重新确认、重新生成/);
    assert.match(gates, /不构成任何授权/);
  });

  test("流程次序：确认先于发送", () => {
    // 发送先于确认是本技能要消灭的头号走样——用户抱怨一句就替他发声。
    const order = ["### 1. 收集", "### 2. 组装", "### 3. 展示与确认", "### 4. 发送", "### 5. 回执"];
    const positions = order.map((title) => skill.indexOf(title));
    for (const [index, position] of positions.entries()) {
      assert.ok(position >= 0, `SKILL.md 缺少「${order[index]}」`);
      if (index > 0) {
        assert.ok(position > positions[index - 1], `「${order[index]}」必须排在「${order[index - 1]}」之后`);
      }
    }
  });
});

describe("不发送清单", () => {
  test("清单逐项在场，服务端复扫不回显秘密", () => {
    const items = [
      "token",
      "`Authorization` 头",
      "Cookie",
      "`.workflow`",
      "`config.toml`",
      "环境变量",
      "邮箱",
      "项目文件",
      "跨租户",
      "账户与会话",
      "完整 HTTP 请求体",
      "未明确点名",
    ];
    for (const item of items) {
      assert.ok(fields.includes(item), `不发送清单缺少「${item}」`);
    }
    assert.match(fields, /只指出字段、不回显秘密/);
  });

  test("邮箱只进 contact 字段——写进正文会撞服务端敏感扫描", () => {
    assert.match(fields, /邮箱只允许进这个字段/);
  });
});

describe("agent 渠道协议", () => {
  test("五件套在字段表与提交模板双双在场", () => {
    for (const field of ["idempotencyKey", "userConfirmed", "pluginVersion", "hostType", "hostVersion"]) {
      assert.ok(fields.includes(`\`${field}\``), `ticket-fields.md 缺少 ${field}`);
      assert.ok(flow.includes(`-F "${field}=`), `submit-flow.md 提交模板缺少 ${field}`);
    }
  });

  test("hostType 只用合同枚举，不硬造", () => {
    assert.match(fields, /`codex` \/ `claude_code`/);
    assert.match(fields, /不硬造/);
  });

  test("severity 用户说了才填，不替用户默认", () => {
    assert.match(fields, /用户说了才填、不替用户默认/);
  });

  test("提交是 multipart，且命令行保持干净会话", () => {
    assert.match(fields, /multipart\/form-data/);
    assert.match(flow, /不出现任何 `Authorization` 头/);
    assert.match(flow, /`-b` \/ `--cookie`/);
  });
});

describe("幂等键与失败处置", () => {
  test("同版复用同一 key，绝不换 key 盲重发", () => {
    assert.match(flow, /复用同一 key/);
    assert.match(flow, /绝不换 key 盲重发/);
    assert.match(flow, /idempotentReplay/);
    assert.match(skill, /复用同一 key/);
  });

  test("失败处置表覆盖 409 / 422 / 429 / 413 / 415 / 503 且不伪装成功", () => {
    assert.match(skill, /idempotency_conflict/);
    assert.match(skill, /Retry-After/);
    assert.match(skill, /不回显秘密/);
    assert.match(skill, /413/);
    assert.match(skill, /415/);
    assert.match(skill, /未开通收件/);
    assert.match(skill, /对象存储未配置/);
    assert.match(skill, /绝不伪装成功/);
  });
});

describe("回执语义", () => {
  test("sup_ 是待审核收件不是正式单，不替用户查进度", () => {
    assert.match(skill, /待人工审核的收件，不是正式单/);
    assert.match(skill, /没有公开的收件进度查询端点/);
    assert.match(skill, /attachmentsStored/);
    assert.match(gates, /收件编号不是单号/);
  });

  test("技能与命令不得出现 JSON 形式的 status 字面量", () => {
    // 全仓的 status 禁令只扫 skills/；这里把 commands/feedback.md 一并兜住，
    // 防止「回执示例写成 JSON」的回归——那会撞全仓离线不变量。
    for (const [name, text] of Object.entries({ ...skillTexts, "commands/feedback.md": command })) {
      for (const [index, line] of text.split("\n").entries()) {
        assert.ok(
          !/["']status["']\s*:\s*["'][a-z_]+["']/.test(line) && !/\bstatus\s*=\s*["'][a-z_]+["']/.test(line),
          `${name}:${index + 1} 出现写死的 status 字面量：${line.trim()}`,
        );
      }
    }
  });
});

describe("入口、卫生与预算", () => {
  test("命令薄入口指向技能并保留确认边界", () => {
    assert.match(command, /workflow-feedback/);
    assert.match(command, /\$ARGUMENTS/);
    assert.match(command, /确认/);
    assert.match(command, /sup_/);
    assert.match(command, /不是正式单/);
  });

  test("技能只含 Markdown，相对链接全部有效", () => {
    for (const absolute of listFiles(feedbackRoot)) {
      const display = relative(pluginRoot, absolute);
      assert.equal(extname(absolute), ".md", `${display} 不是 Markdown`);
      const content = readFileSync(absolute, "utf8");
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split("#", 1)[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        assert.ok(existsSync(join(dirname(absolute), target)), `${display} 的相对链接不存在：${target}`);
      }
    }
  });

  test("保持上下文预算：一次反馈强制加载的文件不得无限膨胀", () => {
    // 实际加载 = SKILL.md + 字段口径 + 提交流程（闸门已内联在 SKILL.md 里）。
    const mandatory = [skill, fields, flow].reduce(
      (total, text) => total + Buffer.byteLength(text, "utf8"),
      0,
    );
    const budget = 20_000;
    assert.ok(mandatory < budget, `单次反馈需加载 ${mandatory} 字节，超出预算 ${budget}——新增内容应放进按需读取的 references`);
  });
});

// L2 合同一致性测试：拿线上 OpenAPI 当真值，检查技能里写死的东西有没有漂移。
//
// 存在的理由：这个插件的核心假设是「平台迭代快」，但仓库此前没有任何机制能在
// 平台改了合同时发现——全靠用户撞 422 才知道。本轮修的 3 个问题
// （硬编码 status、severity 默认注入、缺 maxLength 约束）都是这层能自动抓到的。
//
// 网络不可达时整体 skip 而不是 fail：CI 里它是护栏，不该变成噪音来源。

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "../..", "plugin");
const skillsRoot = join(pluginRoot, "skills");

const OPENAPI_URL = "https://workflow.games/openapi/gameflow.v1.yaml";
const VERSION_URL = "https://workflow.games/plugin/version.json";
const TIMEOUT_MS = 20_000;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

const skillFiles = listFiles(skillsRoot)
  .filter((file) => extname(file) === ".md")
  .map((file) => ({ path: relative(pluginRoot, file), text: readFileSync(file, "utf8") }));

const allSkillText = skillFiles.map((file) => file.text).join("\n");

// Requirement 引用 API 已由平台方正式提示词确认，但当前公开 OpenAPI 可能尚未同步。
// 这些路径只允许以 relation-provider.md 中的 operationId/字段契约为补充真值；
// 一旦线上合同发布，下面的诊断会自动消失，未知路径仍然照常失败。
const formalRequirementReferencePaths = new Set([
  "/api/v1/requirements/{}/references/{}",
  "/api/v1/requirement-graph",
  // $WORKFLOW_API_BASE 已经包含 /api/v1，模板中的运行时路径不重复该前缀。
  "/requirements/{}/references/{}",
  "/requirement-graph",
]);

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}

// ---- 极简 YAML 取值：合同格式很规整，为一个护栏测试引依赖不值当 ----

function contractPaths(yaml) {
  return new Set(
    yaml
      .split("\n")
      .map((line) => /^ {2}(\/\S*):\s*$/.exec(line))
      .filter(Boolean)
      .map((match) => normalizePath(match[1])),
  );
}

/** `/work-items/{workItemId}/transitions` 与 `/work-items/<uuid>/transitions` 归一成同一形状。 */
function normalizePath(path) {
  return path
    .replace(/\{[^}]*\}/g, "{}")
    .replace(/<[^>]*>/g, "{}")
    .replace(/\/$/, "");
}

function schemaEnum(yaml, schemaName, fieldName) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^ {4}${schemaName}:\\s*$`).test(line));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {4}\S/.test(lines[i])) break; // 到下一个同级 schema
    const match = new RegExp(`^\\s+${fieldName}:\\s*\\{.*enum:\\s*\\[([^\\]]+)\\]`).exec(lines[i]);
    if (match) return match[1].split(",").map((value) => value.trim());
  }
  return null;
}

function schemaMaxLengths(yaml, schemaName) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^ {4}${schemaName}:\\s*$`).test(line));
  if (start < 0) return {};
  const found = {};
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {4}\S/.test(lines[i])) break;
    const match = /^\s+(\w+):\s*\{.*maxLength:\s*(\d+)/.exec(lines[i]);
    if (match) found[match[1]] = Number(match[2]);
  }
  return found;
}

/**
 * 技能正文里当作 API 调用出现的路径。
 *
 * 按「出现的语境」抓而不是按资源名白名单抓——白名单会漏掉技能里凭空发明的新端点
 * （正是最该被抓住的那种错），而语境限定同时挡掉了站点 URL 和 Markdown 相对链接。
 */
function mentionedPaths(text) {
  const contexts = [
    /\$WORKFLOW_API_BASE(\/[A-Za-z0-9_./{}<>-]*)/g, // curl "$WORKFLOW_API_BASE/work-items"
    /\b(?:GET|POST|PATCH|PUT|DELETE)\s+`?(\/[A-Za-z0-9_./{}<>-]+)/g, // 「POST /requirements」
  ];
  const found = new Set();
  for (const pattern of contexts) {
    for (const match of text.matchAll(pattern)) {
      const path = normalizePath(match[1]).replace(/[.,;:)）】」`]+$/, "");
      if (path && path !== "/") found.add(path);
    }
  }
  return found;
}

let yaml = null;
let onlineVersion = null;
let offlineReason = null;

before(async () => {
  try {
    yaml = await fetchText(OPENAPI_URL);
    onlineVersion = JSON.parse(await fetchText(`${VERSION_URL}?cb=${process.env.CB ?? "ci"}`)).version;
  } catch (error) {
    offlineReason = `抓不到线上合同（${error.message}）——跳过，不作为失败`;
  }
});

describe("L2 合同一致性", () => {
  test("技能里出现的每个 API 路径都存在于线上合同", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    const known = contractPaths(yaml);
    const missing = [];
    const supplementalDiagnostics = new Set();
    for (const file of skillFiles) {
      for (const path of mentionedPaths(file.text)) {
        if (!known.has(path) && !formalRequirementReferencePaths.has(path)) {
          missing.push(`${file.path} → ${path}`);
        }
        if (!known.has(path) && formalRequirementReferencePaths.has(path) && !supplementalDiagnostics.has(path)) {
          t.diagnostic(`${path} 已由平台侧正式合同确认，但线上 OpenAPI 尚未同步`);
          supplementalDiagnostics.add(path);
        }
      }
    }
    assert.deepEqual(missing, [], `以下路径在合同里找不到（平台改了，或技能写错了）：\n${missing.join("\n")}`);
  });

  test("bug-fields 表里写的枚举值都在合同 enum 内", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    // 值从技能正文里现读，不写死在测试里——否则改坏了技能，测试照样绿。
    const bugFields = readFileSync(join(skillsRoot, "workflow-ops/references/bug-fields.md"), "utf8");
    const rows = [
      { field: "severity", schema: "CreateWorkItemRequest" },
      { field: "priority", schema: "CreateWorkItemRequest" },
      { field: "type", schema: "CreateWorkItemRequest" },
    ];
    for (const { field, schema } of rows) {
      const row = bugFields.split("\n").find((line) => line.startsWith(`| \`${field}\``));
      assert.ok(row, `bug-fields.md 里找不到 \`${field}\` 那一行——表格结构变了，请同步本测试`);

      const allowed = schemaEnum(yaml, schema, field);
      assert.ok(allowed, `合同里找不到 ${schema}.${field} 的 enum——schema 可能已改名`);

      const declared = [...row.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)]
        .map((match) => match[1])
        .filter((token) => token !== field); // 行首那个字段名本身不算值
      assert.ok(declared.length > 0, `\`${field}\` 那一行没写出任何词表值`);
      for (const value of declared) {
        assert.ok(
          allowed.includes(value),
          `bug-fields.md 的 \`${field}\` 写了 "${value}"，但合同 enum 只有 [${allowed}]`,
        );
      }
    }

    // 这几个不在表格里，按用法点检。
    for (const [schema, field, value] of [
      ["CreateRequirementRequest", "risk", "medium"],
      ["CreateAcceptanceItemRequest", "sourceKind", "ai"],
      ["CreateCommentRequest", "targetType", "bug"],
    ]) {
      const allowed = schemaEnum(yaml, schema, field);
      assert.ok(allowed?.includes(value), `${schema}.${field} 不再接受 "${value}"（现为 [${allowed}]）`);
    }
  });

  test("合同里带 maxLength 的字段，技能必须写明该约束", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    for (const schema of ["CreateRoomRequest", "SupportTicketRequest", "CreateHandoffRequest"]) {
      const limits = schemaMaxLengths(yaml, schema);
      assert.ok(Object.keys(limits).length > 0, `${schema} 不再声明 maxLength？确认合同变更`);
      for (const [field, limit] of Object.entries(limits)) {
        // 必须是「字段名 + 上限数字」同现，光在别处出现过这个数字不算数。
        const stated = allSkillText
          .split("\n")
          .some((line) => line.includes(field) && new RegExp(`\\b${limit}\\b`).test(line));
        assert.ok(stated, `${schema}.${field} 的 maxLength=${limit} 没在任何技能里与字段名同现——撞 422 才会被发现`);
      }
    }
  });

  test("search 仍具备正文召回与 cursor 分页（search.md 的能力声明据此撰写）", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    // skills/workflow-ops/references/search.md 声称 /search 支持 scope=body 与 cursor 分页。
    // 平台若回退这两个能力，技能会引导 Agent 发出 422 请求或漏掉查重结果——测试先亮红灯。
    assert.ok(/SearchCursor:/.test(yaml), "合同里找不到 SearchCursor 参数——/search 分页能力变了，同步 search.md");
    const scope = /SearchScope:[\s\S]{0,400}?enum:\s*\[([^\]]+)\]/.exec(yaml);
    assert.ok(scope, "合同里找不到 SearchScope 的 enum——/search 匹配范围参数变了，同步 search.md");
    for (const value of ["title", "body", "mixed"]) {
      assert.ok(scope[1].includes(value), `SearchScope enum 不再包含 "${value}"（现为 [${scope[1]}]），同步 search.md`);
    }
  });

  test("关系 API 事实：WorkItem schedule relations 与正式 Requirement 引用契约", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    const known = contractPaths(yaml);
    assert.ok(known.has("/schedule/relations"), "合同缺少 /schedule/relations，需同步 relation-provider.md");
    assert.ok(known.has("/schedule/relations/{}"), "合同缺少关系删除路径，需同步 relation-provider.md");

    const block = (path) => {
      const start = yaml.indexOf(`\n  ${path}:`);
      assert.ok(start >= 0, `合同里找不到 ${path}`);
      const rest = yaml.slice(start + 1);
      const next = rest.search(/\n {2}\//);
      return next > 0 ? rest.slice(0, next) : rest;
    };
    const relations = block("/schedule/relations");
    assert.match(relations, /post:/, "schedule relations 不再支持 POST，需同步 Provider");
    assert.match(
      yaml,
      /CreateScheduleRelationRequest:[\s\S]{0,500}finish_to_start/,
      "关系类型不再包含 finish_to_start，需同步 Provider",
    );
    const objectLinks = block("/object-links");
    assert.match(objectLinks, /get:/, "object-links 不再支持 GET，需同步 Provider");
    assert.doesNotMatch(objectLinks, /post:/, "object-links 出现 POST；首版只读，禁止臆造写入能力");

    for (const file of skillFiles) {
      assert.doesNotMatch(
        file.text,
        /(?:POST|PUT|PATCH|DELETE)\s+`?\/requirements\/[^\s`]+\/relations/,
        `${file.path} 臆造了 Requirement relation 写端点`,
      );
    }

    const provider = readFileSync(join(skillsRoot, "workflow-ops/references/relation-provider.md"), "utf8");
    assert.match(provider, /bindRequirementReference/);
    assert.match(provider, /unbindRequirementReference/);
    assert.match(provider, /getRequirementGraph/);
    assert.match(provider, /PUT \/api\/v1\/requirements\/\{requirementId\}\/references\/\{targetRequirementId\}/);
    assert.match(provider, /DELETE \/api\/v1\/requirements\/\{requirementId\}\/references\/\{targetRequirementId\}/);
    assert.match(provider, /GET \/api\/v1\/requirement-graph/);
    assert.match(provider, /无向/);
    assert.match(provider, /首次返回 201/);
    assert.match(provider, /重复解除.*204/);
  });

  test("support 收件仍匿名，agent 渠道契约未变（workflow-feedback 据此撰写）", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    // workflow-feedback 的前提是「公开匿名收件」。平台若给这两个端点加鉴权、改枚举
    // 或改 agent 条件必填五件套，技能会引导 Agent 发出被拒的请求——测试先亮红灯。
    const pathBlock = (path) => {
      const start = yaml.indexOf(`\n  ${path}:`);
      assert.ok(start >= 0, `合同里找不到 ${path}`);
      const rest = yaml.slice(start + 1);
      const next = rest.search(/\n {2}\//);
      return next > 0 ? rest.slice(0, next) : rest;
    };
    for (const path of ["/support/config", "/support/tickets"]) {
      assert.match(pathBlock(path), /security: \[\]/, `${path} 不再匿名（security 变了）——同步 workflow-feedback`);
    }

    for (const [field, expected] of [
      ["source", ["human", "agent"]],
      ["hostType", ["codex", "claude_code"]],
      ["type", ["bug", "feature"]],
    ]) {
      const allowed = schemaEnum(yaml, "SupportTicketRequest", field);
      assert.ok(allowed, `合同里找不到 SupportTicketRequest.${field} 的 enum——schema 可能已改名`);
      for (const value of expected) {
        assert.ok(
          allowed.includes(value),
          `SupportTicketRequest.${field} 不再包含 "${value}"（现为 [${allowed}]），同步 ticket-fields.md`,
        );
      }
    }

    assert.match(
      yaml,
      /required:\s*\[idempotencyKey, userConfirmed, pluginVersion, hostType, hostVersion\]/,
      "agent 渠道的条件必填五件套变了——同步 ticket-fields.md 与 submit-flow.md",
    );
  });

  test("本地 VERSION 不得低于线上发布版本", (t) => {
    if (offlineReason) return t.skip(offlineReason);
    const local = readFileSync(join(skillsRoot, "workflow-update/VERSION"), "utf8").trim();
    const compare = (a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
      return 0;
    };
    assert.ok(
      compare(local, onlineVersion) >= 0,
      `本地 VERSION=${local} 低于线上 ${onlineVersion}：仓库落后于已发布版本`,
    );
    if (compare(local, onlineVersion) > 0) {
      t.diagnostic(`提醒：仓库 ${local} 领先线上 ${onlineVersion}，手动/Codex 安装用户还拿不到`);
    }
  });
});

// 这几条不依赖网络：属于「已经踩过一次，不许再踩」的不变量。
describe("离线不变量", () => {
  test("技能里不得再出现写死的 status 值", () => {
    const offenders = [];
    for (const file of skillFiles) {
      for (const [index, line] of file.text.split("\n").entries()) {
        // 允许说明性文字提到 todo，但不允许出现在 JSON/赋值位置
        if (/["']status["']\s*:\s*["'][a-z_]+["']/.test(line) || /\bstatus\s*=\s*["'][a-z_]+["']/.test(line)) {
          offenders.push(`${file.path}:${index + 1}  ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `建单时不得显式传 status——项目可配自定义工作流，写死的值会 422：\n${offenders.join("\n")}`,
    );
  });

  test("硬闸门各处副本与 gates.md 逐字一致", () => {
    const extract = (text) => {
      const match = /<!-- gates:start -->\n([\s\S]*?)\n<!-- gates:end -->/.exec(text);
      return match?.[1].trim() ?? null;
    };
    const canonical = extract(readFileSync(join(skillsRoot, "workflow-ops/references/gates.md"), "utf8"));
    assert.ok(canonical, "gates.md 里找不到闸门块");

    const copies = skillFiles.filter((file) => file.text.includes("<!-- gates:start -->"));
    assert.ok(copies.length >= 3, "闸门块应至少存在于 gates.md 与两个 SKILL.md 中");
    for (const copy of copies) {
      assert.equal(extract(copy.text), canonical, `${copy.path} 的闸门块与 gates.md 不一致——闸门只能有一个版本`);
    }
  });

  test("凭证解析片段有且只有一份", () => {
    const owners = skillFiles
      .filter((file) => /export WORKFLOW_API_BASE=/.test(file.text))
      .map((file) => file.path);
    assert.deepEqual(owners, ["skills/workflow-ops/references/connection.md"]);
  });

  test("技能包只含 Markdown 与 VERSION，且不含疑似凭据", () => {
    for (const file of listFiles(skillsRoot)) {
      const display = relative(pluginRoot, file);
      assert.ok(
        extname(file) === ".md" || file.endsWith("VERSION"),
        `${display} 不是 Markdown 或 VERSION——技能包不允许可执行文件`,
      );
      assert.doesNotMatch(readFileSync(file, "utf8"), /wfp_[0-9a-zA-Z]{12,}/, `${display} 含疑似真实 token`);
    }
  });

  test("插件清单齐备,且发布面与开发面各就各位", () => {
    // 发布面:装进用户机器的就是 plugin/ 的全部内容。
    for (const required of ["plugin.json", ".claude-plugin/plugin.json", "LICENSE"]) {
      assert.ok(existsSync(join(pluginRoot, required)), `plugin/ 缺少 ${required}`);
    }
    // 开发面:留在仓库根,不下发。marketplace 也在根上——它用 git-subdir 指向 plugin/。
    const repoRoot = join(pluginRoot, "..");
    for (const required of [".claude-plugin/marketplace.json", "CHANGELOG.md", "package.json"]) {
      assert.ok(existsSync(join(repoRoot, required)), `仓库根缺少 ${required}`);
    }
    // 反向:开发过程文件不得混进发布面。
    for (const leaked of ["tests", "package.json", ".github"]) {
      assert.equal(existsSync(join(pluginRoot, leaked)), false, `发布面混入 ${leaked}`);
    }
  });
});

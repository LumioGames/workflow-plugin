// inject-rules（SessionStart 注入）的行为测试。
//
// 存在的理由：注入脚本是「规则每次会话在场」的唯一通道，它漏读一个文件、把索引正文整段
// 塞进上下文、或者读不到 settings.json 就崩，都会静默地把整套规则打回原形。全部用临时
// HOME / XDG_CACHE_HOME / 插件根打桩，不碰真实用户目录。

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAdditionalContext,
  buildIndexLine,
  buildRulesContext,
  detectLegacyPlugin,
} from "../plugin/tools/inject-rules.mjs";
import { cacheIndexPath, resolveCredentials } from "../plugin/tools/lib/workflow-config.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "tools/inject-rules.mjs");

const HOST = "sandbox.example.test";
let sandbox;
let pluginRoot;
let home;
let cacheHome;
let project;

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeIndex(doc) {
  // 不硬编码缓存文件名：身份键含端口与凭据指纹，让被测实现自己算路径。
  const creds = resolveCredentials({ env: baseEnv(), cwd: project, home });
  assert.ok(creds.ok, `fixture 凭据应可解析，实得 ${creds.reason}`);
  writeJson(cacheIndexPath({ env: baseEnv(), home, creds }), doc);
}

function baseEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CACHE_HOME: cacheHome,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    ...extra,
  };
}

function runScript({ cwd = project, env = baseEnv() } = {}) {
  const stdout = execFileSync(process.execPath, [script], { cwd, env, encoding: "utf8" });
  return JSON.parse(stdout);
}

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "inject-rules-"));
  pluginRoot = join(sandbox, "plugin");
  home = join(sandbox, "home");
  cacheHome = join(sandbox, "cache");
  project = join(sandbox, "project");

  mkdirSync(join(pluginRoot, "rules"), { recursive: true });
  writeFileSync(join(pluginRoot, "rules/system.md"), "# System Rules\n\n- 子 Agent 不得再派生子 Agent。\n");
  writeFileSync(join(pluginRoot, "rules/dispatch.md"), "# Dispatch Rules\n\n- 状态不是枚举。\n");
  writeFileSync(join(pluginRoot, "rules/README.md"), "# 这是 README，不注入\n");
  writeFileSync(join(pluginRoot, "rules/.fingerprint.json"), "{\"lines\":[]}\n");

  mkdirSync(join(home, ".config/workflow"), { recursive: true });
  writeFileSync(
    join(home, ".config/workflow/config.toml"),
    `current_profile = "other"\n\n[profiles.other]\nbase_url = "https://other.example.test"\ntoken = "wfp_other0000"\n\n[profiles.sandbox]\nbase_url = "https://${HOST}"\ntoken = "wfp_sandbox00"\n`,
  );

  mkdirSync(join(project, ".git"), { recursive: true });
  writeFileSync(join(project, ".workflow"), 'profile = "sandbox"\n');
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("规则文件遍历", () => {
  test("注入 rules/*.md，排除 README.md 与点开头文件，顺序按文件名稳定", () => {
    const text = buildRulesContext(pluginRoot);
    assert.match(text, /# Dispatch Rules/);
    assert.match(text, /# System Rules/);
    assert.ok(text.indexOf("# Dispatch Rules") < text.indexOf("# System Rules"), "dispatch 应排在 system 前（字典序）");
    assert.doesNotMatch(text, /这是 README/);
    assert.doesNotMatch(text, /fingerprint/);
  });

  test("rules/ 不存在时返回空串，不抛", () => {
    assert.equal(buildRulesContext(join(sandbox, "nope")), "");
  });
});

describe("索引一行", () => {
  test("有索引文件：报路径、总数、各 Room 计数、多久前刷新，且不带正文", () => {
    const now = Date.parse("2026-09-10T10:00:00Z");
    writeIndex({
      api: 1,
      host: HOST,
      serverTime: "2026-09-10T09:50:00Z",
      fullPulledAt: "2026-09-10T09:50:00Z",
      refreshedAt: "2026-09-10T09:53:00Z",
      rooms: { "RM-00001": { id: "r1", name: "A" }, "RM-00002": { id: "r2", name: "B" } },
      items: {
        "R-00001": { type: "requirement", room: "RM-00001", title: "标题一", status: "x", updatedAt: "2026-09-01T00:00:00Z" },
        "R-00002": { type: "requirement", room: "RM-00001", title: "标题二", status: "x", updatedAt: "2026-09-01T00:00:00Z" },
        "B-00001": { type: "bug", room: "RM-00002", title: "标题三", status: "x", updatedAt: "2026-09-01T00:00:00Z" },
      },
    });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home, now: () => now });
    // 文件名带凭据身份指纹（区分端口与 token 范围），这里只钉 host 段与其后的 8 位十六进制。
    assert.match(line, new RegExp(`线上单据索引在 .*workflow/index/${HOST.replace(/\./g, "\\.")}-[0-9a-f]{8}\\.json：3 张（RM-00001 2 / RM-00002 1），7 分钟前刷新`));
    assert.match(line, /只用来找单号和 Room，状态以线上为准/);
    assert.doesNotMatch(line, /标题一/, "索引正文不得注入");
    assert.doesNotMatch(line, /离线沿用/);
  });

  test("索引带 stale 标记：追加「离线沿用」与原因", () => {
    const now = Date.parse("2026-09-10T10:00:00Z");
    writeIndex({
      api: 1,
      host: HOST,
      serverTime: "2026-09-10T09:50:00Z",
      fullPulledAt: "2026-09-10T09:50:00Z",
      refreshedAt: "2026-09-10T09:50:00Z",
      rooms: {},
      items: {},
      stale: { attemptedAt: "2026-09-10T09:58:00Z", reason: "网络错误：fetch failed" },
    });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home, now: () => now });
    assert.match(line, /0 张（空）/);
    assert.match(line, /离线沿用：最近一次刷新（2 分钟前）失败——网络错误：fetch failed/);
  });

  test("没有 .workflow：说「未生成」与原因，不读任何索引", () => {
    const bare = join(sandbox, "bare");
    mkdirSync(join(bare, ".git"), { recursive: true });
    const line = buildIndexLine({ env: baseEnv(), cwd: bare, home });
    assert.equal(line, "线上单据索引未生成（当前目录没有 .workflow 标记）。");
  });

  test("有 .workflow 但索引文件不存在：提示可用 /workflow:index", () => {
    rmSync(join(cacheHome, "workflow"), { recursive: true, force: true });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home });
    assert.match(line, /^线上单据索引未生成（尚未刷新或刷新失败；\/workflow:index 可手动刷新）。$/);
  });
});

describe("失败域隔离：便利索引坏掉不得抹掉硬规则", () => {
  // 回归锚点：readIndexFile 曾用 typeof doc.items !== "object" 判形状，而 typeof null === "object"，
  // 于是 items:null 一路混到 Object.values 才抛——那次抛发生在 buildAdditionalContext 里，
  // 结果是 exit 1、stdout 0 字节，两份硬红线一起无声消失。
  const brokenCaches = {
    "items 为 null": { api: 1, items: null, refreshedAt: "2026-09-10T09:53:00Z" },
    "items 是数组": { api: 1, items: [], refreshedAt: "2026-09-10T09:53:00Z" },
    "整个文件不是 JSON": "{ not json",
  };

  for (const [name, doc] of Object.entries(brokenCaches)) {
    test(`${name} → 规则照常注入，索引降级成一行说明`, () => {
      const creds = resolveCredentials({ env: baseEnv(), cwd: project, home });
      const p = cacheIndexPath({ env: baseEnv(), home, creds });
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, typeof doc === "string" ? doc : JSON.stringify(doc));

      const text = buildAdditionalContext({ pluginRoot, env: baseEnv(), cwd: project, home });
      assert.match(text, /# System Rules/, "硬规则必须仍在场");
      assert.match(text, /# Dispatch Rules/, "硬规则必须仍在场");
      assert.match(text, /线上单据索引/, "索引失败要说一句，不能装作没这回事");

      rmSync(join(cacheHome, "workflow"), { recursive: true, force: true });
    });
  }

  test("子进程实跑：坏缓存下退出码仍为 0、stdout 是合法 JSON", () => {
    const creds = resolveCredentials({ env: baseEnv(), cwd: project, home });
    const p = cacheIndexPath({ env: baseEnv(), home, creds });
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ api: 1, items: null }));

    // 这里要的是原始退出码，所以不走 runScript（它会 JSON.parse 并在非零时直接抛）。
    const r = spawnSync(process.execPath, [script], { cwd: project, env: baseEnv(), encoding: "utf8" });
    assert.equal(r.status, 0, `坏缓存不得让 hook 非零退出，stderr=${r.stderr}`);
    assert.ok(r.stdout.length > 0, "stdout 不得为空——空输出等于规则整段缺席");
    const parsed = JSON.parse(r.stdout);
    assert.match(parsed.hookSpecificOutput.additionalContext, /# System Rules/);

    rmSync(join(cacheHome, "workflow"), { recursive: true, force: true });
  });
});

describe("Room 计数封顶", () => {
  test("Room 很多时只点名前 5 个，其余折成计数（常驻成本不随 Room 数线性涨）", () => {
    const items = {};
    for (let i = 1; i <= 40; i++) {
      items[`R-${String(i).padStart(5, "0")}`] = {
        type: "requirement",
        room: `RM-${String(i).padStart(5, "0")}`,
        title: "t",
        status: "x",
        updatedAt: "2026-09-01T00:00:00Z",
      };
    }
    writeIndex({ api: 1, host: HOST, serverTime: "2026-09-10T09:50:00Z", refreshedAt: "2026-09-10T09:53:00Z", rooms: {}, items });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home });

    assert.match(line, /40 张/, "总数仍要如实报");
    assert.match(line, /另 35 个 Room/, "其余折成计数");
    assert.equal((line.match(/RM-/g) ?? []).length, 5, "最多点名 5 个 Room");
    assert.ok(line.length < 400, `索引一行不该失控，实测 ${line.length} 字符`);

    rmSync(join(cacheHome, "workflow"), { recursive: true, force: true });
  });
});

describe("env 覆盖目录绑定要明示", () => {
  test("目录有 .workflow 但 env 生效 → 索引行必须说出覆盖来源", () => {
    const env = baseEnv({
      WORKFLOW_API_BASE: "https://other.example.test/api/v1",
      WORKFLOW_TOKEN: "wfp_envtoken0",
    });
    const creds = resolveCredentials({ env, cwd: project, home });
    assert.equal(creds.source, "env", "env 优先于 marker 是既定口径");
    writeJson(cacheIndexPath({ env, home, creds }), {
      api: 1, host: "other.example.test", serverTime: "2026-09-10T09:50:00Z",
      refreshedAt: "2026-09-10T09:53:00Z", rooms: {}, items: {},
    });

    const line = buildIndexLine({ env, cwd: project, home });
    assert.match(line, /环境变量.*覆盖/, "不能把 A 的摘要伪装成 B 的项目上下文");
    assert.match(line, /other\.example\.test/, "要点名实际来源");

    rmSync(join(cacheHome, "workflow"), { recursive: true, force: true });
  });
});

describe("lumioagentspec 共存警告", () => {
  test("settings.json 的 enabledPlugins 里 lumio@lumioagentspec 为 true → 警告", () => {
    const h = join(sandbox, "home-enabled");
    writeJson(join(h, ".claude/settings.json"), { enabledPlugins: { "lumio@lumioagentspec": true, "workflow@workflow-plugin": true } });
    assert.equal(detectLegacyPlugin({ home: h }), "enabled");
  });

  test("enabledPlugins 里显式为 false → 用户已关掉，不再催卸载", () => {
    // 安装 ≠ 启用。显式关掉了还每次会话报「仍启用」，是在误报，且白付常驻成本。
    const h = join(sandbox, "home-disabled");
    writeJson(join(h, ".claude/settings.json"), { enabledPlugins: { "lumio@lumioagentspec": false } });
    writeJson(join(h, ".claude/plugins/installed_plugins.json"), { version: 2, plugins: { "lumio@lumioagentspec": [{ scope: "user" }] } });
    assert.equal(detectLegacyPlugin({ home: h }), null);
  });

  test("settings.json 没提到它、但 installed_plugins.json 里有 → 只说检测到安装，不断言启用", () => {
    const h = join(sandbox, "home-installed");
    writeJson(join(h, ".claude/settings.json"), { enabledPlugins: { "workflow@workflow-plugin": true } });
    writeJson(join(h, ".claude/plugins/installed_plugins.json"), { version: 2, plugins: { "lumio@lumioagentspec": [{ scope: "user" }] } });
    assert.equal(detectLegacyPlugin({ home: h }), "installed");
  });

  test("两个文件都没有 lumioagentspec → 不警告；文件缺失或损坏 → 静默不警告", () => {
    const clean = join(sandbox, "home-clean");
    writeJson(join(clean, ".claude/settings.json"), { enabledPlugins: { "workflow@workflow-plugin": true } });
    writeJson(join(clean, ".claude/plugins/installed_plugins.json"), { version: 2, plugins: { "workflow@workflow-plugin": [] } });
    assert.equal(detectLegacyPlugin({ home: clean }), null);

    const broken = join(sandbox, "home-broken");
    mkdirSync(join(broken, ".claude"), { recursive: true });
    writeFileSync(join(broken, ".claude/settings.json"), "{ not json");
    assert.equal(detectLegacyPlugin({ home: broken }), null);
    assert.equal(detectLegacyPlugin({ home: join(sandbox, "home-missing") }), null);
  });
});

describe("脚本端到端（作为 SessionStart hook 运行）", () => {
  test("stdout 是 hookSpecificOutput JSON：含两份规则、索引一行、共存警告", () => {
    writeIndex({
      api: 1,
      host: HOST,
      serverTime: "2026-09-10T09:50:00Z",
      fullPulledAt: "2026-09-10T09:50:00Z",
      refreshedAt: new Date().toISOString(),
      rooms: { "RM-00001": { id: "r1", name: "A" } },
      items: { "R-00001": { type: "requirement", room: "RM-00001", title: "标题一", status: "x", updatedAt: "2026-09-01T00:00:00Z" } },
    });
    writeJson(join(home, ".claude/settings.json"), { enabledPlugins: { "lumio@lumioagentspec": true } });

    const out = runScript();
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.startsWith("<workflow-rules>\n以下是 Workflow 插件的常驻规则，每次会话强制在场；插件根目录 "), ctx.slice(0, 120));
    assert.ok(ctx.trimEnd().endsWith("</workflow-rules>"));
    assert.match(ctx, /# System Rules/);
    assert.match(ctx, /# Dispatch Rules/);
    assert.match(ctx, /线上单据索引在 .*：1 张（RM-00001 1），0 分钟前刷新/);
    assert.match(ctx, /⚠ 检测到 lumioagentspec 插件仍启用：其功能已并入 workflow 1\.0\.0，请卸载或禁用，否则两套规则同时在场/);
    assert.doesNotMatch(ctx, /标题一/);
    assert.doesNotMatch(ctx, /wfp_/, "token 不得出现在注入内容里");
  });

  test("没装旧插件时不出警告；buildAdditionalContext 与脚本输出一致", () => {
    writeJson(join(home, ".claude/settings.json"), { enabledPlugins: { "workflow@workflow-plugin": true } });
    const out = runScript();
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.doesNotMatch(ctx, /lumioagentspec/);
    const direct = buildAdditionalContext({ pluginRoot, env: baseEnv(), cwd: project, home });
    assert.equal(direct, ctx);
  });
});

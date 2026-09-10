import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");

function read(relativePath) {
  const absolute = join(pluginRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

const policy = read("skills/workflow-ops/references/permission-modes.md");
const ops = read("skills/workflow-ops/SKILL.md");
const setup = read("skills/workflow-setup/SKILL.md");
const planning = read("skills/workflow-planning/SKILL.md");
const upload = read("skills/workflow-upload/SKILL.md");
const command = read("commands/policy.md");

describe("Workflow 权限模式合同", () => {
  test("四种模式与默认值完整且语义不漂移", () => {
    for (const mode of ["plan", "manual", "auto", "full"]) {
      assert.match(policy, new RegExp("\\\\| `" + mode + "`"), `缺少 ${mode} 模式`);
    }
    assert.match(policy, /`auto` \| Auto（默认）/);
    assert.match(policy, /`plan`[\s\S]*禁止 POST\/PATCH\/PUT\/DELETE/);
    assert.match(policy, /`manual`[\s\S]*每个操作组写入前单独确认/);
    assert.match(policy, /`auto`[\s\S]*只确认一次 bundle/);
    assert.match(policy, /`full`[\s\S]*草稿就绪后自动上传/);
  });

  test("策略优先级与项目降权规则明确", () => {
    assert.match(policy, /用户 profile 策略 → 项目覆盖 → `default_mode` → `auto`/);
    assert.match(policy, /项目策略只能降低权限/);
    assert.match(policy, /不能把用户级 `auto` 升为 `full`/);
    assert.match(policy, /`full` 必须由用户级 profile 显式设置/);
    assert.match(policy, /未知值时停止写入/);
    assert.match(setup, /项目级 `.workflow-policy` 只能降权/);
    assert.match(command, /项目策略不得把用户级权限提升到 `full`/);
  });

  test("模式不绕过安全闸门与匿名反馈/QA 边界", () => {
    assert.match(policy, /不改变 G1\/G3\/G4\/G6\/G7/);
    assert.match(policy, /不允许跳过环检测、项目一致性/);
    assert.match(policy, /反馈的 F1-F7、QA 的 Q1-Q7/);
    assert.match(upload, /full.*仍执行所有安全闸门/);
    assert.match(ops, /线上写入必须交给上传器/);
  });

  test("规划和单次操作都先落本地 bundle", () => {
    for (const text of [ops, planning, upload]) {
      assert.match(text, /\.workflow-drafts<|\.workflow-drafts\//);
      assert.match(text, /本地/);
    }
    assert.match(setup, /不得覆盖、清理或上传其中内容/);
  });
});

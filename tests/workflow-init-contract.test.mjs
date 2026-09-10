// workflow-init：用户只面对一次初始化。脚手架不写 token；接入阶段紧跟其后；不再有独立 setup。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");

function read(relativePath) {
  const absolute = join(pluginRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

describe("用户只面对 workflow-init", () => {
  test("没有 workflow-setup 技能目录，也没有 /workflow:setup 命令", () => {
    assert.equal(existsSync(join(pluginRoot, "skills/workflow-setup")), false);
    assert.equal(existsSync(join(pluginRoot, "commands/setup.md")), false);
    for (const name of readdirSync(join(pluginRoot, "commands"))) {
      assert.notEqual(name, "setup.md");
      const text = readFileSync(join(pluginRoot, "commands", name), "utf8");
      assert.doesNotMatch(text, /\/workflow:setup\b/, `${name} 仍把 /workflow:setup 当成用户入口`);
    }
    for (const name of readdirSync(join(pluginRoot, "skills"))) {
      assert.notEqual(name, "workflow-setup");
    }
  });

  test("init 命令与技能都要求骨架之后立刻跑接入，而不是下一步去 setup", () => {
    const command = read("commands/init.md");
    const skill = read("skills/workflow-init/SKILL.md");
    for (const [name, text] of [
      ["commands/init.md", command],
      ["skills/workflow-init/SKILL.md", skill],
    ]) {
      assert.match(text, /阶段 1/, `${name} 缺阶段 1`);
      assert.match(text, /阶段 2/, `${name} 缺阶段 2`);
      assert.match(text, /init-scaffold/, `${name} 缺脚手架`);
      assert.match(text, /connection-setup\.md/, `${name} 缺接入正文`);
      assert.match(text, /立刻/, `${name} 必须立刻进入接入，不能停下来让用户另跑`);
      assert.doesNotMatch(text, /下一步.*setup|去 \/workflow:setup|跑 \/workflow:setup/, `${name} 仍把 setup 当成下一步`);
    }
    assert.match(command, /workflow-init/);
    assert.match(skill, /^---\nname: workflow-init\n/);
  });

  test("脚手架半程不写 token；接入半程禁止把 token 贴进会话", () => {
    const skill = read("skills/workflow-init/SKILL.md");
    const setup = read("skills/workflow-init/references/connection-setup.md");
    const note = read("tools/init-scaffold.mjs");
    assert.match(skill, /不写 token/);
    assert.match(skill, /不读 `config\.toml`/);
    assert.match(note, /不写 \.workflow、不生成 token/);
    assert.match(setup, /不要请用户把 token 粘贴到会话里/);
    assert.match(setup, /token 全程不进会话/);
    assert.match(setup, /\/me` 返回 200/);
    assert.match(setup, /\/projects\/current` 返回 200/);
  });
});

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

const skill = read("skills/workflow-dependencies/SKILL.md");
const model = read("skills/workflow-dependencies/references/dependency-model.md");
const provider = read("skills/workflow-ops/references/relation-provider.md");
const orchestration = read("skills/workflow-ops/references/orchestration.md");
const planning = read("skills/workflow-planning/SKILL.md");
const search = read("skills/workflow-ops/references/search.md");

describe("Workflow 依赖分析合同", () => {
  test("A/B/C 示例补全 direct edge 与传递链", () => {
    assert.match(model, /A、B.*C/);
    assert.match(model, /`A -> C`、`B -> C`/);
    assert.match(model, /`A -> B -> C`/);
    assert.match(skill, /所有可解析的直接边写入 manifest/);
    assert.match(model, /transitive.*不直接写 API|不直接写 API.*transitive/);
  });

  test("每条边有证据、置信度和推断方式，方向唯一", () => {
    for (const token of ["upstream", "downstream", "evidence", "confidence", "inferenceMethod"]) {
      assert.match(model + skill, new RegExp(token), `依赖模型缺少 ${token}`);
    }
    assert.match(model, /upstream -> downstream/);
    assert.match(skill, /自环、环、孤儿或跨项目引用/);
    assert.match(skill, /implementation 边才使用 workflow 返回的[\s\S]{0,80}`semantic`、`isTerminal`/);
    assert.match(model, /`basis`.*`interface`.*`implementation`/);
    assert.match(model, /`basis=interface`[\s\S]*上游实现状态未完成不构成阻塞/);
    assert.match(model, /`basis=implementation`[\s\S]*`semantic`、`isTerminal`/);
    assert.match(model, /reason.*unblockCondition/);
    assert.match(model, /历史 bundle.*不回写/);
  });

  test("依赖分析与上传、查重时序接通", () => {
    assert.match(planning, /调用 `workflow-dependencies`/);
    assert.match(planning, /上传时再替换为真实 displayKey\/UUID/);
    assert.match(search, /草稿生成前/);
    assert.match(search, /上传前/);
    assert.match(orchestration, /relation-provider\.md/);
    assert.match(orchestration, /依赖分析与前置核对/);
    assert.match(skill, /longestChainCards/);
    assert.match(skill, /parallelWidth/);
    assert.match(skill, /增量 bundle/);
  });

  test("Provider 使用正式 Requirement 引用端点，不误解无向图谱", () => {
    assert.match(provider, /POST \/schedule\/relations/);
    assert.match(provider, /仅支持 `finish_to_start`/);
    for (const operationId of ["bindRequirementReference", "unbindRequirementReference", "getRequirementGraph"]) {
      assert.match(provider, new RegExp(operationId), `缺少 ${operationId}`);
    }
    assert.match(provider, /PUT \/api\/v1\/requirements\/\{requirementId\}\/references\/\{targetRequirementId\}/);
    assert.match(provider, /DELETE \/api\/v1\/requirements\/\{requirementId\}\/references\/\{targetRequirementId\}/);
    assert.match(provider, /GET \/api\/v1\/requirement-graph/);
    assert.match(provider, /无向 native reference/);
    assert.match(provider, /`native=true`/);
    assert.match(provider, /`directional=false`/);
    assert.match(provider, /source[\s\S]*target[\s\S]*不代表依赖方向/);
    assert.match(provider, /truncated=false/);
    assert.match(provider, /canonical lowercase hyphenated UUID/);
    assert.match(provider, /首次返回 201/);
    assert.match(provider, /已存在返回 200/);
    assert.match(provider, /均返回 204/);
    assert.match(provider, /最多 300 个节点/);
    assert.match(provider, /requirement_room/);
    assert.match(orchestration, /需求级有向依赖关系没有独立 API/);
  });
});

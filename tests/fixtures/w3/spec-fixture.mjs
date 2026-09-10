// W3 测试共用的临时项目 fixture:在系统临时目录搭一个最小合法的 .spec/ 项目,按需覆写文件、初始化 git。
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** 发布面根:插件资产(tools/ bin/ templates/ rules/ …)全部在 <仓库根>/plugin 下。 */
export const PLUGIN_ROOT = join(REPO_ROOT, 'plugin')

export const makeTemp = (prefix = 'w3-') => mkdtempSync(join(tmpdir(), prefix))

/** 写入 { 相对路径: 内容 };内容为 null 表示删除该文件。 */
export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    if (content === null) { rmSync(p, { force: true }); continue }
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
}

export const MINIMAL = {
  'CLAUDE.md': '# CLAUDE.md\n\n@.spec/AGENTS.md\n\n@.spec/knowledge/README.md\n\n@.spec/rules/system.md\n',
  '.spec/AGENTS.md': '# 中心文档\n\n## 项目是什么\n\n测试项目。\n',
  '.spec/rules/system.md': '# 项目专属规则\n',
  '.spec/knowledge/README.md': [
    '---', 'name: knowledge', 'description: 导航', 'metadata:', '  type: index', '---', '',
    '# 导航', '', '| 文档 | 一句话 |', '|------|--------|',
    '| [`standards/workflow.md`](standards/workflow.md) | 工作流 |',
    '| [`features/_TEMPLATE.md`](features/_TEMPLATE.md) | 模板 |', '',
  ].join('\n'),
  '.spec/knowledge/standards/workflow.md':
    '---\nname: workflow\ndescription: 工作流\nmetadata:\n  type: doc\n  status: 已交付\n---\n\n# 工作流\n',
  '.spec/knowledge/features/_TEMPLATE.md':
    '---\nname: template\ndescription: 模板\nmetadata:\n  type: doc\n  status: 设计中\n---\n\n# 模板\n',
  '.spec/agents/coder.agent.md': '---\nname: coder\ndescription: 写代码\n---\n\n# Coder\n',
  '.spec/skills/demo/SKILL.md': '---\nname: demo\ndescription: 演示\n---\n\n# Demo\n',
}

/**
 * 最小合法项目。overrides 覆写 / 追加 / 删除(null)文件;links 为 false 时不建软链。
 * linkOverrides 可改软链目标(相对链接所在目录)。
 */
export function specFixture(overrides = {}, { links = true, linkOverrides = {} } = {}) {
  const root = makeTemp('spec-lint-')
  writeFiles(root, { ...MINIMAL, ...overrides })
  if (links) {
    mkdirSync(join(root, '.claude'), { recursive: true })
    mkdirSync(join(root, '.agents'), { recursive: true })
    const targets = {
      '.claude/agents': '../.spec/agents',
      '.claude/skills': '../.spec/skills',
      '.agents/skills': '../.spec/skills',
      ...linkOverrides,
    }
    for (const [rel, target] of Object.entries(targets)) {
      if (target === null) continue
      symlinkSync(target, join(root, rel))
    }
  }
  return root
}

/** 在 root 下写一个 decisions/ 分区:adrs = { 文件名: 正文 },全部登记进 README。 */
export function withDecisions(root, adrs) {
  const dir = join(root, '.spec', 'decisions')
  mkdirSync(dir, { recursive: true })
  const index = Object.keys(adrs).map((n) => `- [${n}](${n})`).join('\n')
  writeFileSync(join(dir, 'README.md'), `# Decisions\n\n${index}\n`)
  for (const [name, body] of Object.entries(adrs)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return root
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'w3', GIT_AUTHOR_EMAIL: 'w3@test', GIT_COMMITTER_NAME: 'w3', GIT_COMMITTER_EMAIL: 'w3@test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
}

/** 在 root 里跑 git(不读用户全局配置,避免 hooksPath / gpgsign 干扰)。 */
export function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: root, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** git init + 首次提交(全部文件)。 */
export function gitInit(root, message = 'init') {
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
  return root
}

export function cleanup(root) {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
}

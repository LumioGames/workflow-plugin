/**
 * 通用检查项的固定顺序（报告按此顺序汇总）。每项 `{ id, title, run(ctx) }`，
 * run 可返回 `{ skipped: '原因' }` 表示本项在该项目没有校验面；抛异常由 core 兜底上报。
 */
import coreFiles from './core-files.mjs'
import frontmatter from './frontmatter.mjs'
import { navCoverage, adrIndex } from './navigation.mjs'
import links from './links.mjs'
import imports from './imports.mjs'
import { agentsFrontmatter, skillsFrontmatter } from './agents-skills.mjs'
import symlinks from './symlinks.mjs'
import { adrUniqueId, adrStatus } from './adr.mjs'
import docRoots from './doc-roots.mjs'

export const CORE_CHECKS = [
  coreFiles,
  frontmatter,
  navCoverage,
  adrIndex,
  links,
  imports,
  agentsFrontmatter,
  skillsFrontmatter,
  symlinks,
  adrUniqueId,
  adrStatus,
  docRoots,
]

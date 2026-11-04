// 规格模板体系：生成 SPEC 正文时的骨架——通用/类型级/任务级三层覆盖，用户压过系统
// 覆盖链（具体到通用）：任务目录 TEMPLATE.md → .taskchain/TEMPLATES/{type}.md → .taskchain/TEMPLATES/SPEC.md → 系统内置类型模板
// 应用点：new 落盘正文即模板骨架；对话成规格 prompt 注入模板引导（split/pipeline 复用 new 自动继承）
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** 系统内置类型模板：每类型一段正文骨架（用户可用 TEMPLATES/ 覆盖） */
const BUILTIN_SPEC_TEMPLATES: Record<string, string> = {
  general: [
    '## 任务背景',
    '',
    '（为什么做这件事）',
    '',
    '## 执行要点',
    '',
    '（做什么、大致步骤、关键边界）',
  ].join('\n'),
  doc: [
    '## 背景与目的',
    '',
    '（这份文档解决什么问题、给谁看）',
    '',
    '## 内容大纲',
    '',
    '（章节结构与每章要点）',
    '',
    '## 交付结构',
    '',
    '（产出文件的组织方式与命名）',
  ].join('\n'),
  script: [
    '## 脚本用途',
    '',
    '（这个脚本解决什么问题、谁来用）',
    '',
    '## 输入与输出',
    '',
    '（入参、读哪些文件、输出到哪、格式如何）',
    '',
    '## 边界情况',
    '',
    '（异常输入、空值、失败时的处理约定）',
  ].join('\n'),
  data: [
    '## 数据来源',
    '',
    '（数据从哪来、原始格式与口径）',
    '',
    '## 整理规则',
    '',
    '（清洗、去重、汇总的规则）',
    '',
    '## 字段说明',
    '',
    '（产出数据的字段定义与示例）',
  ].join('\n'),
  research: [
    '## 调研问题',
    '',
    '（要回答的核心问题）',
    '',
    '## 信息来源',
    '',
    '（查哪些资料、来源标注约定）',
    '',
    '## 结论要点',
    '',
    '（结论 + 依据 + 建议的下一步）',
  ].join('\n'),
  presentation: [
    '## 主题与受众',
    '',
    '（讲给谁听、要达到什么效果）',
    '',
    '## 大纲',
    '',
    '（逐页结构：每页标题 + 要点）',
    '',
    '## 交付形式',
    '',
    '（Markdown 大纲 + 逐页内容，渲染交用户）',
  ].join('\n'),
  feature: [
    '## 需求背景',
    '',
    '（为什么要做这个功能、解决什么用户问题）',
    '',
    '## 功能要点',
    '',
    '（功能范围、交互与边界、不做什么）',
    '',
    '## 技术方案',
    '',
    '（实现思路、涉及文件/模块、风险点）',
  ].join('\n'),
  bugfix: [
    '## 问题现象',
    '',
    '（怎么复现、影响范围）',
    '',
    '## 根因分析',
    '',
    '（问题的真正原因、证据链）',
    '',
    '## 修复方案',
    '',
    '（改哪里、为什么这样改）',
    '',
    '## 回归验证',
    '',
    '（怎么证明修好了、不引入新问题）',
  ].join('\n'),
};

/** 模板解析结果：内容 + 来源（任务级 / 类型级 / 通用 / 系统内置） */
export interface SpecTemplate {
  content: string;
  source: 'task' | 'type' | 'generic' | 'builtin';
}

/**
 * 解析任务规格模板（覆盖链，具体到通用）：
 * 1. 任务目录内 TEMPLATE.md（某个任务自有的模板）
 * 2. .taskchain/TEMPLATES/{type}.md（类型级）
 * 3. .taskchain/TEMPLATES/SPEC.md（通用模板）
 * 4. 系统内置类型模板（代码兜底）
 */
export function resolveSpecTemplate(metaDir: string, taskDir: string, type: string): SpecTemplate {
  const taskTpl = join(taskDir, 'TEMPLATE.md');
  if (existsSync(taskTpl)) {
    try {
      const content = readFileSync(taskTpl, 'utf-8').trim();
      if (content) return { content, source: 'task' };
    } catch {
      // 读不了就降级
    }
  }
  const typeTpl = join(metaDir, 'TEMPLATES', `${type}.md`);
  if (existsSync(typeTpl)) {
    try {
      const content = readFileSync(typeTpl, 'utf-8').trim();
      if (content) return { content, source: 'type' };
    } catch {
      // 读不了就降级
    }
  }
  const genericTpl = join(metaDir, 'TEMPLATES', 'SPEC.md');
  if (existsSync(genericTpl)) {
    try {
      const content = readFileSync(genericTpl, 'utf-8').trim();
      if (content) return { content, source: 'generic' };
    } catch {
      // 读不了就降级
    }
  }
  return { content: BUILTIN_SPEC_TEMPLATES[type] || BUILTIN_SPEC_TEMPLATES.general, source: 'builtin' };
}

/** 内置模板的占位符行全集（「（…）」形态）——clarify 体检用它识别骨架未填实 */
export function builtinTemplatePlaceholders(): Set<string> {
  const set = new Set<string>();
  for (const tpl of Object.values(BUILTIN_SPEC_TEMPLATES)) {
    for (const line of tpl.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('（') && trimmed.endsWith('）')) set.add(trimmed);
    }
  }
  return set;
}

/** 模板来源的人类可读名（prompt / 输出提示用） */
export function templateSourceLabel(source: SpecTemplate['source'], type: string): string {
  switch (source) {
    case 'task':
      return '任务自有模板（TEMPLATE.md）';
    case 'type':
      return `类型模板（.taskchain/TEMPLATES/${type}.md）`;
    case 'generic':
      return '通用模板（.taskchain/TEMPLATES/SPEC.md）';
    default:
      return `系统内置模板（${type} 类型）`;
  }
}

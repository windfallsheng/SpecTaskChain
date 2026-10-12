// 开放任务类型系统：内置类型 + 自定义类型定义文件（.taskchain/TASK_TYPES/{type}.md）
// 核心规则：非代码类型默认与代码世界绝缘，spec 显式声明 code: true 才切代码形态
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseFrontmatter } from './task-spec';

export interface TaskTypeDefinition {
  name: string;
  code: boolean;              // 是否为代码类型（code: true 才切代码形态）
  outputDir: string;          // 默认产出位置
  defaultConstraints: string[]; // 类型默认约束（每次执行注入）
  description: string;
}

/** 内置类型：非代码任务一等公民 */
const BUILTIN_TYPES: Record<string, TaskTypeDefinition> = {
  general: { name: 'general', code: false, outputDir: 'outputs/', defaultConstraints: [], description: '通用任务（无类型声明时的回退）' },
  doc: { name: 'doc', code: false, outputDir: 'docs/', defaultConstraints: ['产出为 Markdown 文档，结构清晰、事实准确'], description: '文档写作' },
  script: { name: 'script', code: true, outputDir: 'scripts/', defaultConstraints: ['脚本可独立运行，含必要的注释与错误处理'], description: '脚本编写' },
  data: { name: 'data', code: false, outputDir: 'data/', defaultConstraints: ['数据格式统一、含字段说明'], description: '数据整理' },
  research: { name: 'research', code: false, outputDir: 'research/', defaultConstraints: ['结论有依据、引用标注来源'], description: '调研分析' },
  presentation: { name: 'presentation', code: false, outputDir: 'presentation/', defaultConstraints: ['Markdown 大纲 + 逐页内容，渲染交用户'], description: '演示稿' },
  feature: { name: 'feature', code: true, outputDir: 'src/', defaultConstraints: [], description: '功能开发（代码任务）' },
  bugfix: { name: 'bugfix', code: true, outputDir: 'src/', defaultConstraints: [], description: '缺陷修复（代码任务）' },
};

/**
 * 解析任务类型定义：内置 → 自定义定义文件 → 通用非代码回退
 * 自定义定义文件：.taskchain/TASK_TYPES/{type}.md（YAML frontmatter）
 */
export function resolveTaskType(metaDir: string, typeName: string): TaskTypeDefinition {
  const builtin = BUILTIN_TYPES[typeName];
  if (builtin) return builtin;
  const defFile = join(metaDir, 'TASK_TYPES', `${typeName}.md`);
  if (existsSync(defFile)) {
    try {
      const { data } = parseFrontmatter(readFileSync(defFile, 'utf-8'));
      return {
        name: typeName,
        code: data.code === true || data.code === 'true',
        outputDir: String(data['output-dir'] || data.outputDir || 'outputs/'),
        defaultConstraints: Array.isArray(data.constraints) ? data.constraints.map(String) : [],
        description: String(data.description || ''),
      };
    } catch {
      // 定义文件损坏时回退通用定义
    }
  }
  return { name: typeName, code: false, outputDir: 'outputs/', defaultConstraints: [], description: '' };
}

/** 内置类型清单（供 new 命令展示） */
export function listBuiltinTypes(): string[] {
  return Object.keys(BUILTIN_TYPES);
}

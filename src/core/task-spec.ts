// 任务规格（SPEC.md）：frontmatter 承载机器检查项（三必填），正文承载 AI 阅读项
// 设计原则：轻而有骨——frontmatter 三必填（goal/output/acceptance），正文自由
import { readFileSync, statSync } from 'fs';
import { join, basename } from 'path';

export interface ArtifactRule {
  path: string;    // glob 风格路径（支持 * 通配）
  min?: number;    // 最少命中数（默认 1）
}

export interface AcceptanceSpec {
  artifacts: ArtifactRule[];  // 产物门禁：文件存在且非空（机器可查）
  checks: string[];           // 断言门禁：shell 命令退出码 0（机器可查）
  review: string;             // 评审门禁：AI 按标准审查（软门禁）
}

export interface TaskSpec {
  id: string;             // 任务 ID（目录名）
  dir: string;            // 任务目录绝对路径
  name?: string;          // 显示名（frontmatter name，人类可读；目录名是 ASCII 机器身份）
  type: string;           // 任务类型（默认 general）
  goal: string;           // 目标（三必填之一，一句话也行）
  output: string;         // 产出位置（三必填之一）
  acceptance: AcceptanceSpec; // 验收（三必填之一，规格驱动队列的命根子）
  dependsOn: string[];    // 可选依赖：少数任务声明才拓扑排序
  draft: boolean;         // 规格未澄清/未补全标记
  createdAt?: string;     // 创建日期（created-at；new 落盘，手工建的任务以目录出生时间兜底）
  priority?: string;      // 优先级（P0/P1/P2 或自由值；筛选与展示）
  tags?: string[];        // 标签（自由关键词；跨批次按主题筛选）
  estimate?: number;      // 预估工时（小时；report/status 汇总）
  role?: string;           // 执行角色（内置或 .taskchain/ROLES/{role}.md；type 管形态，role 管专业）
  body: string;           // 正文全文（自由表达，执行时全文注入）
}

/** 三必填校验结果 */
export interface SpecValidation {
  ok: boolean;
  missing: string[]; // 缺失的必填项
}

export function validateRequired(spec: Partial<TaskSpec>): SpecValidation {
  const missing: string[] = [];
  if (!spec.goal || !spec.goal.trim()) missing.push('goal（目标）');
  if (!spec.output || !spec.output.trim()) missing.push('output（产出）');
  const acc = spec.acceptance;
  const accEmpty = !acc || (!acc.artifacts?.length && !acc.checks?.length && !acc.review?.trim());
  if (accEmpty) missing.push('acceptance（验收）');
  return { ok: missing.length === 0, missing };
}

/**
 * 极简 YAML 解析器（顶层 key: value + 两层缩进嵌套 + - 列表）
 * SPEC.md 的 frontmatter 与批次配置 BATCH.yaml 共用同一套语法，不追求完整 YAML 规范
 * 兼容 CRLF（正则的 . 不匹配 \r，顶层键值行会整行丢失——先归一化再解析）
 */
export function parseSimpleYaml(text: string): Record<string, any> {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const data: Record<string, any> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      const key = top[1];
      const inline = top[2].trim();
      const peek = lines[i + 1];
      // 子结构：acceptance / depends-on 等
      if (!inline && peek && peek.match(/^  (\S)/)) {
        const nested = parseNested(lines, i + 1, key);
        // 纯列表键（如 depends-on 直接跟列表）解包一层：{ 'depends-on': [...] } → [...]
        data[key] = nested && typeof nested === 'object' && Array.isArray(nested[key]) ? nested[key] : nested;
        i++; // 先跳过当前 key 行（否则 continue 后 i 未递增 → 死循环）
        while (i < lines.length) {
          const cur = lines[i];
          if (!cur.trim()) { i++; continue; }
          const indent = cur.match(/^ */)![0].length;
          if (indent > 0) { i++; continue; }
          break; // 回到顶层行，交给外层处理
        }
        continue;
      }
      if (inline.startsWith('[')) {
        data[key] = inline.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        data[key] = unquote(inline);
      }
    }
    i++;
  }
  return data;
}

/**
 * 解析 SPEC.md 的 frontmatter（--- 包裹的 YAML 块）
 * Windows 编辑器兼容：BOM 头会让整个 frontmatter 匹配失败——先剥掉再解析
 */
export function parseFrontmatter(content: string): { data: Record<string, any>; body: string } {
  const normalized = content.replace(/^\uFEFF/, '');
  const m = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: content };
  return { data: parseSimpleYaml(m[1]), body: m[2] };
}

/** 剥离外层引号（YAML 标量 "..." / '...'），普通文本原样返回 */
function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * 解析嵌套块（状态机）：
 * - section 层（相对缩进 0）：key: value，切换 lastSection
 * - 列表项层（缩进更深，- 开头）：归属最近 section key
 * - 子键层（更深，非 -）：归属最近列表项
 * initialSection：当列表直接跟在 key 行后（如 depends-on 的直接列表）时的归属
 */
function parseNested(lines: string[], start: number, initialSection?: string): any {
  const result: Record<string, any> = {};
  let sectionIndent = -1;
  let lastSection: string | null = initialSection || null;
  let lastItem: Record<string, string> | null = null;
  let i = start;
  while (i < lines.length) {
    const cur = lines[i];
    if (!cur.trim()) { i++; continue; }
    const indent = cur.match(/^ */)![0].length;
    if (sectionIndent === -1) sectionIndent = indent;
    if (indent < sectionIndent) break; // 回到外层
    const trimmed = cur.trim();
    // 列表项优先于 section 判断（depends-on 直接列表场景首行就是 - 开头）
    const listItem = trimmed.match(/^-\s*(.*)$/);
    if (listItem) {
      if (lastSection === null) { i++; continue; }
      const arr = Array.isArray(result[lastSection]) ? result[lastSection] : (result[lastSection] = []);
      const kv = listItem[1].match(/^(\w+):\s*(.*)$/);
      if (kv) {
        lastItem = { [kv[1]]: unquote(kv[2]) };
        arr.push(lastItem);
      } else {
        lastItem = null;
        arr.push(unquote(listItem[1]));
      }
      i++;
      continue;
    }
    if (indent === sectionIndent) {
      // section 层：key: value
      const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) {
        lastSection = kv[1];
        result[lastSection] = unquote(kv[2]);
        lastItem = null;
      }
      i++;
      continue;
    }
    // 列表项子键
    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && lastItem) {
      lastItem[kv[1]] = unquote(kv[2]);
      i++;
      continue;
    }
    i++;
  }
  return result;
}

/** 从 frontmatter 数据组装 TaskSpec */
export function buildSpec(id: string, dir: string, data: Record<string, any>, body: string, defaultType: string): TaskSpec {
  const acceptance = data.acceptance || {};
  const artifacts: ArtifactRule[] = Array.isArray(acceptance.artifacts)
    ? acceptance.artifacts.map((a: any) => (typeof a === 'string' ? { path: a } : { path: a.path, min: a.min ? Number(a.min) : undefined }))
    : (data.artifact ? [{ path: String(data.artifact), min: data['artifact-min'] ? Number(data['artifact-min']) : undefined }] : []);
  const checks: string[] = Array.isArray(acceptance.checks)
    ? acceptance.checks.map(String)
    : (data.check ? [String(data.check)] : []);
  return {
    id,
    dir,
    name: data.name ? String(data.name) : undefined,
    type: String(data.type || defaultType || 'general'),
    goal: String(data.goal || ''),
    output: String(data.output || ''),
    acceptance: { artifacts, checks, review: String(acceptance.review || data.review || '') },
    dependsOn: Array.isArray(data['depends-on']) ? data['depends-on'].map(String) : [],
    draft: data.draft === true || data.draft === 'true',
    createdAt: data['created-at'] ? String(data['created-at']) : data.createdAt ? String(data.createdAt) : undefined,
    priority: data.priority ? String(data.priority) : undefined,
    tags: Array.isArray(data.tags)
      ? data.tags.map(String)
      : data.tags
        ? String(data.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        : undefined,
    estimate: data.estimate !== undefined && data.estimate !== '' && !isNaN(Number(data.estimate)) ? Number(data.estimate) : undefined,
    role: data.role ? String(data.role) : undefined,
    body,
  };
}

/** 读并解析任务 SPEC.md（不存在返回 null） */
export function readSpec(dir: string, defaultType = 'general'): TaskSpec | null {
  const specPath = join(dir, 'SPEC.md');
  try {
    const content = readFileSync(specPath, 'utf-8');
    const { data, body } = parseFrontmatter(content);
    const id = basename(dir) || dir;
    const spec = buildSpec(id, dir, data, body, defaultType);
    // 手工搭棚子的任务没写 created-at → 目录出生时间兜底（git checkout/mv 不动 birthtime）
    if (!spec.createdAt) {
      try {
        const st = statSync(dir);
        spec.createdAt = new Date(st.birthtimeMs || st.mtimeMs).toISOString().slice(0, 10);
      } catch {
        // 读不到就留空，不影响队列运行
      }
    }
    return spec;
  } catch {
    return null;
  }
}

/** frontmatter 标量折叠：多行值折成一行（多行细节属于正文，frontmatter 只承载机器检查项） */
function foldScalar(s: string): string {
  return s.replace(/\s*\n+\s*/g, ' ').trim();
}

/** 生成 SPEC.md 文件内容（frontmatter + 正文） */
export function renderSpec(spec: {
  type?: string; goal: string; output: string; acceptance: AcceptanceSpec; dependsOn?: string[]; draft?: boolean; body?: string; name?: string;
  createdAt?: string; priority?: string; tags?: string[]; estimate?: number; role?: string;
}): string {
  const lines: string[] = ['---'];
  lines.push(`type: ${spec.type || 'general'}`);
  if (spec.name && spec.name.trim()) lines.push(`name: ${foldScalar(spec.name)}`);
  lines.push(`goal: ${foldScalar(spec.goal)}`);
  lines.push(`output: ${foldScalar(spec.output)}`);
  if (spec.createdAt) lines.push(`created-at: ${spec.createdAt}`);
  if (spec.priority) lines.push(`priority: ${spec.priority}`);
  if (spec.tags && spec.tags.length) {
    lines.push('tags:');
    spec.tags.forEach((t) => lines.push(`  - ${t}`));
  }
  if (spec.estimate !== undefined) lines.push(`estimate: ${spec.estimate}`);
  if (spec.role) lines.push(`role: ${spec.role}`);
  if (spec.dependsOn && spec.dependsOn.length) {
    lines.push('depends-on:');
    spec.dependsOn.forEach((d) => lines.push(`  - ${d}`));
  }
  if (spec.draft) lines.push('draft: true');
  lines.push('acceptance:');
  if (spec.acceptance.artifacts.length) {
    lines.push('  artifacts:');
    spec.acceptance.artifacts.forEach((a) => {
      lines.push(`    - path: ${a.path}`);
      if (a.min) lines.push(`      min: ${a.min}`);
    });
  }
  if (spec.acceptance.checks.length) {
    lines.push('  checks:');
    spec.acceptance.checks.forEach((c) => lines.push(`    - ${c}`));
  }
  lines.push(`  review: ${foldScalar(spec.acceptance.review || '')}`);
  lines.push('---');
  lines.push('');
  lines.push(spec.body || '');
  return lines.join('\n') + '\n';
}

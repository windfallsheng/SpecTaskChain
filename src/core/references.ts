// 引用消解：SPEC 中的引用由 CLI 读取真实内容嵌入 prompt——让 AI 读到的都是真的，读不到的显式报警
// 三档：本地文件（读全文嵌入）/ 图片（确认存在 + 给绝对路径，宿主 AI 视觉读取）/ 外部链接（CLI 抓取）
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { isAbsolute, resolve } from 'path';

export interface Reference {
  kind: 'file' | 'image' | 'url';
  raw: string;    // 引用原文（链接文本或裸路径）
  target: string; // 目标（相对路径 / 绝对路径 / URL）
}

export interface ResolvedReference extends Reference {
  status: 'ok' | 'missing' | 'fetch-failed';
  content?: string; // 文件全文（≤16KB）/ 抓取内容（≤4000 字符）
  absPath?: string; // 本地目标的绝对路径（图片给宿主 AI 视觉读取；缺失时告知查找位置）
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'docx', 'doc'];

const isUrl = (t: string): boolean => /^https?:\/\//i.test(t);
const extOf = (t: string): string => (t.split('.').pop() || '').toLowerCase();

/** 提取引用：Markdown 链接/图片 + 裸路径（常见扩展名），按 target 去重 */
export function extractReferences(text: string): Reference[] {
  const refs: Reference[] = [];
  const seen = new Set<string>();
  const add = (kind: Reference['kind'], raw: string, target: string) => {
    if (seen.has(target)) return;
    seen.add(target);
    refs.push({ kind, raw, target });
  };
  // 图片 ![alt](target)
  const imgRe = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(text))) add('image', m[1], m[2]);
  // 链接 [text](target)：http(s) 归外部链接，其余归本地文件
  const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  while ((m = linkRe.exec(text))) add(isUrl(m[2]) ? 'url' : 'file', m[1], m[2]);
  // 裸 URL（直接写出的外部链接，不带扩展名，不被上面的正则捕获）
  const bareUrlRe = /https?:\/\/[^\s\)\]，。"'<>]+/g;
  while ((m = bareUrlRe.exec(text))) {
    if (seen.has(m[0])) continue;
    add('url', m[0], m[0]);
  }
  // 裸路径（未被链接捕获的文档/图片路径；负向后行排除冒号与斜杠，避免把 URL 片段误判为文件）
  const bareRe = /(?<![\w"'`:\/])([A-Za-z0-9._/-]+\.(?:md|txt|json|ya?ml|ts|js|py|csv|xml|png|jpe?g|gif|svg|webp|pdf|docx?))/g;
  while ((m = bareRe.exec(text))) {
    if (seen.has(m[1])) continue;
    add(IMAGE_EXTS.includes(extOf(m[1])) ? 'image' : 'file', m[1], m[1]);
  }
  return refs;
}

/** 外部链接抓取：curl 同步拉取（10s 超时），失败显式标注，不装看不见 */
function fetchUrl(url: string): { status: 'ok' | 'fetch-failed'; content?: string } {
  if (!isUrl(url)) return { status: 'fetch-failed' };
  try {
    const out = execSync(`curl -sL --max-time 10 "${url}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
    if (!out.trim()) return { status: 'fetch-failed' };
    const MAX = 4000;
    return {
      status: 'ok',
      content: out.length > MAX ? out.slice(0, MAX) + `\n…（截断，原文共 ${out.length} 字符）` : out,
    };
  } catch {
    return { status: 'fetch-failed' };
  }
}

/**
 * 消解引用：baseDir 为基准目录（任务目录），相对路径相对它展开
 * 本地文本文件读全文（≤16KB，超长截断标注）；图片确认存在并给绝对路径；URL 抓取
 */
export function resolveReferences(text: string, baseDir: string): ResolvedReference[] {
  const refs = extractReferences(text);
  return refs.map((ref) => {
    if (ref.kind === 'url') {
      return { ...ref, ...fetchUrl(ref.target) };
    }
    const abs = isAbsolute(ref.target) ? ref.target : resolve(baseDir, ref.target);
    if (!existsSync(abs)) return { ...ref, status: 'missing' as const, absPath: abs };
    if (ref.kind === 'image') return { ...ref, status: 'ok' as const, absPath: abs };
    // 文本文件：读全文嵌入（上下文轻，给得起全文；超长截断保底）
    const raw = readFileSync(abs, 'utf-8');
    const MAX = 16384;
    return {
      ...ref,
      status: 'ok' as const,
      absPath: abs,
      content: raw.length > MAX ? raw.slice(0, MAX) + `\n…（截断，原文共 ${raw.length} 字符）` : raw,
    };
  });
}

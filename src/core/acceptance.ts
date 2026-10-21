// 验收三态门禁：规格驱动队列与所有 AI 队列的分水岭
// 产物门禁（文件存在且非空）+ 断言门禁（shell 退出码）+ 评审门禁（AI 审查，软门禁）
import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, resolve, sep } from 'path';
import { AcceptanceSpec } from './task-spec';

export interface AcceptanceResult {
  passed: boolean;
  artifacts: { rule: string; matched: number; ok: boolean }[];
  checks: { cmd: string; exitCode: number; ok: boolean; output?: string }[];
  reviewVerdict?: string; // 宿主 AI 传入的评审结论
}

/** glob 匹配：支持 * 通配（* 不跨目录，但可出现在任意路径段），相对产出目录展开 */
function globMatch(pattern: string, cwd: string): string[] {
  const abs = resolve(cwd, pattern);
  // 无通配：直接检查存在且非空
  if (!pattern.includes('*')) {
    try {
      return existsSync(abs) && statSync(abs).size > 0 && !abs.endsWith('~') ? [abs] : [];
    } catch {
      return [];
    }
  }
  // 规范化为 / 分隔后逐段编译（每段内 * 不跨目录）
  const norm = abs.split(sep).join('/');
  const segs = norm.split('/').filter(Boolean);
  const segRegex = segs.map(
    (s) => '^' + s.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'
  );
  // 静态前缀起点：第一个含 * 的段之前（Windows 盘符单独处理）
  let base = norm.startsWith('/') ? '/' : '';
  let depth = segs.length;
  for (const s of segs) {
    if (s.includes('*')) break;
    if (/^[A-Za-z]:$/.test(s)) {
      base = s + '/';
      depth--;
      continue;
    }
    base = base === '/' ? '/' + s : base + '/' + s;
    depth--;
  }
  const results: string[] = [];
  const walk = (d: string, remaining: number): void => {
    if (remaining <= 0 || !existsSync(d)) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, remaining - 1);
          continue;
        }
        if (st.size <= 0) continue;
      } catch {
        continue;
      }
      const parts = full.split(sep).join('/').split('/').filter(Boolean);
      if (parts.length === segRegex.length && segRegex.every((re, i) => new RegExp(re).test(parts[i]))) {
        results.push(full);
      }
    }
  };
  walk(base, depth);
  return results.filter((f) => !f.endsWith('~'));
}

/** 产物门禁：文件存在且非空 */
function checkArtifacts(acceptance: AcceptanceSpec, taskDir: string): AcceptanceResult['artifacts'] {
  return acceptance.artifacts.map((rule) => {
    const base = rule.path.startsWith('/') ? '/' : taskDir;
    const matched = globMatch(rule.path, base);
    const min = rule.min || 1;
    return { rule: rule.path, matched: matched.length, ok: matched.length >= min };
  });
}

/** 断言门禁：shell 命令退出码 0（工作目录 = 任务目录） */
function checkAssertions(acceptance: AcceptanceSpec, taskDir: string): AcceptanceResult['checks'] {
  return acceptance.checks.map((cmd) => {
    try {
      execSync(cmd, { cwd: taskDir, timeout: 30000, stdio: 'pipe' });
      return { cmd, exitCode: 0, ok: true };
    } catch (e: any) {
      return { cmd, exitCode: e.status ?? 1, ok: false, output: String(e.stderr || e.stdout || '').slice(0, 200) };
    }
  });
}

/**
 * 评审结论判定：先判负向（fail/不通过…绝不误放），再判正向（pass/通过/符合）
 * 无结论视为软门禁放行（review 为空时评审门禁本就不启用）
 */
export function verdictPassed(reviewVerdict?: string): boolean {
  const v = (reviewVerdict || '').trim();
  if (!v) return true;
  if (/fail|impassable|不通过|未通过|不符合|[✗❌]/.test(v)) return false;
  return /pass|通过|符合|[✓✅]/.test(v);
}

/**
 * 执行验收门禁：产物 + 断言两级机器可查
 * reviewVerdict 由宿主 AI 传入（评审门禁），'pass' 或具体结论
 */
export function runAcceptance(
  acceptance: AcceptanceSpec,
  taskDir: string,
  reviewVerdict?: string
): AcceptanceResult {
  const artifacts = checkArtifacts(acceptance, taskDir);
  const checks = checkAssertions(acceptance, taskDir);
  const machinePassed = artifacts.every((a) => a.ok) && checks.every((c) => c.ok);
  // 评审门禁：review 为空视为不启用；有 review 则按 verdict 判定（先负向后正向，负向绝不误放）
  const reviewPassed = !acceptance.review.trim() || verdictPassed(reviewVerdict);
  return { passed: machinePassed && reviewPassed, artifacts, checks, reviewVerdict };
}

/** 渲染验收结果（done 命令输出） */
export function renderAcceptanceResult(r: AcceptanceResult): string {
  const lines: string[] = [];
  for (const a of r.artifacts) {
    lines.push(`${a.ok ? '✅' : '❌'} 产物门禁 [${a.rule}] 命中 ${a.matched} 个`);
  }
  for (const c of r.checks) {
    lines.push(`${c.ok ? '✅' : '❌'} 断言门禁 [${c.cmd}] exit=${c.exitCode}${c.output ? ` → ${c.output}` : ''}`);
  }
  if (r.reviewVerdict) {
    lines.push(`🧠 评审门禁：${r.reviewVerdict}`);
  }
  lines.push(r.passed ? '✅ 验收通过' : '❌ 验收未通过');
  return lines.join('\n');
}

// 验收三态门禁：规格驱动队列与所有 AI 队列的分水岭
// 产物门禁（文件存在且非空）+ 断言门禁（shell 退出码）+ 评审门禁（AI 审查，软门禁）
import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { AcceptanceSpec } from './task-spec';

export interface AcceptanceResult {
  passed: boolean;
  artifacts: { rule: string; matched: number; ok: boolean }[];
  checks: { cmd: string; exitCode: number; ok: boolean; output?: string }[];
  reviewVerdict?: string; // 宿主 AI 传入的评审结论
}

/** glob 简单匹配：支持 * 通配（* 不跨目录），相对产出目录展开 */
function globMatch(pattern: string, cwd: string): string[] {
  const absPattern = resolve(cwd, pattern);
  const dir = dirname(absPattern);
  const filePart = absPattern.slice(dir.length + 1);
  if (!existsSync(dir)) return [];
  const regex = new RegExp('^' + filePart.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  const walk = (d: string): string[] => {
    if (!existsSync(d)) return [];
    return readdirSync(d).flatMap((name) => {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) return filePart.includes('/') ? walk(full) : [];
      return regex.test(name) && st.size > 0 ? [full] : [];
    });
  };
  return walk(dir).filter((f) => !f.endsWith('~'));
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
  // 评审门禁：review 为空视为不启用；有 review 则需 verdict 为 pass 或含「通过」
  const reviewPassed = !acceptance.review.trim() || !reviewVerdict || /pass|通过/.test(reviewVerdict);
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

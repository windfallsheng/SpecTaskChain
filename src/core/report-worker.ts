// 报告生成 worker：detached 后台进程入口——读主进程留下的临时 JSON，渲染写盘，收工即退
// 由 assessment.ts 的 dispatchAssessment spawn（node dist/core/report-worker.js 或 tsx src/core/report-worker.ts）
// 失败静默原则：写 {json}.log 供排查，绝不回写主进程（主进程早已 unref 离去）
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { AssessmentReport, writeAssessmentFiles } from './assessment';

async function main(): Promise<void> {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    process.exit(1);
  }
  const logPath = `${jsonPath}.log`;
  try {
    const raw = readFileSync(jsonPath, 'utf-8');
    const payload = JSON.parse(raw) as { queueDir: string; report: AssessmentReport };
    writeAssessmentFiles(payload.queueDir, payload.report);
    // 数据已消费，临时 JSON 删除（幂等：不删也不影响，下次报告用新时间戳文件名）
    try {
      unlinkSync(jsonPath);
    } catch {
      // 删除失败无妨
    }
    process.exit(0);
  } catch (e) {
    // 静默失败但留痕：报告是辅助物，主流程已跑完；此处只记录现场供排查
    try {
      writeFileSync(logPath, `report-worker 生成失败：${e instanceof Error ? e.stack || e.message : String(e)}\n`, 'utf-8');
    } catch {
      // log 都写不了就算了
    }
    process.exit(1);
  }
}

void main();

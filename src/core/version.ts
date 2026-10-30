// 版本号唯一事实源：package.json（运行时读取，杜绝 cli/index 多处硬编码漂移）
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 读包版本：core/ 子目录下 __dirname 上溯两层即项目根。
 * 源码运行（src/core/）、编译运行（dist/core/）、全局安装（node_modules/spec-taskchain/dist/core/）三种形态下均成立。
 */
export function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

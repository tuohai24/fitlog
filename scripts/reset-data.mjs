// 清空训练与计划数据（保留动作库），用于交付前还原成干净状态
// 用法: node scripts/reset-data.mjs --yes
import { db } from '../server/db.js';

if (!process.argv.includes('--yes')) {
  console.log('这会删除所有训练记录、计划与设置（动作库保留）。确认请加 --yes');
  process.exit(0);
}

db.transaction(() => {
  db.prepare('DELETE FROM sets').run();
  db.prepare('DELETE FROM workout_exercises').run();
  db.prepare('DELETE FROM workouts').run();
  db.prepare('DELETE FROM plans').run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'deepseek_%'").run();
  // 账号与会话保留；想连账号一起清空，加 --users
  if (process.argv.includes('--users')) {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM users').run();
  }
})();
db.exec('VACUUM');
console.log('[reset] 已清空训练记录 / 计划 / DeepSeek 配置');

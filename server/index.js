import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, nowISO } from './db.js';
import { requireAuth } from './auth.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import exercisesRouter from './routes/exercises.js';
import workoutsRouter from './routes/workouts.js';
import statsRouter from './routes/stats.js';
import plansRouter from './routes/plans.js';
import settingsRouter from './routes/settings.js';
import exportRouter from './routes/export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(compression());
app.use(express.json({ limit: '4mb' }));

/* ---------------- 鉴权 ---------------- */
if (!process.env.APP_PASSWORD && !process.env.ADMIN_PASSWORD) {
  console.warn('[auth] 未设置 ADMIN_PASSWORD / APP_PASSWORD，初始管理员使用默认密码 fitlog（请尽快在「我的」中修改）');
}

app.get('/api/health', (req, res) => res.json({ ok: true, time: nowISO() }));
app.use('/api/auth', authRouter);

/* ---------------- 业务接口（全部需要登录，且按用户隔离） ---------------- */
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/exercises', requireAuth, exercisesRouter);
app.use('/api/workouts', requireAuth, workoutsRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/plans', requireAuth, plansRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/export', requireAuth, exportRouter);

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

/* ---------------- 静态资源 ---------------- */
app.use('/media', express.static(path.join(PUBLIC_DIR, 'media'), {
  maxAge: '365d', immutable: true, fallthrough: true,
}));
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', extensions: ['html'] }));
// SPA 兜底（Express 5 通配符写法不同，统一用中间件处理）
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(404).send('前端未就绪');
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const keys = db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'deepseek_api_key'").get().n;
  console.log(`FitLog 已启动 → http://localhost:${PORT}（${users} 个账号，${keys} 个已配置 DeepSeek）`);
});

// 清理过期会话
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowISO());
}, 12 * 3600 * 1000).unref();

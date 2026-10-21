import { Router } from 'express';
import { getSetting, setSetting, db, publicUser } from '../db.js';
import { chat, deepseekConfig } from '../deepseek.js';

const router = Router();

const mask = (key) => (key ? `${key.slice(0, 6)}••••••${key.slice(-4)}` : '');

router.get('/', (req, res) => {
  const userId = req.user.id;
  const { key, model, baseUrl } = deepseekConfig(userId);
  res.json({
    user: publicUser(req.user),
    deepseekConfigured: !!key,
    deepseekKeyMasked: mask(key),
    deepseekFromEnv: !!process.env.DEEPSEEK_API_KEY && !getSetting(userId, 'deepseek_api_key'),
    model,
    baseUrl,
    exerciseCount: db.prepare('SELECT COUNT(*) AS n FROM exercises').get().n,
    workoutCount: db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?').get(userId).n,
    planCount: db.prepare('SELECT COUNT(*) AS n FROM plans WHERE user_id = ?').get(userId).n,
  });
});

router.put('/', (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  if (typeof b.deepseekApiKey === 'string') setSetting(userId, 'deepseek_api_key', b.deepseekApiKey.trim());
  if (typeof b.model === 'string' && b.model.trim()) setSetting(userId, 'deepseek_model', b.model.trim());
  if (typeof b.baseUrl === 'string' && b.baseUrl.trim()) setSetting(userId, 'deepseek_base_url', b.baseUrl.trim());
  if (b.clearKey) setSetting(userId, 'deepseek_api_key', null);

  const { key, model, baseUrl } = deepseekConfig(userId);
  res.json({ ok: true, deepseekConfigured: !!key, deepseekKeyMasked: mask(key), model, baseUrl });
});

/* 连通性测试 */
router.post('/test-deepseek', async (req, res, next) => {
  try {
    const content = await chat({
      userId: req.user.id,
      messages: [
        { role: 'system', content: '你只需输出 JSON。' },
        { role: 'user', content: '返回 {"ok":true,"msg":"连接成功"} 这个 JSON。' },
      ],
      maxTokens: 100,
      temperature: 0,
    });
    res.json({ ok: true, reply: content });
  } catch (e) {
    next(e);
  }
});

export default router;

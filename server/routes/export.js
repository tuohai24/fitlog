import { Router } from 'express';
import { db } from '../db.js';
import {
  FORMATS, loadExportData, toJSON, toCSV, toMarkdown, toXlsx, toPDF,
} from '../report.js';

const router = Router();

/* 可选格式与数据区间（给前端渲染导出面板） */
router.get('/formats', (req, res) => {
  const meta = db.prepare(`
    SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS count
    FROM workouts WHERE user_id = ?
  `).get(req.user.id);
  const planCount = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE user_id = ?').get(req.user.id).n;
  res.json({ formats: FORMATS, range: meta, planCount });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* 导出：/api/export?format=json|xlsx|pdf|md|csv&from=&to=&scope=all|workouts */
router.get('/', async (req, res, next) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const spec = FORMATS.find(f => f.key === format);
    if (!spec) return res.status(400).json({ error: `不支持的导出格式：${format}` });

    const from = DATE_RE.test(String(req.query.from || '')) ? String(req.query.from) : null;
    const to = DATE_RE.test(String(req.query.to || '')) ? String(req.query.to) : null;
    if (from && to && from > to) return res.status(400).json({ error: '开始日期不能晚于结束日期' });
    const scope = req.query.scope === 'workouts' ? 'workouts' : 'all';

    const data = loadExportData(req.user, { from, to, scope });
    const stamp = new Date().toISOString().slice(0, 10);
    const span = from || to ? `-${from || 'start'}_${to || stamp}` : '';
    const filename = `fitlog-${req.user.username}${span}.${spec.ext}`;

    let payload;
    if (format === 'json') payload = Buffer.from(toJSON(data), 'utf8');
    else if (format === 'csv') payload = Buffer.from(toCSV(data), 'utf8');
    else if (format === 'md') payload = Buffer.from(toMarkdown(data), 'utf8');
    else if (format === 'xlsx') payload = toXlsx(data);
    else payload = await toPDF(data);

    res.setHeader('Content-Type', spec.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(payload);
  } catch (e) {
    next(e);
  }
});

export default router;

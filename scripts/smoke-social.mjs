/**
 * 训练动态 / 留言 接口冒烟测试
 * 用法：node scripts/smoke-social.mjs
 * 依赖：服务已在 http://localhost:8080 运行（可用 BASE 环境变量覆盖），
 *      管理员账号与密码默认 admin / fitlog（ADMIN_USERNAME / ADMIN_PASSWORD 覆盖）
 *
 * 会自动创建临时账号 fitlog_test_<时间戳>，跑完后删除，并把测试训练恢复为未分享。
 */
const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'fitlog';
const TEST_USER = `smoke_${Date.now().toString(36)}`;

let pass = 0;
let fail = 0;
const results = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  return { status: res.status, data };
}

const ok = (r) => r.status >= 200 && r.status < 300;

async function main() {
  // 1. 管理员登录
  const login = await call('/auth/login', { method: 'POST', body: { username: ADMIN, password: ADMIN_PW } });
  if (!ok(login)) throw new Error(`管理员登录失败：${login.status} ${JSON.stringify(login.data)}`);
  const adminTok = login.data.token;
  results.push(`管理员 ${ADMIN} 登录成功`);

  // 2. 找一条带动作的训练
  const list = await call('/workouts?limit=20', { token: adminTok });
  const workout = (list.data || []).find(w => w.doneSets > 0) || (list.data || [])[0];
  if (!workout) throw new Error('当前账号没有训练记录，请先执行 npm run seed:demo');
  const wid = workout.id;
  results.push(`使用训练 #${wid}（${workout.date}，${workout.doneSets} 组）`);

  // 3. 创建临时账号
  const created = await call('/users', {
    method: 'POST',
    token: adminTok,
    body: { username: TEST_USER, password: 'smoke-pass-123', displayName: '冒烟测试' },
  });
  check('管理员创建临时账号', ok(created), JSON.stringify(created.data));
  const otherTok = (await call('/auth/login', { method: 'POST', body: { username: TEST_USER, password: 'smoke-pass-123' } })).data?.token;
  check('临时账号登录', !!otherTok);

  // 4. 未分享时：对方看不到
  await call(`/workouts/${wid}/share`, { method: 'PATCH', token: adminTok, body: { shared: false } });
  const hiddenFeed = await call('/feed?limit=50', { token: otherTok });
  check('未分享的训练不出现在动态里', ok(hiddenFeed) && !hiddenFeed.data.some(x => x.id === wid));
  const hiddenDetail = await call(`/feed/${wid}`, { token: otherTok });
  check('未分享的训练动态详情 404', hiddenDetail.status === 404, `实际 ${hiddenDetail.status}`);

  // 5. 分享后可见
  const shared = await call(`/workouts/${wid}/share`, { method: 'PATCH', token: adminTok, body: { shared: true } });
  check('分享训练', ok(shared) && shared.data?.shared === true);
  const feed = await call('/feed?limit=50', { token: otherTok });
  const item = (feed.data || []).find(x => x.id === wid);
  check('对方能在动态里看到', ok(feed) && !!item);
  check('动态含作者信息', !!item?.author?.displayName && item.author.isMe === false);
  check('动态含训练统计', item?.stats?.volume > 0 && item?.stats?.exerciseCount > 0);
  check('动态含动作摘要', Array.isArray(item?.exercises) && item.exercises.length > 0);

  // 6. 数据隔离仍然生效：别人的训练详情依旧 404
  const raw = await call(`/workouts/${wid}`, { token: otherTok });
  check('对方的 /api/workouts/:id 仍然 404（数据隔离）', raw.status === 404, `实际 ${raw.status}`);
  const steal = await call(`/workouts/${wid}/share`, { method: 'PATCH', token: otherTok, body: { shared: false } });
  check('对方不能改别人的分享状态', steal.status === 404, `实际 ${steal.status}`);

  // 7. 详情
  const detail = await call(`/feed/${wid}`, { token: otherTok });
  check('动态详情可读', ok(detail) && detail.data.id === wid);
  check('详情含完整动作与组', detail.data?.exercises?.length > 0 && Array.isArray(detail.data.exercises[0].sets));
  check('作者本人标记正确', detail.data?.author?.isMe === false);

  // 8. 留言
  const empty = await call(`/feed/${wid}/comments`, { method: 'POST', token: otherTok, body: { content: '   ' } });
  check('空留言被拒绝', empty.status === 400, `实际 ${empty.status}`);
  const tooLong = await call(`/feed/${wid}/comments`, { method: 'POST', token: otherTok, body: { content: 'x'.repeat(501) } });
  check('超长留言被拒绝', tooLong.status === 400, `实际 ${tooLong.status}`);

  const c1 = await call(`/feed/${wid}/comments`, { method: 'POST', token: otherTok, body: { content: '这组量太猛了，学习了！' } });
  check('发表留言', ok(c1) && c1.data?.content?.includes('学习了'));
  const c2 = await call(`/feed/${wid}/comments`, { method: 'POST', token: adminTok, body: { content: '下次一起练' } });
  check('作者本人也能留言', ok(c2));

  const after = await call(`/feed/${wid}`, { token: adminTok });
  check('详情里能看到两条留言', (after.data?.comments || []).length === 2);
  check('留言带作者信息', after.data?.comments?.every(c => !!c.author?.initial));

  const listAfter = await call('/feed?limit=50', { token: adminTok });
  const itemAfter = (listAfter.data || []).find(x => x.id === wid);
  check('列表里留言数正确', itemAfter?.commentCount === 2, `实际 ${itemAfter?.commentCount}`);
  check('列表里带最新留言预览', Array.isArray(itemAfter?.lastComments) && itemAfter.lastComments.length === 2);

  // 9. 删除权限
  const delOthers = await call(`/feed/comments/${c2.data.id}`, { method: 'DELETE', token: otherTok });
  check('不能删别人的留言', delOthers.status === 403, `实际 ${delOthers.status}`);
  const delOwn = await call(`/feed/comments/${c1.data.id}`, { method: 'DELETE', token: otherTok });
  check('可以删自己的留言', ok(delOwn));
  const delAdmin = await call(`/feed/comments/${c2.data.id}`, { method: 'DELETE', token: adminTok });
  check('管理员可删任何留言', ok(delAdmin));

  // 10. 取消分享后重新隐藏
  await call(`/workouts/${wid}/share`, { method: 'PATCH', token: adminTok, body: { shared: false } });
  const gone = await call(`/feed/${wid}`, { token: otherTok });
  check('取消分享后动态详情 404', gone.status === 404, `实际 ${gone.status}`);

  // 11. 结束训练接口
  const fin = await call(`/workouts/${wid}/finish`, { method: 'POST', token: adminTok, body: { share: true } });
  check('完成训练并分享', ok(fin) && fin.data?.shared === true && !!fin.data?.finishedAt);
  const finFeed = await call('/feed?limit=50', { token: otherTok });
  check('完成训练后进入动态', (finFeed.data || []).some(x => x.id === wid));

  // 12. 我分享的筛选
  const mine = await call('/feed?scope=mine&limit=50', { token: adminTok });
  check('scope=mine 只返回自己的', ok(mine) && mine.data.every(x => x.isMine));
  const mineOther = await call('/feed?scope=mine&limit=50', { token: otherTok });
  check('对方 scope=mine 看不到别人的', ok(mineOther) && mineOther.data.length === 0);

  // 清理
  await call(`/workouts/${wid}/share`, { method: 'PATCH', token: adminTok, body: { shared: false } });
  const delUser = await call(`/users/${created.data.id}`, { method: 'DELETE', token: adminTok });
  check('清理临时账号', ok(delUser));

  console.log(results.join('\n'));
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error('冒烟测试中断：', e.message);
  process.exitCode = 1;
});

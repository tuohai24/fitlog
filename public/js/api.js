/* 后端接口封装 */
let unauthorizedHandler = null;
export function onUnauthorized(fn) { unauthorizedHandler = fn; }

async function request(path, { method = 'GET', body, timeout = 180000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 401 && unauthorizedHandler && path !== '/auth/login') {
      unauthorizedHandler();
      throw new Error('请先登录');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请稍后重试');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // 鉴权
  me: () => request('/auth/me'),
  authStatus: () => request('/auth/status'),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (oldPassword, newPassword) =>
    request('/auth/password', { method: 'POST', body: { oldPassword, newPassword } }),
  updateProfile: (displayName) => request('/auth/profile', { method: 'PATCH', body: { displayName } }),

  // 用户管理（管理员）
  users: () => request('/users'),
  createUser: (payload) => request('/users', { method: 'POST', body: payload }),
  resetUserPassword: (id, password) => request(`/users/${id}/password`, { method: 'POST', body: { password } }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  // 导出
  exportFormats: () => request('/export/formats'),

  // 动作库
  exercises: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return request(`/exercises?${qs}`);
  },
  exerciseMeta: () => request('/exercises/meta'),
  exercise: (id) => request(`/exercises/${id}`),
  exerciseHistory: (id, limit = 8) => request(`/exercises/${id}/history?limit=${limit}`),

  // 训练
  workouts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return request(`/workouts?${qs}`);
  },
  workoutToday: (date) => request(`/workouts/today${date ? `?date=${date}` : ''}`),
  workout: (id) => request(`/workouts/${id}`),
  createWorkout: (payload) => request('/workouts', { method: 'POST', body: payload }),
  updateWorkout: (id, payload) => request(`/workouts/${id}`, { method: 'PUT', body: payload }),
  deleteWorkout: (id) => request(`/workouts/${id}`, { method: 'DELETE' }),
  workoutFromPlan: (planId, dayIndex, date) => request('/workouts/from-plan', { method: 'POST', body: { planId, dayIndex, date } }),
  finishWorkout: (id, share) => request(`/workouts/${id}/finish`, { method: 'POST', body: { share } }),
  shareWorkout: (id, shared) => request(`/workouts/${id}/share`, { method: 'PATCH', body: { shared } }),

  // 训练动态与留言
  feed: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return request(`/feed?${qs}`);
  },
  feedPost: (id) => request(`/feed/${id}`),
  addComment: (id, content) => request(`/feed/${id}/comments`, { method: 'POST', body: { content } }),
  deleteComment: (commentId) => request(`/feed/comments/${commentId}`, { method: 'DELETE' }),

  // 统计
  overview: (days = 30) => request(`/stats/overview?days=${days}`),
  daily: (days = 30) => request(`/stats/daily?days=${days}`),
  muscles: (days = 30) => request(`/stats/muscles?days=${days}`),
  prs: (limit = 8) => request(`/stats/prs?limit=${limit}`),
  exerciseStats: (id, limit = 20) => request(`/stats/exercise/${id}?limit=${limit}`),

  // 计划
  plans: () => request('/plans'),
  plan: (id) => request(`/plans/${id}`),
  planToday: (date) => request(`/plans/today${date ? `?date=${date}` : ''}`),
  createPlan: (payload) => request('/plans', { method: 'POST', body: payload }),
  updatePlan: (id, payload) => request(`/plans/${id}`, { method: 'PUT', body: payload }),
  generatePlan: (payload) => request('/plans/generate', { method: 'POST', body: payload, timeout: 240000 }),
  activatePlan: (id) => request(`/plans/${id}/activate`, { method: 'POST' }),
  deletePlan: (id) => request(`/plans/${id}`, { method: 'DELETE' }),

  // 设置
  settings: () => request('/settings'),
  saveSettings: (payload) => request('/settings', { method: 'PUT', body: payload }),
  testDeepseek: () => request('/settings/test-deepseek', { method: 'POST', timeout: 60000 }),
};

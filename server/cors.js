/**
 * 原生客户端（Capacitor）跨域支持。
 *
 * WebView 加载本地 assets 时 origin 是 https://localhost，而接口在
 * https://fit.kjsa.cn，属于跨域请求。会话走 Authorization: Bearer，
 * 不依赖 Cookie，所以这里只需要放行来源、方法和请求头。
 *
 * 白名单按 origin 精确匹配（不用 *），避免任意网页拿用户浏览器发起请求。
 * 自建服务器换域名时用 APP_ORIGINS=https://app.example.com,http://192.168.1.9:8080 扩展。
 */

const DEFAULT_ORIGINS = [
  'https://localhost', // Capacitor Android / iOS 默认 androidScheme=https
  'http://localhost', // 旧版 androidScheme=http
  'capacitor://localhost', // iOS 旧 scheme
];

export function corsMiddleware() {
  const extra = String(process.env.APP_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_ORIGINS, ...extra]);

  return function cors(req, res, next) {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return next();

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
    // 导出接口靠这个头拿文件名
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

    // 预检请求不进入业务路由（Express 5 的 '*' 通配写法已失效，用中间件最稳）
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

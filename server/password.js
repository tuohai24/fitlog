import crypto from 'node:crypto';

/**
 * 密码哈希：scrypt + 随机盐，存储格式 `scrypt$<salt-hex>$<hash-hex>`
 * 不依赖任何第三方库，node 内置即可。
 */
const KEYLEN = 64;
const OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, OPTS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(stored, password) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expect = Buffer.from(hashHex, 'hex');
  if (!salt.length || !expect.length) return false;
  let got;
  try {
    got = crypto.scryptSync(String(password), salt, expect.length, OPTS);
  } catch {
    return false;
  }
  return got.length === expect.length && crypto.timingSafeEqual(got, expect);
}

export const PASSWORD_MIN = 6;
export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export function validateCredentials(username, password) {
  if (!USERNAME_RE.test(String(username || ''))) {
    return '用户名需为 3-20 位字母、数字、下划线或短横线';
  }
  if (String(password || '').length < PASSWORD_MIN) {
    return `密码至少 ${PASSWORD_MIN} 位`;
  }
  if (String(password).length > 128) return '密码过长';
  return null;
}

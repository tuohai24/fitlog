/**
 * 一条命令打出安卓安装包：生成 Web 资源 → 同步壳工程 → Gradle 构建 → 落到 dist/。
 *
 * 依赖：JDK 17+（JDK 21 最稳）、Android SDK（platform 36 / build-tools 36）、Node 22+。
 * 环境变量 JAVA_HOME / ANDROID_HOME 没设时会尝试常见安装位置。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, copyFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const isWin = process.platform === 'win32';

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) || '';
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  return firstExisting([
    'C:/Users/Administrator/tools/jdk/jdk-21.0.2',
    '/c/Users/Administrator/tools/jdk/jdk-21.0.2',
    'C:/Program Files/Android/Android Studio/jbr',
    '/usr/lib/jvm/java-21-openjdk-amd64',
    '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
  ]);
}

function resolveAndroidHome() {
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME;
  if (process.env.ANDROID_SDK_ROOT && existsSync(process.env.ANDROID_SDK_ROOT)) return process.env.ANDROID_SDK_ROOT;
  // 工程里已有的 local.properties 优先
  const localProps = join(ANDROID, 'local.properties');
  if (existsSync(localProps)) {
    const m = /^sdk\.dir=(.+)$/m.exec(readFileSync(localProps, 'utf8'));
    if (m && existsSync(m[1].trim())) return m[1].trim();
  }
  return firstExisting([
    'C:/android-sdk',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    `${process.env.HOME}/Library/Android/sdk`,
    '/usr/lib/android-sdk',
  ]);
}

const JAVA_HOME = resolveJavaHome();
const ANDROID_HOME = resolveAndroidHome();

/**
 * 优先用本机装的 Gradle：wrapper 首次要从 services.gradle.org 拉 130MB，
 * 默认超时 10 秒，国内网络基本必失败。本机没有才退回 wrapper。
 */
function resolveGradle() {
  if (process.env.GRADLE_BIN && existsSync(process.env.GRADLE_BIN)) return process.env.GRADLE_BIN;
  const probe = spawnSync(isWin ? 'where' : 'which', ['gradle'], { encoding: 'utf8' });
  const found = (probe.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (found && existsSync(found)) return found;
  return isWin ? 'gradlew.bat' : './gradlew';
}

if (!JAVA_HOME) {
  console.error('[apk] 找不到 JDK。装一个 JDK 21 并设置 JAVA_HOME 后再试。');
  process.exit(1);
}
if (!ANDROID_HOME) {
  console.error('[apk] 找不到 Android SDK。装 cmdline-tools 后设置 ANDROID_HOME 后再试。');
  process.exit(1);
}
if (!existsSync(join(ANDROID, 'gradlew'))) {
  console.error('[apk] 缺少 android 工程，先跑 npx cap add android');
  process.exit(1);
}

console.log(`[apk] JAVA_HOME=${JAVA_HOME}`);
console.log(`[apk] ANDROID_HOME=${ANDROID_HOME}`);

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME };

function run(cmd, args, cwd, label) {
  console.log(`[apk] ${label}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    console.error(`[apk] ${label} 失败（exit ${r.status}）`);
    process.exit(r.status || 1);
  }
}

run(process.execPath, [join(ROOT, 'scripts', 'build-native.mjs')], ROOT, '1/4 生成 Web 资源');
run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], ROOT, '2/4 同步壳工程');

// 已经有图标文件时跳过重新光栅化（避免每次构建都起一次浏览器）
if (!existsSync(join(ANDROID, 'app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png'))) {
  run(process.execPath, [join(ROOT, 'scripts', 'make-android-icons.mjs')], ROOT, '2.5/4 生成图标');
}

const gradle = resolveGradle();
run(gradle, ['assembleRelease'], ANDROID, '3/4 Gradle 构建 release');

const apk = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(apk)) {
  console.error(`[apk] 构建完成但找不到产物：${apk}`);
  process.exit(1);
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const target = join(ROOT, 'dist', `FitLog-${pkg.version}.apk`);
rmSync(target, { force: true });
copyFileSync(apk, target);

const size = statSync(target).size;
const sha = createHash('sha256').update(readFileSync(target)).digest('hex').slice(0, 16);
console.log(`[apk] 4/4 完成 → dist/FitLog-${pkg.version}.apk`);
console.log(`[apk] 体积 ${(size / 1024 / 1024).toFixed(1)} MB · sha256 ${sha}…`);

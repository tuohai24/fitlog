# 安卓客户端

FitLog 的安卓版是用 Capacitor 包的壳：界面、业务逻辑、接口全都是同一套 Web 代码，
只有三处平台差异（接口地址、会话方式、文件保存）在 `public/js/platform.js` 里分支处理。
好处是改一次前端，网页、小程序、安卓三端同时生效。

## 安装包

构建产物在 `dist/FitLog-<版本>.apk`。

装到手机的两条路：

1. **数据线**：手机连电脑，把 APK 拷进「下载」目录，在文件管理器里点开安装（需允许「安装未知来源应用」）。
2. **直接下载**：把 APK 放到自己的服务器上一个可访问路径，用手机浏览器下载后安装。

首次打开会停在登录页，用网页端同一个账号登录即可。

## 自己构建

```bash
npm install
npm run apk
```

需要三样东西：

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node | ≥ 22 | 与 Web 端一致 |
| JDK | 17 ~ 21 | 推荐 [Temurin 21](https://adoptium.net/)，设 `JAVA_HOME` |
| Android SDK | platform 36 + build-tools 36 | 设 `ANDROID_HOME`；也可用 Android Studio 装 |

`npm run apk` 会依次做四件事：

1. `scripts/build-native.mjs` 把 `public/` 复制到 `dist/native/`，**跳过 134MB 的 `media/`**（动图仍然从服务器加载），否则 APK 会膨胀到 150MB+
2. `npx cap sync android` 同步 Web 资源与原生插件
3. Gradle `assembleRelease`
4. 产物复制到 `dist/FitLog-<版本>.apk`，并打印体积与 sha256

### Gradle 下载超时

`./gradlew` 首次运行要从 `services.gradle.org` 拉 130MB 发行版，默认超时只有 10 秒，
国内网络很容易 `timeout (10000ms)`。绕开办法是本地装一份同版本 Gradle 直接用：

```bash
# 镜像下载后在 android/ 目录直接构建，不走 wrapper
gradle assembleRelease
```

或者改 `android/gradle/wrapper/gradle-wrapper.properties` 里的 `networkTimeout`，
把 `distributionUrl` 换成 `https://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-all.zip`。

## 签名

发布签名材料是 `android/keystore.properties` + `android/fitlog-release.keystore`，
**两者都在 `.gitignore` 里，不会进仓库**。

- 换机/重装系统前务必备份这两个文件，否则新版本无法覆盖安装，只能卸载重装（服务端数据不受影响，但手机上的登录态会丢）。
- 没有 `keystore.properties` 时构建会自动退回 debug 签名，产物照样能装，适合别人自己 clone 下来试。
- 想换自己的签名：`keytool -genkeypair` 生成新 keystore，改 `keystore.properties` 里的四个字段即可。

## 与 Web 端的差异

| 行为 | Web / PWA | 安卓壳 |
| --- | --- | --- |
| 页面来源 | 服务器 | 本地 assets（秒开，不依赖网络首屏） |
| 接口地址 | 同源 `/api` | `https://fit.953555.xyz/api` 绝对地址 + CORS |
| 会话 | HttpOnly Cookie | `Authorization: Bearer <token>`（跨站 Cookie 会被 SameSite 拦掉） |
| 导出文件 | 浏览器下载 | 写进应用缓存 → 拉起系统分享面板 → 「保存到文件」 |
| Service Worker | 注册，离线可用 | 不注册（壳已经缓存了页面） |
| 动作动图 | 同源 `/media/` | 远端 `/media/`（不打包进 APK） |

### 换成自己的服务器

默认接口地址写死在 `public/js/platform.js` 的 `DEFAULT_API_BASE`。改成你的域名后重新打包即可。
运行时也能覆盖（存在 localStorage 的 `fitlog.apiBase`），改完刷新页面生效。

服务端需要在 `server/cors.js` 的白名单里允许壳的 origin
（`https://localhost` / `capacitor://localhost`），或通过 `APP_ORIGINS` 环境变量追加。

## 已知限制

- 没有推送通知，训练提醒仍是网页里的可见提示。
- 应用图标只有一套静态图，没有月圆/主题图标（Android 13 的 monochrome 分层未做）。
- 未接入离线写入：断网时能打开界面，但记录要等联网才能提交。
- targetSdk 36，Android 7.0（API 24）以下装不上。

## 目录说明

```
capacitor.config.json     壳配置（appId / webDir / scheme）
android/                  Capacitor 生成的 Gradle 工程
  app/src/main/assets/public/   构建时同步的 Web 资源（不入库）
  app/src/main/res/mipmap-*/    图标（scripts/make-android-icons.mjs 生成）
scripts/build-native.mjs  复制 Web 资源，排除 media
scripts/make-android-icons.mjs  用 Chromium canvas 光栅化图标与启动图
scripts/build-apk.mjs     一键构建
```

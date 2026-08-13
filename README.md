# Emoji Assistant 表情包助手（Windows 桌面端）

一个类似"表情包输入法"的桌面工具：全局快捷键呼出悬浮搜索窗 → 输入关键词搜索表情 → 点击后自动复制到剪贴板并模拟 Ctrl+V 粘贴到当前聊天窗口（微信 / QQ 等）。

> 注意：本工具只做"复制 + 模拟粘贴"，不做真实输入法，无需安装任何驱动级组件。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 桌面端 | Electron + Vue 3 + TypeScript + Element Plus + Pinia |
| 按键/窗口模拟 | @nut-tree/nut-js（按键）+ PowerShell（激活窗口，零原生编译负担） |
| 后端 | Spring Boot 3 + MyBatis-Plus + MySQL + Redis + MinIO |
| 搜索 | 本地 MySQL/H2 模糊搜索 + 网络图库搜索（内置中文梗图库 BQB + 免费搜狗 SOGOU + Giphy / Tenor），点击网络表情同样自动下载→剪贴板→Ctrl+V |

## 目录结构

```
├── frontend/                  # Electron + Vue3 桌面端
│   ├── electron/
│   │   ├── main/              # 主进程：窗口/托盘/快捷键/开机启动/发送
│   │   └── preload/           # 预加载：contextBridge 安全暴露 API
│   ├── src/                   # 渲染进程（Vue3 面板）
│   │   ├── components/        # SearchBar / CategoryTabs / StickerGrid / StickerCard
│   │   ├── api/               # 后端 HTTP 封装
│   │   ├── stores/            # Pinia 状态
│   │   └── types/             # TS 类型
│   └── resources/             # 图标
├── backend/                   # Spring Boot 3 后端
│   └── src/main/java/com/emojiassistant/
│       ├── controller/        # Emoji / Category / Favorite / Upload
│       ├── service/           # 业务 + impl
│       ├── search/            # ★ EmojiSearchService（预留 ES/Giphy/Tenor 接入点）
│       ├── mapper/            # MyBatis-Plus Mapper
│       ├── entity/            # 实体
│       ├── config/            # MyBatis-Plus / Redis / MinIO / CORS
│       └── common/            # 统一响应 + 全局异常
└── tools/gen-assets.mjs       # 生成图标与占位表情图（纯 Node，零依赖）
```

## 一键启动 / 打包（Windows）

项目根目录下有现成的“按钮”：

| 脚本 | 作用 |
| --- | --- |
| **`启动.bat`** | 开发模式一键启动：自动拉起后端（desktop profile + H2，无需 MySQL/Redis）并弹出面板；若已运行则不重复启动，直接提示按 `Ctrl+Shift+E` 呼出 |
| **`打包.bat`** | 一键打包：编译后端 → 安装前端依赖 → 构建 → 产出 NSIS 安装包到 `frontend\打包文件夹\` |

双击运行即可（首次启动会先装依赖、稍慢）。

## 快速开始

### 后端

```bash
cd backend

# 方式 A（推荐，免装任何依赖）：H2 内存库快速联调
mvn spring-boot:run -Dspring-boot.run.profiles=dev

# 方式 B（生产/正式数据）：MySQL
#   1. 创建数据库 emoji_assistant（utf8mb4），schema.sql / data.sql 首启自动执行
#   2. 修改 application.yml 中的数据库账号密码
mvn spring-boot:run
```

Redis / MinIO 未启动时服务自动降级（直查数据库、跳过上传），不影响主流程。

### 前端

```bash
cd frontend
npm install
npm run dev                # 开发模式（Electron + Vite HMR）
npm run build              # 构建产物输出到 out/
npm run typecheck          # vue-tsc 类型检查
```

## 打包安装包

```bash
cd frontend
npm run dist        # electron-builder 产出 NSIS 安装包
```

> ⚠️ 安装包内置后端 jar（`extraResources` 打包 `../backend/target/emoji-assistant-backend-0.1.0.jar`），
> **打包前需先构建后端**：`cd backend && mvn -DskipTests package`。

产物在 `frontend/打包文件夹/`：`EmojiAssistant Setup <版本>.exe`（NSIS 安装包，可选安装目录、桌面/开始菜单快捷方式）。

## 代码签名与 SmartScreen（消除“未知发布者”警告）

未签名的安装包在 Windows 上首次运行会提示 **“未知发布者”**（SmartScreen）。两种解决方式：

### 方式 A：自签名证书（免费，本机消除警告）

生成自签名代码签名证书并**信任到本机**后，安装包显示发布者为 `EmojiAssistant`，本机不再警告。

```bash
# 1. 生成证书并信任本机（一次性）：
powershell -ExecutionPolicy Bypass -File tools/create-signing-cert.ps1
#    → 生成 certs/emoji-assistant.pfx + .cer，并自动安装到本机“受信任的根证书颁发机构”和“受信任的发布者”

# 2. 打包（打包.bat 检测到 certs/emoji-assistant.pfx 会自动签名）
打包.bat
```

> ⚠️ 局限：自签名证书只被**你自己信任的机器**（安装了该 .cer 的机器）认可。
> 发给他人时对方电脑仍会警告，需对方安装 `certs/emoji-assistant.cer` 到“受信任的根证书颁发机构”才能消除。

### 方式 B：商业代码签名证书（推荐对外分发，彻底消除）

购买 OV/EV 代码签名证书（如 Sectigo / DigiCert / 沃通），拿到 `.pfx` 后：

```bash
# 打包.bat 自动读取以下两个环境变量完成签名（也可手动在打包命令前设置）：
set CSC_LINK=D:\path\to\your-cert.pfx
set CSC_KEY_PASSWORD=你的证书密码
npm run dist
```

商业证书（尤其 EV 证书 + 时间戳）被所有 Windows 电脑信任，SmartScreen 完全不再警告，适合对外分发。

### 手动信任 / 放行（SmartScreen 白名单）

- **单次放行**：右键安装包 → 属性 → 勾选“解除锁定”→ 确定；或点击 SmartScreen 弹窗里的“更多信息 → 仍要运行”
- **永久白名单（推荐）**：将 `certs/emoji-assistant.cer` 导入到“受信任的根证书颁发机构”（双击 .cer → 安装证书 → 本地计算机/当前用户 → 受信任的根证书颁发机构），之后所有由该证书签名的安装包均不再警告
- **验证签名**：右键安装包 → 属性 → 数字签名 页签可看到 `EmojiAssistant` 签名；或用 `Get-AuthenticodeSignature <文件>` 检查

> **已知坑：无管理员权限下 winCodeSign 缓存解压失败**
>
> electron-builder 在 Windows 上打包时会解压 winCodeSign 工具包，其中 darwin 目录含符号链接，非管理员/未开开发者模式时创建符号链接会报
> `Cannot create symbolic link : 客户端没有所需的特权` 并不断重试。
> 绕过方法：在缓存目录预置一个同名空目录，app-builder 检测到目录存在就会跳过下载与解压（本仓库打包不需要其中的签名工具）：
>
> ```bash
> mkdir -p "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0"
> ```

## 网络图库搜索（内置中文梗图库 + 免费搜狗 + Giphy / Tenor）

本地不保存表情图库，只保存一份**配置文件**。搜索关键词时，后端把本地表情与网络图库结果合并返回（本地在前、网络在后，网络表情带 `BQB`/`SOGOU`/`GIPHY`/`TENOR` 角标，不可收藏）。

- **BQB（内置中文梗图库）**：默认开启、无需任何 Key，内置 4000+ 张中文梗图索引，图片运行时从 jsdelivr CDN 加载。搜「熊猫」「裂开」「狗头」等中文关键词即可出现。
- **SOGOU（免费搜狗表情包）**：默认开启、无需 Key，按关键词实时返回搜狗图床表情（接口盒子聚合，公开演示凭据；依赖第三方共享频次，偶有波动，失败自动跳过）。
- **Giphy / Tenor**：需免费申请 API Key 后自动启用（见下）。

Giphy / Tenor 启用步骤（免费申请，各约 1 分钟）：

1. Giphy Key：https://developers.giphy.com 申请；Tenor Key：https://tenor.com/gifapi 申请
2. 编辑外部配置文件（安装包首次运行时自动生成）：

   ```
   %APPDATA%/emoji-assistant-frontend/config/application-desktop.yml
   ```

   填入 `giphy.api-key` / `tenor.api-key`（`network-search.enabled`、`chinesebqb.enabled`、`sogou.enabled` 默认已为 `true`，也可在此关闭 BQB/搜狗）
3. 重启 app 生效

> 该外部配置优先级高于安装包内置配置，用户只改这一个文件，无需动安装包。
> 未配置 key / 网络不可达 / 超时均自动降级为仅本地结果，不影响使用。
>
> 无外网联调：`node tools/mock-net-api.mjs` 起一个本地 mock（Giphy/Tenor 响应形状），
> 把配置里的 `base-url` 指向 `http://127.0.0.1:9999` 即可验证完整链路。

## 内置后端自动启动

安装包内的桌面端会在启动时自动拉起内置的 Spring Boot 后端（`desktop` profile + H2 文件库），**无需手动开终端**：

- 启动时先探测 `18080` 端口：若已有健康的后端（例如你自己用 MySQL 起的开发服务）→ 直接复用；否则启动内置 jar（数据存到 `%APPDATA%/emoji-assistant-frontend/`）
- 退出 app 时自动停止内置后端；被强制结束（任务管理器）时也会由系统 Job Object 一并回收，不留孤儿进程
- 后端日志：`%APPDATA%/emoji-assistant-frontend/backend.log`（java 输出）与 `backend-runner.log`（启动决策）
- **前置条件：电脑上需要装有 Java（`java` 在 PATH 中）**，后续迭代可打包内嵌 JRE 做到零依赖

## 使用说明

1. 安装并运行 `EmojiAssistant Setup 0.1.0.exe`（后端会自动启动，无需手动开终端）
2. 默认全局快捷键 **Ctrl+Shift+E** 呼出/隐藏悬浮窗
3. 顶部搜索框输入关键词（如"我服了"），下方网格显示匹配表情
4. 点击表情 → 自动复制图片并模拟 Ctrl+V 粘贴到呼出前的聊天窗口
5. 悬停表情显示名称；支持收藏（☆）、最近使用、分类切换（搞笑/动物/表情/热门/自定义）
6. （可选）配置 Giphy/Tenor API Key 后，搜索关键词自动合并网络表情结果
7. 托盘右键菜单：显示窗口 / 设置开机启动 / 退出

## 开发路线（按模块）

1. ✅ 项目结构与资源
2. ✅ Electron 窗口、全局快捷键、托盘、开机启动
3. ✅ Vue3 + Element Plus 表情面板
4. ✅ 发送功能（剪贴板 + 激活窗口 + Ctrl+V）
5. ✅ Spring Boot API（搜索/分类/收藏/上传 + emoji-search-service 预留）
6. ✅ 数据库设计 + 种子数据
7. ✅ 前后端联调验证

## 已知边界（后续迭代）

- 已内置 55 个真实 GIF 表情（来源：[ChineseBQB](https://github.com/zhaoolee/ChineseBQB) 开源仓库，`tools/fetch-bqb.mjs` 拉取，仅供个人斗图使用勿商用）；其余为生成的占位 PNG，可继续用该脚本扩充或接入 MinIO / Giphy
- 模拟粘贴依赖窗口激活成功；个别全屏游戏/管理员权限窗口可能无法激活（属系统限制）
- 第二版搜索可接入 Elasticsearch（`EmojiSearchService` 已预留接口）
- 安装包内置后端依赖本机 Java；后续可打包内嵌 JRE（jlink）实现开箱即用

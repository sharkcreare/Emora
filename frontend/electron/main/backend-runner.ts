import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, appendFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import netSocket from 'node:net'
import { request as httpRequest } from 'node:http'

/** 后端端口（与渲染进程 axios 的 baseURL 保持一致） */
export const API_PORT = 18080
const API_BASE = `http://127.0.0.1:${API_PORT}`
const HEALTH_URL = `${API_BASE}/api/health`

let child: ChildProcess | null = null
let starting = false
let inFlight: Promise<boolean> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** runner 决策日志落盘（Windows GUI 应用 console 不可见，写文件便于排查） */
function log(message: string): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'backend-runner.log'), `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    /* 日志失败不影响主流程 */
  }
  console.log(`[backend] ${message}`)
}

/** 探测端口是否已有进程监听 */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new netSocket.Socket()
    const done = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(800)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/**
 * 发起一次健康探测。
 * 注意：不用 Electron net.fetch —— 其走 Chromium 网络栈（代理/AbortSignal 行为与普通 HTTP 不一致），
 * 实测会误判健康后端为不可用导致重复拉起。node:http 行为与 curl 一致，稳定可靠。
 */
function httpGetOk(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(url, { timeout: timeoutMs }, (res) => {
      res.resume() // 消费响应体，避免连接挂起
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

/** 轮询健康接口直到就绪或超时 */
async function checkHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await httpGetOk(HEALTH_URL, 1500)) return true
    await sleep(500)
  }
  return false
}

/**
 * 外部配置目录：首次启动写入一份示例 application-desktop.yml。
 * 后端通过 --spring.config.additional-location 加载它（优先级高于安装包内置配置），
 * 用户只需编辑这份文件（例如填入 Giphy/Tenor API Key），无需改动安装包。
 */
function ensureExternalConfig(configDir: string): void {
  try {
    mkdirSync(configDir, { recursive: true })
  } catch (e) {
    log(`创建配置目录失败: ${String(e)}`)
    return
  }
  const file = join(configDir, 'application-desktop.yml')
  if (existsSync(file)) return
  const sample = `# EmojiAssistant 外部配置（优先级高于安装包内置配置，修改后重启 app 生效）
#
# 网络图库搜索：默认已启用内置中文梗图库（ChineseBQB）与免费搜狗表情包（SOGOU，均无需 Key）；
# 再填入 Giphy / Tenor API Key 即可一并合并其网络表情（点击后自动下载→剪贴板→Ctrl+V）。
# Giphy Key: https://developers.giphy.com 免费申请
# Tenor Key: https://tenor.com/gifapi 免费申请
#
network-search:
  enabled: true
  limit: 100
  timeout-ms: 4000
  chinesebqb:
    enabled: true
  sogou:
    enabled: true
    id: "88888888"
    key: "88888888"
    base-url: https://cn.apihz.cn/api/img/apihzbqbsougou.php
  baidu:
    enabled: true
    id: "88888888"
    key: "88888888"
    base-urls:
      - http://101.35.2.25
      - http://124.222.204.22
      - http://101.34.207.105
  mengya:
    enabled: true
  giphy:
    api-key: ""
    base-url: https://api.giphy.com/v1/stickers
    rating: g
  tenor:
    api-key: ""
    base-url: https://tenor.com/v2
    content-filter: medium
`
  try {
    writeFileSync(file, sample, 'utf8')
    log(`已生成外部配置文件: ${file}`)
  } catch (e) {
    log(`写入示例配置失败: ${String(e)}`)
  }
}

/** 目录下最新的 *.jar（避免 jar 版本号写死，升级版本后无需改代码） */
function latestJar(dir: string): string | null {
  try {
    const jars = readdirSync(dir)
      .filter((f) => f.endsWith('.jar'))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    return jars[0] ?? null
  } catch {
    return null
  }
}

/** 定位内置后端 jar：打包后位于 resources/backend/，开发模式位于 backend/target/ */
function locateBackendJar(): string | null {
  if (app.isPackaged) {
    return latestJar(join(process.resourcesPath, 'backend'))
  }
  return latestJar(join(app.getAppPath(), '../backend/target'))
}

/** 定位 java 可执行：优先打包内嵌 JRE（jlink），否则回退 PATH 上的 java */
function locateJavaBin(): string | null {
  if (app.isPackaged) {
    const p = join(process.resourcesPath, 'jre', 'bin', 'java.exe')
    return existsSync(p) ? p : null
  }
  const devJre = join(app.getAppPath(), '../backend/target/jre/bin/java.exe')
  return existsSync(devJre) ? devJre : null
}

/** 启动内置后端（desktop profile + H2 文件库，数据放在 Electron userData 目录） */
async function startBackend(): Promise<boolean> {
  if (child || starting) {
    // 已在启动中，等待其就绪
    return checkHealth(30_000)
  }
  const jarPath = locateBackendJar()
  if (!jarPath) {
    log('未找到内置后端 jar，跳过自动启动')
    return false
  }
  starting = true
  try {
    const dbPath = join(app.getPath('userData'), 'db', 'emoji_assistant').replace(/\\/g, '/')
    const configDir = join(app.getPath('userData'), 'config').replace(/\\/g, '/')
    const uploadDir = join(app.getPath('userData'), 'uploads').replace(/\\/g, '/')
    ensureExternalConfig(configDir)
    const args = [
      '-jar',
      jarPath,
      '--spring.profiles.active=desktop',
      `--spring.datasource.url=jdbc:h2:file:${dbPath};MODE=MySQL;DATABASE_TO_LOWER=TRUE`,
      `--app.upload-dir=${uploadDir}`,
      // 外部配置目录：本地只保存配置文件（API Key 等），优先级高于安装包内置配置
      `--spring.config.additional-location=file:${configDir}/`,
      `--server.port=${API_PORT}`
    ]
    log(`启动内置后端: ${args.join(' ')}`)
    const javaBin = locateJavaBin() ?? 'java'
    child = spawn(javaBin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    // java 输出落盘（userData/backend.log），便于排查启动失败
    const logStream = createWriteStream(join(app.getPath('userData'), 'backend.log'), { flags: 'a' })
    child.stdout?.on('data', (d: Buffer) => logStream.write(d))
    child.stderr?.on('data', (d: Buffer) => logStream.write(d))
    child.on('exit', (code) => {
      log(`内置后端退出，code=${code}`)
      child = null
    })

    const ok = await checkHealth(30_000)
    log(ok ? '内置后端就绪' : '内置后端启动超时（30s）')
    return ok
  } finally {
    starting = false
  }
}

/**
 * 确保后端可用（幂等，可安全重复调用）：
 * 1. 18080 已有健康服务（用户自建 MySQL 后端，或上次强制退出残留的孤儿进程）→ 直接复用
 * 2. 否则启动内置后端并等待就绪
 */
export function ensureBackend(): Promise<boolean> {
  if (!inFlight) {
    inFlight = (async () => {
      if (await isPortOpen(API_PORT)) {
        if (await checkHealth(2000)) {
          log('检测到 18080 已有健康后端，直接复用')
          return true
        }
        log('18080 端口被占用但无健康响应，尝试启动内置后端')
      }
      return startBackend()
    })().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/** 应用退出时终止内置后端进程 */
export function stopBackend(): void {
  if (child) {
    const proc = child
    child = null
    log('停止内置后端')
    proc.kill()
  }
}

import { clipboard, nativeImage, net } from 'electron'
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { compressGifIfNeeded } from './media'

/** 临时下载目录（复制网络图/GIF 时落盘） */
export const TEMP_DIR = join(tmpdir(), 'emoji-assistant')

/** 清理临时下载目录（应用退出时调用，避免磁盘垃圾累积） */
export async function cleanupTempFiles(): Promise<void> {
  try {
    await rm(TEMP_DIR, { recursive: true, force: true })
    console.log('[clipboard] 临时下载目录已清理:', TEMP_DIR)
  } catch (err) {
    console.warn('[clipboard] 清理临时目录失败:', err)
  }
}
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { runPowerShell } from './active-window'

/** 是否为 http(s) 远程地址 */
function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 用 Node.js 原生 http/https 模块下载（net.fetch 在 Windows 上可能对 localhost 失败） */
function downloadViaNode(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? httpsGet : httpGet
    getter(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadViaNode(res.headers.location).then(resolve, reject)
        return
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

/** 根据响应 Content-Type 推断图片扩展名（无后缀 URL 也能存对格式） */
function extFromContentType(contentType: string | null): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  }
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  return map[type] || ''
}

/**
 * 按文件头魔数嗅探图片格式（Content-Type 缺失或 URL 无后缀时兜底，
 * 如搜狗图床的无扩展名直链：PNG/JPEG/GIF/WEBP 均可正确识别）。
 */
function extFromMagic(buf: Buffer): string {
  const b = (i: number): number => buf[i] ?? 0
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'png'
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'gif'
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpg'
  if (buf.length >= 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46
    && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'webp'
  return ''
}

/** 下载远程图片到临时文件，返回本地路径、扩展名与原始字节 */
async function downloadToTemp(url: string): Promise<{ path: string; ext: string; buffer: Buffer }> {
  // localhost 可能解析到 ::1 导致连接失败（后端只监听 127.0.0.1），统一替换为 IPv4
  const fixedUrl = url.replace(/\/\/localhost(?=[:/])/i, '//127.0.0.1')
  let buf: Buffer
  let contentType: string | null = null
  try {
    const res = await net.fetch(fixedUrl, { bypassCustomProtocolHandlers: true })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    contentType = res.headers.get('content-type')
    buf = Buffer.from(await res.arrayBuffer())
  } catch (netErr) {
    console.warn('[clipboard] net.fetch 失败，使用 Node.js http 下载:', netErr)
    buf = await downloadViaNode(fixedUrl)
  }
  console.log('[clipboard] 下载成功, bytes:', buf.length)
  if (buf.length === 0) {
    throw new Error('下载图片为空（0 字节）')
  }
  // 校验下载内容确实是图片：魔数嗅探优先，其次 Content-Type。
  // 图床防盗链时经常返回 200 + text/html 拦截页，提前识别并给出明确错误，
  // 而不是让 nativeImage/jimp 解码失败后报笼统的「无法读取图片」。
  const magicExt = extFromMagic(buf)
  const mimeType = (contentType || '').split(';')[0].trim().toLowerCase()
  if (!magicExt && !mimeType.startsWith('image/')) {
    throw new Error(`下载内容不是有效图片（${mimeType || '未知类型'}，可能是防盗链或错误页）`)
  }
  // 优先用响应 Content-Type，其次 URL 后缀，最后按文件头魔数兜底
  const ext =
    extFromContentType(contentType) ||
    (url.split('?')[0].match(/\.(\w+)$/) || [])[1] ||
    magicExt ||
    'png'
  const dir = TEMP_DIR
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.${ext}`)
  await writeFile(file, buf)
  return { path: file, ext, buffer: buf }
}

/**
 * 以系统文件拖放格式（FileDrop/CF_HDROP + FileNameW + FileName，与资源管理器复制文件一致）
 * 把 .gif 文件写入剪贴板。微信/QQ 粘贴时识别为文件并保留动画（区别于图片数据格式只能贴静态首帧）。
 * 用 .NET Clipboard.SetFileDropList 写入，保证格式名与资源管理器一致、微信/QQ 能识别。
 */
async function writeGifAsFileDrop(filePath: string): Promise<void> {
  // 路径用 Base64 传入，杜绝单引号/美元符号等特殊字符导致的 PS 语法破坏或注入（仅转义反斜杠不安全）
  const b64 = Buffer.from(filePath, 'utf8').toString('base64')
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$path = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))
$c = New-Object System.Collections.Specialized.StringCollection
$c.Add($path)
[System.Windows.Forms.Clipboard]::SetFileDropList($c)
`
  await runPowerShell(script, 10000)
}

/**
 * 将图片写入系统剪贴板。
 * 支持本地路径与 http(s) URL。
 * 分两类写入：
 *   - GIF 动图 → 以「文件拖放」格式（FileDrop）写入，微信/QQ 粘贴为动态 GIF；
 *   - 其余图片 → 写「图片数据」格式（CF_DIB/PNG），微信/QQ/浏览器均可 Ctrl+V 粘贴为静态图；
 *     （Electron nativeImage 不支持 GIF 解码，静态图路径对 GIF 会取首帧，仅作 PowerShell 失败时的兜底）
 */
export async function writeImageToClipboard(url: string): Promise<void> {
  let path = url
  let ext = (url.split('?')[0].match(/\.(\w+)$/) || [])[1]?.toLowerCase() || ''
  let buffer: Buffer | null = null

  console.log('[clipboard] writeImageToClipboard url:', url, 'ext:', ext)

  if (isRemote(url)) {
    const res = await downloadToTemp(url)
    path = res.path
    ext = res.ext
    buffer = res.buffer
    console.log('[clipboard] 下载完成, path:', path, 'ext:', ext, 'size:', buffer.length)
  } else {
    // 本地路径：直接读文件拿 buffer，统一走 createFromBuffer
    try {
      buffer = await readFile(path)
      console.log('[clipboard] 本地文件读取成功, size:', buffer.length)
    } catch (err) {
      console.error('[clipboard] 本地文件读取失败, path:', path, err)
      buffer = null
    }
  }

  let image = buffer ? nativeImage.createFromBuffer(buffer) : nativeImage.createFromPath(path)
  // createFromBuffer 对个别格式可能解不出（如畸形头），再试 createFromPath
  if (image.isEmpty() && path !== url) {
    image = nativeImage.createFromPath(path)
  }
  // Electron nativeImage 不支持 GIF（实测 33.x 三种解码方式全空）。
  // 用 jimp（nut.js 生产依赖自带，打包已含）解码任意位图格式并转 PNG 兜底。
  if (image.isEmpty() && buffer) {
    try {
      // 延迟加载，避免主进程启动即加载 jimp 重型模块
      const jimpMod = await import('jimp')
      const Jimp: any = (jimpMod as any).default ?? jimpMod
      const decoded = await Jimp.read(buffer)
      const png = await decoded.getBufferAsync(Jimp.MIME_PNG)
      image = nativeImage.createFromBuffer(png)
      console.log('[clipboard] jimp 解码成功 (', ext, '→png ), 尺寸:', decoded.getWidth(), 'x', decoded.getHeight())
    } catch (jimpErr) {
      console.warn('[clipboard] jimp 解码失败:', jimpErr)
    }
  }
  if (image.isEmpty()) {
    throw new Error(`无法读取图片: ${url} (ext=${ext}, size=${buffer?.length ?? 0}，nativeImage 与 jimp 均解码失败)`)
  }

  const size = image.getSize()
  console.log('[clipboard] nativeImage 解码成功, 尺寸:', size.width, 'x', size.height)

  clipboard.writeImage(image)
  // 校验：写入后读回，确认剪贴板真的有了图片数据
  const verify = clipboard.readImage()
  if (verify.isEmpty()) {
    throw new Error('剪贴板写入后校验失败（readImage 为空），请检查系统剪贴板权限')
  }
  console.log('[clipboard] nativeImage 写入剪贴板成功，校验通过, 回读尺寸:',
    verify.getSize().width, 'x', verify.getSize().height)
}

/**
 * GIF 专用入口：以文件拖放格式写入剪贴板，微信/QQ 粘贴为动态 GIF。
 * 单独导出，IPC 层对 GIF 走这里；PowerShell 失败时回退到静态图片写入（writeImageToClipboard）。
 * 返回 { hint }：超大 GIF 且未开启压缩时置 true，供渲染层首次提示用户开启。
 */
export async function writeGifToClipboard(url: string): Promise<{ hint?: boolean }> {
  console.log('[clipboard] writeGifToClipboard url:', url)
  let path = url
  if (isRemote(url)) {
    const res = await downloadToTemp(url)
    path = res.path
  }
  // 发送前压缩：超过阈值且开启时自动压缩（worker 线程执行，失败自动回退原文件）
  let hint = false
  try {
    const outcome = await compressGifIfNeeded(path)
    path = outcome.path
    hint = outcome.hint
    if (outcome.compressed) {
      console.log('[clipboard] GIF 已压缩:', path)
    }
  } catch (err) {
    console.warn('[clipboard] GIF 压缩调度异常，使用原文件:', err)
  }
  // 本地文件存在才写入；PowerShell 失败降级为静态图
  try {
    await writeGifAsFileDrop(path)
    console.log('[clipboard] GIF 已以文件格式写入剪贴板:', path)
    return { hint }
  } catch (err) {
    console.warn('[clipboard] GIF 文件格式写入失败，回退静态图:', err)
  }
  await writeImageToClipboard(url)
  return { hint }
}
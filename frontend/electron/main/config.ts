import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 网络图库搜索配置（对应外部 yml 的 network-search 段） */
export interface NetworkSearchConfig {
  enabled: boolean
  /** 内置中文梗图库（ChineseBQB，无需 Key） */
  chinesebqbEnabled: boolean
  /** 免费搜狗表情包（接口盒子聚合，无需 Key，共享频次） */
  sogouEnabled: boolean
  /** 百度图库实时通道（接口盒子 IP 直连，无需 Key，内容实时更新） */
  baiduEnabled: boolean
  /** 萌芽梗图浏览（meme.smyhub.com，2600+ 梗图，免 Key，仅浏览） */
  mengyaEnabled: boolean
  giphyApiKey: string
  tenorApiKey: string
  giphyBaseUrl: string
  tenorBaseUrl: string
}

const DEFAULT_CONFIG: NetworkSearchConfig = {
  enabled: true,
  chinesebqbEnabled: true,
  sogouEnabled: true,
  baiduEnabled: true,
  mengyaEnabled: true,
  giphyApiKey: '',
  tenorApiKey: '',
  giphyBaseUrl: 'https://api.giphy.com/v1/stickers',
  tenorBaseUrl: 'https://tenor.com/v2'
}

function configFile(): string {
  return join(app.getPath('userData'), 'config', 'application-desktop.yml')
}

/** 外部 yml 不存在时的最小模板（结构固定，便于行级替换） */
function sampleYml(): string {
  return `network-search:
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
}

function indentOf(line: string): string {
  return line.slice(0, line.length - line.trimStart().length)
}

/** 读取外部配置中的 network-search 段（行级解析；文件缺失/解析失败返回默认值） */
export function getNetworkSearchConfig(): NetworkSearchConfig {
  const file = configFile()
  if (!existsSync(file)) return { ...DEFAULT_CONFIG }
  try {
    const cfg: NetworkSearchConfig = { ...DEFAULT_CONFIG }
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    let block = ''
    for (const line of lines) {
      const t = line.trim()
      if (/^network-search:\s*$/.test(t)) {
        block = 'net'
        continue
      }
      if (/^chinesebqb:\s*$/.test(t)) {
        block = 'chinesebqb'
        continue
      }
      if (/^sogou:\s*$/.test(t)) {
        block = 'sogou'
        continue
      }
      if (/^baidu:\s*$/.test(t)) {
        block = 'baidu'
        continue
      }
      if (/^mengya:\s*$/.test(t)) {
        block = 'mengya'
        continue
      }
      if (/^giphy:\s*$/.test(t)) {
        block = 'giphy'
        continue
      }
      if (/^tenor:\s*$/.test(t)) {
        block = 'tenor'
        continue
      }
      if (t === '' || t.startsWith('#')) continue
      const m = t.match(/^([\w-]+):\s*(.*)$/)
      if (!m) continue
      const val = m[2].replace(/^"(.*)"$/, '$1').trim()
      if (block === 'net' && m[1] === 'enabled') cfg.enabled = val === 'true'
      else if (block === 'chinesebqb' && m[1] === 'enabled') cfg.chinesebqbEnabled = val === 'true'
      else if (block === 'sogou' && m[1] === 'enabled') cfg.sogouEnabled = val === 'true'
      else if (block === 'baidu' && m[1] === 'enabled') cfg.baiduEnabled = val === 'true'
      else if (block === 'mengya' && m[1] === 'enabled') cfg.mengyaEnabled = val === 'true'
      else if (block === 'giphy' && m[1] === 'api-key') cfg.giphyApiKey = val
      else if (block === 'tenor' && m[1] === 'api-key') cfg.tenorApiKey = val
      else if (block === 'giphy' && m[1] === 'base-url') cfg.giphyBaseUrl = val
      else if (block === 'tenor' && m[1] === 'base-url') cfg.tenorBaseUrl = val
    }
    return cfg
  } catch (e) {
    console.error('[config] 读取外部配置失败:', e)
    return { ...DEFAULT_CONFIG }
  }
}

/** 写回外部配置（保留注释，仅替换目标行；文件不存在时先写模板） */
export function setNetworkSearchConfig(cfg: NetworkSearchConfig): boolean {
  const file = configFile()
  try {
    const dir = join(app.getPath('userData'), 'config')
    mkdirSync(dir, { recursive: true })
    const lines = (existsSync(file) ? readFileSync(file, 'utf8') : sampleYml()).split(/\r?\n/)
    let block = ''
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim()
      if (/^network-search:\s*$/.test(t)) {
        block = 'net'
        continue
      }
      if (/^chinesebqb:\s*$/.test(t)) {
        block = 'chinesebqb'
        continue
      }
      if (/^sogou:\s*$/.test(t)) {
        block = 'sogou'
        continue
      }
      if (/^baidu:\s*$/.test(t)) {
        block = 'baidu'
        continue
      }
      if (/^mengya:\s*$/.test(t)) {
        block = 'mengya'
        continue
      }
      if (/^giphy:\s*$/.test(t)) {
        block = 'giphy'
        continue
      }
      if (/^tenor:\s*$/.test(t)) {
        block = 'tenor'
        continue
      }
      const m = t.match(/^([\w-]+):\s*(.*)$/)
      if (!m) continue
      const ind = indentOf(lines[i])
      if (block === 'net' && m[1] === 'enabled') lines[i] = `${ind}enabled: ${cfg.enabled}`
      else if (block === 'chinesebqb' && m[1] === 'enabled') lines[i] = `${ind}enabled: ${cfg.chinesebqbEnabled}`
      else if (block === 'sogou' && m[1] === 'enabled') lines[i] = `${ind}enabled: ${cfg.sogouEnabled}`
      else if (block === 'baidu' && m[1] === 'enabled') lines[i] = `${ind}enabled: ${cfg.baiduEnabled}`
      else if (block === 'mengya' && m[1] === 'enabled') lines[i] = `${ind}enabled: ${cfg.mengyaEnabled}`
      else if (block === 'giphy' && m[1] === 'api-key') lines[i] = `${ind}api-key: "${cfg.giphyApiKey}"`
      else if (block === 'tenor' && m[1] === 'api-key') lines[i] = `${ind}api-key: "${cfg.tenorApiKey}"`
      else if (block === 'giphy' && m[1] === 'base-url') lines[i] = `${ind}base-url: ${cfg.giphyBaseUrl}`
      else if (block === 'tenor' && m[1] === 'base-url') lines[i] = `${ind}base-url: ${cfg.tenorBaseUrl}`
    }
    writeFileSync(file, lines.join('\n') + '\n', 'utf8')
    console.log('[config] 外部配置已更新:', file)
    return true
  } catch (e) {
    console.error('[config] 写入外部配置失败:', e)
    return false
  }
}
#!/usr/bin/env node
/**
 * fetch-bqb.mjs — 从 ChineseBQB 开源表情包仓库下载精选中文表情包（GIF）
 *
 * 数据源：https://github.com/zhaoolee/ChineseBQB （开放 JSON 索引）
 * 说明：图片版权归原作者，仅供个人聊天斗图使用，请勿商用。
 *
 * 用法：node tools/fetch-bqb.mjs
 * 输出：
 *   1. 图片 → backend/src/main/resources/static/emojis/real/bqb-XX.gif
 *   2. SQL  → backend/src/main/resources/db/data-real.sql（INSERT IGNORE，幂等）
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_URL = 'https://cdn.jsdelivr.net/gh/zhaoolee/ChineseBQB@master/chinesebqb_github.json'
const IMG_DIR = join(ROOT, 'backend/src/main/resources/static/emojis/real')
const SQL_FILE = join(ROOT, 'backend/src/main/resources/db/data-real.sql')

const TARGET = 60          // 目标张数
const MIN_BYTES = 30_000   // 过滤过小图片
const MAX_BYTES = 400_000  // 过滤过大图片（控制安装包体积）
const CONCURRENCY = 6
const RETRY = 3
const TIMEOUT = 20_000

/** 优先挑选的系列（key 与 category 前缀匹配，保持覆盖度） */
const PREFERRED = [
  '001Funny', '015Golden', '026Chicken', '011Dog', '010Cat', '018WangEgg',
  '009KumamotoBear', '020TATA', '017Playing', '046WhatToWear', '031Penguin',
  '007Tiger', '022SuDaqiang', '013PigPecs', '019Green', '006Hamster',
  '002CuteGirl', '034WhiteVillain', '035TomAndJerry', '043Altman'
]

/** 系列 → 分类映射（动物类 → animal；其余 → funny；个别文字类 → emoji） */
function mapCategory(category) {
  if (/猫|狗|仓鼠|猪|熊猫|熊|企鹅|鸡|兔|乌龟|鸭|汪蛋|金馆长|佩奇/.test(category)) return 'animal'
  if (/表情|Emoji|文字|语录/.test(category)) return 'emoji'
  return 'funny'
}

/** 系列名中提取中文中心词（如 "015Golden_Curator_Panda金馆长熊猫🐼BQB" → "金馆长熊猫"） */
function seriesWord(category) {
  const m = category.match(/[\u4e00-\u9fa5]{2,}/)
  return m ? m[0] : ''
}

/** 文件名 → 中文名（去掉序号前缀与扩展名，取可读名称；无中文时用系列名兜底） */
function cleanName(name, category) {
  let base = name.replace(/\.gif$/i, '')
    .replace(/^\d{2,}-\s*/, '')      // "00026-我裂开了" → "我裂开了"
    .replace(/^\d{4,}/, '')          // 纯序号开头
    .replace(/[_\-]\d{1,3}$/, '')    // 尾部序号
    .trim()
  if (!base || /^\d+$/.test(base) || !/[\u4e00-\u9fa5]/.test(base)) {
    const word = seriesWord(category)
    if (!word) return null
    base = `${word}${(name.match(/\d+/) || [''])[0]}`
  }
  if (base.length > 20) base = base.slice(0, 20)
  return base
}

/** HEAD 获取远程文件大小（jsdelivr 镜像，国内访问快） */
async function headSize(url) {
  for (let i = 0; i < RETRY; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 10_000)
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal })
      clearTimeout(t)
      if (res.ok) return Number(res.headers.get('content-length') || 0)
      return null
    } catch { /* 重试 */ }
  }
  return null
}

/** 下载二进制，失败重试 */
async function download(url) {
  for (let i = 0; i < RETRY; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), TIMEOUT)
      const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal })
      clearTimeout(t)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1024) throw new Error('too small')
      return buf
    } catch (e) {
      if (i === RETRY - 1) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw new Error('unreachable')
}

/** 转 jsdelivr 镜像 URL（raw 链接中的路径原样保留） */
function mirrorUrl(rawUrl) {
  const path = rawUrl.replace(/^https:\/\/raw\.githubusercontent\.com\/zhaoolee\/ChineseBQB\/master\//, '')
  return `https://cdn.jsdelivr.net/gh/zhaoolee/ChineseBQB@master/${encodeURI(path).replace(/%2F/g, '/')}`
}

async function main() {
  console.log('[1/4] 拉取索引…')
  const res = await fetch(INDEX_URL)
  const j = await res.json()
  const items = j.data.filter((f) => /\.gif$/i.test(f.name || '') && f.url)
  console.log(`      索引 ${j.data.length} 条，GIF ${items.length} 条`)

  console.log('[2/4] 按系列挑选并过滤体积…')
  const pool = []
  const perSeries = new Map()
  // 每系列最多 5 张，从前往后取（先取到的通常是系列开头，风格统一）
  for (const item of items) {
    if (pool.length >= TARGET * 3) break
    const pref = PREFERRED.find((p) => item.category.includes(p))
    if (!pref) continue
    const used = perSeries.get(pref) || 0
    if (used >= 5) continue
    perSeries.set(pref, used + 1)
    pool.push(item)
  }
  // 优先系列不足时用其他系列补齐
  for (const item of items) {
    if (pool.length >= TARGET * 3) break
    if (!pool.includes(item)) pool.push(item)
  }

  const picked = []
  let doneHead = 0
  const headQueue = pool.map((item) => async () => {
    try {
      const size = await headSize(mirrorUrl(item.url))
      if (size && size >= MIN_BYTES && size <= MAX_BYTES) {
        const cat = item.category.split('_')[0]
        const used = [...picked].filter((p) => p.category.split('_')[0] === cat).length
        if (used < 6) picked.push({ ...item, size })
      }
    } catch { /* 单个失败跳过 */ }
    doneHead++
    if (doneHead % 30 === 0) console.log(`      已检查 ${doneHead}/${pool.length}，选中 ${picked.length}`)
  })
  for (let i = 0; i < headQueue.length; i += CONCURRENCY) {
    await Promise.all(headQueue.slice(i, i + CONCURRENCY).map((fn) => fn()))
    if (picked.length >= TARGET) break
  }
  console.log(`      选中 ${picked.length} 张（总大小 ${(picked.reduce((s, p) => s + p.size, 0) / 1e6).toFixed(1)} MB）`)

  console.log('[3/4] 下载图片…')
  await mkdir(IMG_DIR, { recursive: true })
  const rows = []
  let done = 0
  const queue = picked.map((item, idx) => async () => {
    const seq = String(idx + 1).padStart(2, '0')
    const file = `bqb-${seq}.gif`
    const dest = join(IMG_DIR, file)
    try {
      const buf = await download(mirrorUrl(item.url))
      await writeFile(dest, buf)
      const name = cleanName(item.name, item.category) || `表情${seq}`
      const word = seriesWord(item.category)
      rows.push({
        file,
        name,
        category: mapCategory(item.category),
        tags: `${name},${word}`
      })
      done++
      console.log(`      [${done}/${picked.length}] ${file} ← ${name} (${(buf.length / 1e3).toFixed(0)} KB)`)
    } catch (e) {
      console.log(`      [失败] ${item.name}: ${e.message}`)
    }
  })
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    await Promise.all(queue.slice(i, i + CONCURRENCY).map((fn) => fn()))
  }

  console.log('[4/4] 生成 SQL…')
  const lines = [
    '-- 真实中文表情包（来源：ChineseBQB 开源仓库，仅供个人使用，勿商用）',
    '-- 由 tools/fetch-bqb.mjs 生成；图片在 static/emojis/real/ 下',
    '',
    `INSERT IGNORE INTO emoji (id, name, url, tags, category, hot_score, source, create_time) VALUES`
  ]
  const idStart = 11
  rows.forEach((r, i) => {
    const id = idStart + i
    const suffix = i === rows.length - 1 ? ';' : ','
    lines.push(`  (${id}, '${r.name}', '/static/emojis/real/${r.file}', '${r.tags}', '${r.category}', ${900 - i}, 'LOCAL', NOW())${suffix}`)
  })
  await writeFile(SQL_FILE, lines.join('\n') + '\n', 'utf8')
  console.log(`      ${SQL_FILE}（${rows.length} 条）`)
  console.log(`完成！请将 data-real.sql 追加到各 profile 的 data-locations。`)
}

main().catch((e) => {
  console.error('失败:', e)
  process.exit(1)
})


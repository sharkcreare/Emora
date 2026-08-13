#!/usr/bin/env node
/**
 * fetch-bqb-index.mjs — 生成 ChineseBQB 全量图片索引（不下载图片本体）
 *
 * 数据源：https://github.com/zhaoolee/ChineseBQB （MIT 开源，仅供个人斗图，勿商用）
 * 用一次 git trees API（recursive）拿整棵文件树，过滤图片路径后生成索引 JSON，
 * 打包进后端 classpath data/chinesebqb-index.json。图片运行时按需从 jsdelivr CDN 加载。
 *
 * 用法：node tools/fetch-bqb-index.mjs
 * 输出：backend/src/main/resources/data/chinesebqb-index.json
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'backend/src/main/resources/data/chinesebqb-index.json')

const GITHUB = 'https://api.github.com/repos/zhaoolee/ChineseBQB/git/trees/master?recursive=1'
const GITEE = 'https://gitee.com/api/v5/repos/zhaoolee/ChineseBQB/git/trees/master?recursive=1'
const IMG_RE = /\.(gif|png|jpe?g|webp)$/i

/** 顶层系列名 → 中文中心词（"001Funny_滑稽大佬😏BQB" → "滑稽大佬"） */
function seriesWord(dir) {
  const m = decodeURIComponent(dir).match(/[\u4e00-\u9fa5]{2,}/)
  return m ? m[0] : ''
}

/** 文件名（去扩展名）→ 可读中文名（"00026-我裂开了" → "我裂开了"） */
function cleanName(file) {
  let base = basename(file).replace(/\.(gif|png|jpe?g|webp)$/i, '')
    .replace(/^\d{2,}-\s*/, '')
    .replace(/^\d{4,}/, '')
    .replace(/[_\-]\d{1,3}$/, '')
    .trim()
  if (!/[\u4e00-\u9fa5]/.test(base)) return ''
  return base.length > 24 ? base.slice(0, 24) : base
}

async function fetchTree(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'emoji-assistant' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  console.log('拉取 ChineseBQB 文件树…')
  let tree
  try {
    tree = await fetchTree(GITHUB)
  } catch (e) {
    console.warn(`  GitHub 不可达（${e.message}），改用 Gitee 镜像…`)
    tree = await fetchTree(GITEE)
  }
  if (!tree || !Array.isArray(tree.tree)) {
    throw new Error('trees API 返回异常：' + (tree && tree.message))
  }
  console.log(`  文件树 ${tree.tree.length} 条`)

  const entries = tree.tree
    .filter((n) => n.type === 'blob' && IMG_RE.test(n.path))
    .map((n) => {
      const seg = n.path.split('/')
      const series = seriesWord(seg[0] || '')
      const sub = seg[1] && !/^\d/.test(seg[1]) ? seriesWord(seg[1]) : ''
      const name = cleanName(n.path)
      return { p: n.path, s: series, u: sub, n: name }
    })
    .filter((e) => e.n) // 名称无中文、无法检索的跳过

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(entries), 'utf8')
  console.log(`  图片索引 ${entries.length} 条 → ${OUT}`)
  console.log(`  体积 ${(Buffer.byteLength(JSON.stringify(entries)) / 1024).toFixed(0)} KB`)
}

main().catch((e) => {
  console.error('失败:', e)
  process.exit(1)
})

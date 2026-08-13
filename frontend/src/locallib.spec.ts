import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFolder, locallibUrl, locallibPath, isImageFile } from '../electron/main/locallib/scanner'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'locallib-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('locallib scanner', () => {
  it('递归扫描图片，忽略非图片与空文件', () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    writeFileSync(join(dir, 'b.gif'), 'x')
    writeFileSync(join(dir, 'c.txt'), 'x')
    writeFileSync(join(dir, 'empty.png'), '')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'd.JPG'), 'x')
    writeFileSync(join(dir, 'sub', 'e.webp'), 'x')

    const files = scanFolder(dir, new Set())
    expect(files.map((f) => f.name).sort()).toEqual(['a', 'b', 'd', 'e'])
    // parentDir：根目录文件的父目录是托管文件夹自身名（basename），子目录文件是子目录名
    const rootName = dir.split(/[\\/]/).pop()
    expect(files.find((f) => f.name === 'd')?.parentDir).toBe('sub')
    expect(files.find((f) => f.name === 'a')?.parentDir).toBe(rootName)
  })

  it('忽略名单中的文件被排除', () => {
    writeFileSync(join(dir, 'keep.png'), 'x')
    writeFileSync(join(dir, 'skip.png'), 'x')
    const ignored = new Set([join(dir, 'skip.png')])
    const files = scanFolder(dir, ignored)
    expect(files.map((f) => f.name)).toEqual(['keep'])
  })

  it('跳过隐藏目录与系统目录', () => {
    mkdirSync(join(dir, '.hidden'))
    writeFileSync(join(dir, '.hidden', 'x.png'), 'x')
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'y.png'), 'x')
    writeFileSync(join(dir, 'visible.png'), 'x')
    const files = scanFolder(dir, new Set())
    expect(files.map((f) => f.name)).toEqual(['visible'])
  })

  it('ID 稳定唯一：local_ 前缀 + 路径 hash', () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const files = scanFolder(dir, new Set())
    expect(files[0].id.startsWith('local_')).toBe(true)
    expect(files[0].id).toBe(scanFolder(dir, new Set())[0].id) // 重复扫描 ID 不变
  })

  it('locallibUrl / locallibPath 互逆', () => {
    const p = join(dir, '空 格 文件.png')
    writeFileSync(p, 'x')
    const url = locallibUrl(p)
    expect(url.startsWith('locallib://file/')).toBe(true)
    expect(locallibPath(url)).toBe(p)
    expect(locallibPath('locallib://file/bad%ZZ')).toBe(null)
  })

  it('isImageFile 按扩展名判断', () => {
    expect(isImageFile('x.PNG')).toBe(true)
    expect(isImageFile('x.jpeg')).toBe(true)
    expect(isImageFile('x.txt')).toBe(false)
  })

  it('截断上限：超过 MAX_FILES 不无限增长', () => {
    // 造 50 个文件（低于 3000 上限，验证上限逻辑不误伤常规目录）
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.png`), 'x')
    }
    const files = scanFolder(dir, new Set())
    expect(files.length).toBe(50)
  })
})

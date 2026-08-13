import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveEmojiLocalPath, uploadRoot } from '../electron/main/locallib/scope-resolver'

describe('resolveEmojiLocalPath（上传库/收藏夹去重路径解析）', () => {
  it('上传 URL /uploads/... 映射到上传目录', () => {
    expect(resolveEmojiLocalPath('/uploads/2026/08/abc.png')).toBe(
      join(uploadRoot(), '2026', '08', 'abc.png')
    )
  })

  it('Windows 绝对路径原样返回（本地文件夹收藏复用）', () => {
    expect(resolveEmojiLocalPath('D:\\表情\\x.gif')).toBe('D:\\表情\\x.gif')
    expect(resolveEmojiLocalPath('C:/meme/y.png')).toBe('C:/meme/y.png')
  })

  it('种子 LOCAL（/static/...）与网络（http(s)）不可解析 → null', () => {
    expect(resolveEmojiLocalPath('/static/emojis/emoji-01.png')).toBeNull()
    expect(resolveEmojiLocalPath('https://example.com/a.png')).toBeNull()
    expect(resolveEmojiLocalPath('http://localhost:8080/a.png')).toBeNull()
  })

  it('空/异常输入 → null', () => {
    expect(resolveEmojiLocalPath('')).toBeNull()
    expect(resolveEmojiLocalPath(null as unknown as string)).toBeNull()
    expect(resolveEmojiLocalPath(undefined as unknown as string)).toBeNull()
  })

  it('uploadRoot 与后端默认一致（用户主目录）', () => {
    expect(uploadRoot()).toBe(join(homedir(), '.emoji-assistant', 'uploads'))
  })
})

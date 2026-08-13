import { describe, expect, it } from 'vitest'
import { applyDupKeep, buildDupGroup } from '@/utils/dupKeep'
import type { Emoji } from '@/types/emoji'

function localEmoji(id: string, duplicateOf?: string, name = `emo-${id}`): Emoji {
  return {
    id,
    name,
    url: `locallib://f/${id}`,
    tags: '',
    category: 'custom',
    hotScore: 0,
    source: 'FOLDER',
    createTime: '',
    localPath: `C:\\lib\\${id}.png`,
    parentDir: 'lib',
    duplicate: duplicateOf ? true : false,
    duplicateLevel: duplicateOf ? 'similar' : undefined,
    duplicateOf
  }
}

describe('applyDupKeep（保留选择过滤）', () => {
  it('无保留记录时原样返回', () => {
    const list = [localEmoji('rep'), localEmoji('a', 'rep'), localEmoji('b', 'rep')]
    expect(applyDupKeep(list, {})).toEqual(list)
  })

  it('保留成员后隐藏其余成员与组代表', () => {
    const list = [localEmoji('rep'), localEmoji('a', 'rep'), localEmoji('b', 'rep')]
    const out = applyDupKeep(list, { rep: 'a' })
    expect(out.map((e) => e.id)).toEqual(['a'])
  })

  it('保留组代表时隐藏全部成员', () => {
    const list = [localEmoji('rep'), localEmoji('a', 'rep'), localEmoji('b', 'rep')]
    const out = applyDupKeep(list, { rep: 'rep' })
    expect(out.map((e) => e.id)).toEqual(['rep'])
  })

  it('多组互不影响', () => {
    const list = [
      localEmoji('rep1'),
      localEmoji('a', 'rep1'),
      localEmoji('rep2'),
      localEmoji('b', 'rep2')
    ]
    const out = applyDupKeep(list, { rep1: 'a', rep2: 'rep2' })
    expect(out.map((e) => e.id)).toEqual(['a', 'rep2'])
  })

  it('非重复/未解决组不受影响', () => {
    const list = [localEmoji('x'), localEmoji('rep'), localEmoji('a', 'rep')]
    const out = applyDupKeep(list, { rep: 'a' })
    expect(out.map((e) => e.id)).toEqual(['x', 'a'])
  })
})

describe('buildDupGroup（组构建）', () => {
  const list = [localEmoji('rep'), localEmoji('a', 'rep'), localEmoji('b', 'rep'), localEmoji('other')]

  it('从成员定位组：返回组代表 + 全部成员，组代表在前', () => {
    const group = buildDupGroup(localEmoji('a', 'rep'), list)
    expect(group.map((e) => e.id)).toEqual(['rep', 'a', 'b'])
  })

  it('从组代表定位组：同样返回完整组', () => {
    const group = buildDupGroup(localEmoji('rep'), list)
    expect(group.map((e) => e.id)).toEqual(['rep', 'a', 'b'])
  })

  it('非重复文件只有自己', () => {
    const group = buildDupGroup(localEmoji('other'), list)
    expect(group.map((e) => e.id)).toEqual(['other'])
  })
})

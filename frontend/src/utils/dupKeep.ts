import type { Emoji } from '@/types/emoji'

/**
 * 重复组「保留选择」纯函数。
 * keepMap: { [组代表 id]: 保留的文件 id } —— 用户在对比面板选择保留哪张后，
 * 其余成员（含组代表本身）从本地列表中隐藏（本地持久化，不动磁盘）。
 */

/**
 * 应用保留选择：已解决（保留某张）的重复组，只显示被保留的那张，
 * 其余成员与组代表从列表隐藏。
 */
export function applyDupKeep(list: Emoji[], keepMap: Record<string, string>): Emoji[] {
  const repIds = Object.keys(keepMap)
  if (!repIds.length) return list
  const hidden = new Set<string | number>()
  for (const repId of repIds) {
    const keepId = keepMap[repId]
    for (const e of list) {
      const inGroup = String(e.duplicateOf) === repId || String(e.id) === repId
      if (inGroup && String(e.id) !== keepId) hidden.add(e.id)
    }
  }
  if (!hidden.size) return list
  return list.filter((e) => !hidden.has(e.id))
}

/**
 * 构建某文件所属的重复组：组代表（id === repId，无 duplicateOf）+ 所有标记
 * duplicateOf === repId 的成员。组代表排最前。
 */
export function buildDupGroup(target: Emoji, list: Emoji[]): Emoji[] {
  const repId = target.duplicateOf ?? String(target.id)
  const group = list.filter((e) => String(e.duplicateOf) === repId || String(e.id) === repId)
  return group.sort((a, b) => {
    const aRep = String(a.id) === repId ? 0 : 1
    const bRep = String(b.id) === repId ? 0 : 1
    return aRep - bRep
  })
}

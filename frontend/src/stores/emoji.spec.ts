import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEmojiStore } from './emoji'
import * as api from '@/api/emoji'
import type { Emoji, PageResult } from '@/types/emoji'

vi.mock('@/api/emoji', () => ({
  searchEmojis: vi.fn(),
  getHotEmojis: vi.fn(),
  getByCategory: vi.fn(),
  getRecentEmojis: vi.fn(),
  getFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  uploadEmoji: vi.fn(),
  deleteEmoji: vi.fn(),
  getSearchHistory: vi.fn(),
  clearSearchHistory: vi.fn()
}))

const mockedApi = vi.mocked(api)

function emoji(id: number, source = 'LOCAL'): Emoji {
  return {
    id,
    name: `e${id}`,
    url: `/static/${id}.png`,
    tags: '',
    category: 'custom',
    hotScore: 0,
    source,
    createTime: ''
  }
}

function pageOf(records: Emoji[], total: number, page: number): PageResult<Emoji> {
  return { records, total, page, size: 24 }
}

describe('useEmojiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('loadTab 切到热门：最近使用在前 + 热门补足（去重）', async () => {
    mockedApi.getRecentEmojis.mockResolvedValue([emoji(2), emoji(3)])
    mockedApi.getHotEmojis.mockResolvedValue([emoji(1), emoji(2), emoji(3), emoji(4)])
    const store = useEmojiStore()

    await store.loadTab('hot')

    expect(store.activeTab).toBe('hot')
    expect(store.emojis.map((e) => e.id)).toEqual([2, 3, 1, 4])
    expect(store.total).toBe(4)
    expect(store.hasMore).toBe(false)
  })

  it('loadTab 热门：无最近使用时退化为纯热门', async () => {
    mockedApi.getRecentEmojis.mockResolvedValue([])
    mockedApi.getHotEmojis.mockResolvedValue([emoji(1), emoji(2)])
    const store = useEmojiStore()

    await store.loadTab('hot')

    expect(store.emojis.map((e) => e.id)).toEqual([1, 2])
    expect(store.total).toBe(2)
  })

  it('search 替换结果并重置高亮页码', async () => {
    mockedApi.searchEmojis.mockResolvedValue(pageOf([emoji(1)], 1, 1))
    const store = useEmojiStore()

    await store.search('猫')

    expect(store.emojis).toHaveLength(1)
    expect(store.page).toBe(1)
    expect(store.total).toBe(1)
    expect(store.hasMore).toBe(false)
  })

  it('search append 追加下一页结果', async () => {
    mockedApi.searchEmojis
      .mockResolvedValueOnce(pageOf([emoji(1)], 3, 1))
      .mockResolvedValueOnce(pageOf([emoji(2), emoji(3)], 3, 2))
    const store = useEmojiStore()

    await store.search('猫')
    expect(store.emojis).toHaveLength(1)
    expect(store.hasMore).toBe(true)

    store.keyword = '猫'
    await store.loadMore()
    expect(store.emojis).toHaveLength(3)
    expect(store.page).toBe(2)
    expect(store.hasMore).toBe(false)
  })

  it('loadMore 无更多时不发请求', async () => {
    mockedApi.searchEmojis.mockResolvedValue(pageOf([emoji(1)], 1, 1))
    const store = useEmojiStore()

    await store.search('猫')
    await store.loadMore()

    expect(mockedApi.searchEmojis).toHaveBeenCalledTimes(1)
  })

  it('搜索竞态：慢请求后到不覆盖新结果（请求序号丢弃过期响应）', async () => {
    let resolveFirst!: (v: PageResult<Emoji>) => void
    const first = new Promise<PageResult<Emoji>>((r) => {
      resolveFirst = r
    })
    // 第一次搜索（慢）挂起，第二次搜索（快）先返回
    mockedApi.searchEmojis.mockReturnValueOnce(first as any)
    mockedApi.searchEmojis.mockResolvedValueOnce(pageOf([emoji(99)], 1, 1))
    const store = useEmojiStore()

    const p1 = store.search('慢')
    await store.search('快')
    // 快请求已落地：显示“快”的结果
    expect(store.emojis.map((e) => e.id)).toEqual([99])

    // 慢请求后到，应被丢弃，不覆盖新结果
    resolveFirst(pageOf([emoji(1)], 5, 1))
    await p1
    expect(store.emojis.map((e) => e.id)).toEqual([99])
    expect(store.total).toBe(1)
  })

  it('搜索竞态：切换标签后过期搜索响应不覆盖新标签数据', async () => {
    let resolveSearch!: (v: PageResult<Emoji>) => void
    const pendingSearch = new Promise<PageResult<Emoji>>((r) => {
      resolveSearch = r
    })
    mockedApi.searchEmojis.mockReturnValueOnce(pendingSearch as any)
    mockedApi.getFavorites.mockResolvedValue([emoji(7)])
    const store = useEmojiStore()

    const p = store.search('挂起')
    await store.loadTab('favorite')
    expect(store.emojis.map((e) => e.id)).toEqual([7])

    resolveSearch(pageOf([emoji(1)], 5, 1))
    await p
    // 过期搜索响应不覆盖收藏页数据
    expect(store.emojis.map((e) => e.id)).toEqual([7])
  })

  it('toggleFavorite 添加后移除', async () => {
    mockedApi.addFavorite.mockResolvedValue(undefined)
    mockedApi.removeFavorite.mockResolvedValue(undefined)
    const store = useEmojiStore()

    await store.toggleFavorite(emoji(5))
    expect(store.favoriteIds.has(5)).toBe(true)

    await store.toggleFavorite(emoji(5))
    expect(store.favoriteIds.has(5)).toBe(false)
  })

  it('收藏页取消收藏时从列表移除', async () => {
    mockedApi.removeFavorite.mockResolvedValue(undefined)
    const store = useEmojiStore()

    await store.loadTab('favorite')
    mockedApi.getFavorites.mockResolvedValue([emoji(5)])
    await store.loadTab('favorite')
    store.favoriteIds = new Set([5])
    store.emojis = [emoji(5)]
    store.total = 1

    await store.toggleFavorite(emoji(5))

    expect(store.emojis).toHaveLength(0)
    expect(store.total).toBe(0)
  })

  it('removeEmojiFromList 删除后总量减一', async () => {
    const store = useEmojiStore()
    store.emojis = [emoji(1), emoji(2)]
    store.total = 2

    store.removeEmojiFromList(1)

    expect(store.emojis).toHaveLength(1)
    expect(store.total).toBe(1)
  })

  it('网络源表情不可收藏', async () => {
    const store = useEmojiStore()
    await store.toggleFavorite(emoji(5, 'GIPHY'))
    expect(store.favoriteIds.has(5)).toBe(false)
    expect(mockedApi.addFavorite).not.toHaveBeenCalled()
  })

  it('reanalyzeAllScopes：文件夹(强制) + 上传库 + 收藏夹依次重新分析', async () => {
    mockedApi.getByCategory.mockResolvedValue(pageOf([emoji(1, 'UPLOAD')], 1, 1))
    mockedApi.getFavorites.mockResolvedValue([emoji(2, 'UPLOAD')])
    const apiMock = {
      reanalyzeLocallib: vi.fn().mockResolvedValue(true),
      analyzeLocallibScope: vi.fn().mockResolvedValue([])
    }
    ;(window as any).api = apiMock
    const store = useEmojiStore()

    await store.reanalyzeAllScopes()

    // 文件夹强制清缓存重算 + 上传库 + 收藏夹
    expect(apiMock.reanalyzeLocallib).toHaveBeenCalledTimes(1)
    expect(apiMock.analyzeLocallibScope).toHaveBeenCalledWith('upload', expect.any(Array))
    expect(apiMock.analyzeLocallibScope).toHaveBeenCalledWith('favorite', expect.any(Array))
    // 上传库被拉全量并填入 uploadEmojis
    expect(store.uploadEmojis.map((e) => e.id)).toEqual([1])
    ;(window as any).api = undefined
  })

  it('removeAllDuplicates：跨库批量删除重复副本，保留各组代表', async () => {
    mockedApi.deleteEmoji.mockResolvedValue(undefined)
    const store = useEmojiStore()
    // 上传库：组1 代表=1，副本=2,3；本地库：组2 代表=local_abc，副本=local_def
    store.uploadEmojis = [
      emoji(1, 'UPLOAD'),
      { ...emoji(2, 'UPLOAD'), duplicate: true, duplicateLevel: 'high', duplicateOf: '1', similarity: 100 },
      { ...emoji(3, 'UPLOAD'), duplicate: true, duplicateLevel: 'similar', duplicateOf: '1', similarity: 92 }
    ]
    store.localEmojis = [
      { ...emoji(4, 'FOLDER'), id: 'local_abc', localPath: '/x/a.png' },
      {
        ...emoji(5, 'FOLDER'),
        id: 'local_def',
        localPath: '/x/b.png',
        duplicate: true,
        duplicateLevel: 'high',
        duplicateOf: 'local_abc',
        similarity: 100
      }
    ]
    // 副本统计：2 张上传 + 1 张本地
    expect(store.dupAllCopies).toBe(3)

    const removed = await store.removeAllDuplicates()

    expect(removed).toBe(3)
    expect(mockedApi.deleteEmoji).toHaveBeenCalledWith(2)
    expect(mockedApi.deleteEmoji).toHaveBeenCalledWith(3)
    expect(mockedApi.deleteEmoji).not.toHaveBeenCalledWith(1) // 组代表保留
    expect(store.uploadEmojis.map((e) => e.id)).toEqual([1])
  })
})
import { http } from './http'
import type { Emoji, PageResult, SearchHistoryItem } from '@/types/emoji'

/** 关键词搜索（MySQL 模糊搜索，含名称/标签/分类） */
export function searchEmojis(keyword: string, page = 1, size = 24): Promise<PageResult<Emoji>> {
  return http.get('/api/emoji/search', { params: { keyword, page, size } }).then((r) => r.data.data)
}

/** 热门表情（按 hot_score 排序） */
export function getHotEmojis(size = 24): Promise<Emoji[]> {
  return http.get('/api/emoji/hot', { params: { size } }).then((r) => r.data.data)
}

/** 按分类获取表情 */
export function getByCategory(category: string, page = 1, size = 24): Promise<PageResult<Emoji>> {
  return http.get(`/api/emoji/category/${category}`, { params: { page, size } }).then((r) => r.data.data)
}

/** 网络梗图库浏览（无关键词随机抽取，供「梗图库」标签使用；不入库不可收藏） */
export function browseNetworkEmojis(count = 36): Promise<Emoji[]> {
  return http.get('/api/emoji/network/browse', { params: { count } }).then((r) => r.data.data)
}

/** 最近使用 */
export function getRecentEmojis(size = 24): Promise<Emoji[]> {
  return http.get('/api/emoji/recent', { params: { size } }).then((r) => r.data.data)
}

/** 收藏列表 */
export function getFavorites(): Promise<Emoji[]> {
  return http.get('/api/favorite/list').then((r) => r.data.data)
}

/** 添加收藏 */
export function addFavorite(emojiId: number): Promise<void> {
  return http.post('/api/favorite', { emojiId }).then((r) => r.data)
}

/** 取消收藏 */
export function removeFavorite(emojiId: number): Promise<void> {
  return http.delete(`/api/favorite/${emojiId}`).then((r) => r.data)
}

/** 上传自定义表情（multipart），返回创建后的表情记录 */
export function uploadEmoji(file: File): Promise<Emoji> {
  const form = new FormData()
  form.append('file', file)
  return http
    .post('/api/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((r) => r.data.data)
}

/** 删除自定义上传的表情 */
export function deleteEmoji(emojiId: number): Promise<void> {
  return http.delete(`/api/emoji/${emojiId}`).then((r) => r.data)
}

/** 最近搜索历史（最多 limit 条） */
export function getSearchHistory(limit = 10): Promise<SearchHistoryItem[]> {
  return http.get('/api/search-history', { params: { limit } }).then((r) => r.data.data)
}

/** 清空搜索历史 */
export function clearSearchHistory(): Promise<void> {
  return http.delete('/api/search-history').then((r) => r.data)
}

/** 表情包实体（与后端 Emoji 对应；本地文件夹文件也以 Emoji 形式展示） */
export interface Emoji {
  /** 后端记录为正整数；本地文件夹文件为 local_xxx 字符串 */
  id: number | string
  name: string
  /** 相对路径（如 /static/emojis/xx.png）、完整 URL 或 locallib:// 协议地址 */
  url: string
  /** 逗号分隔的标签 */
  tags: string
  /** 分类 code：funny / animal / emoji / custom */
  category: string
  hotScore: number
  /** 来源：LOCAL / UPLOAD / FOLDER（本地文件夹托管） / NETWORK */
  source: string
  createTime: string
  /** AI 语义搜索相似度（0~1，仅语义推荐结果有值，用于显示"AI 推荐"角标） */
  semanticScore?: number
  /** 本地文件夹文件的真实磁盘路径（点击发送时传给 clipboard 本地路径分支） */
  localPath?: string
  /** 本地文件夹文件的直接父目录名（本地搜索范围之一） */
  parentDir?: string
  /** 重复检测：是否被标记为重复（本地库相似/高度相似） */
  duplicate?: boolean
  /** 重复等级：high=高度相似（红角标），similar=相似（黄角标） */
  duplicateLevel?: 'high' | 'similar'
  /** 组代表文件的 id（此文件与它重复/相似） */
  duplicateOf?: string
  /** 与组代表的相似度百分比（0~100；汉明距离换算，md5 精确重复为 100） */
  similarity?: number
}

/** 分页结果 */
export interface PageResult<T> {
  records: T[]
  total: number
  page: number
  size: number
}

/** 面板标签（虚拟分类 + 真实分类，单行导航） */
export type PanelTab =
  | 'hot'
  | 'bqb'
  | 'funny'
  | 'animal'
  | 'emoji'
  | 'custom'
  | 'favorite'
  | 'recent'

/** 搜索历史条目（后端 SearchHistory 去重后的最近关键词） */
export interface SearchHistoryItem {
  keyword: string
  createTime: string
}

/**
 * 单行导航标签定义。
 * icon 为 @element-plus/icons-vue 的组件名（CategoryMenu 中映射渲染），
 * 用线性 SVG 图标而非 emoji，保证专业质感。
 */
export const PANEL_TABS: { key: PanelTab; label: string; icon: string }[] = [
  { key: 'hot', label: '热门', icon: 'TrendCharts' },
  { key: 'bqb', label: '梗图库', icon: 'Collection' },
  { key: 'funny', label: '搞笑', icon: 'ChatLineRound' },
  { key: 'animal', label: '动物', icon: 'Picture' },
  { key: 'emoji', label: '表情', icon: 'Sunny' },
  { key: 'custom', label: '自定义', icon: 'Folder' },
  { key: 'favorite', label: '收藏', icon: 'Star' },
  { key: 'recent', label: '最近', icon: 'Clock' }
]

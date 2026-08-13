<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Check, Delete } from '@element-plus/icons-vue'
import { useEmojiStore } from '@/stores/emoji'
import { resolveImageUrl } from '@/api/http'
import type { Emoji } from '@/types/emoji'

const store = useEmojiStore()

const group = computed(() => store.compareGroup)
const repId = computed(() => store.compareRepId)
/** 组内最高相似度（组代表 = 基准 100%，成员取各自的与代表相似度） */
const maxSim = computed(() => {
  let m = 100
  for (const e of group.value) {
    if (e.similarity != null && e.similarity > m) m = e.similarity
  }
  return m
})
/** 某卡片的相似度显示值：组代表 = 基准 100%，其余 = 与代表相似度（无标记则为 null） */
const simOf = (e: Emoji): number | null => (isRep(e) ? 100 : e.similarity ?? null)
/** 当前选中的保留项（默认 = 已保存的保留记录，无则组代表） */
const keepId = ref('')

// 面板每次打开时初始化默认选择
watch(
  () => store.compareOpen,
  (open) => {
    if (open) {
      keepId.value = store.compareKeepId || repId.value || String(group.value[0]?.id ?? '')
    }
  }
)

const isRep = (e: Emoji): boolean => String(e.id) === repId.value
const isKept = (e: Emoji): boolean => String(e.id) === keepId.value
/** 移出动作按来源分流：UPLOAD → 删除上传记录；FOLDER → 加入忽略名单（磁盘文件均保留） */
const uploadOthersCount = computed(
  () => group.value.filter((e) => e.source === 'UPLOAD' && String(e.id) !== keepId.value).length
)
const folderOthersCount = computed(
  () => group.value.filter((e) => e.source === 'FOLDER' && String(e.id) !== keepId.value).length
)
function othersDesc(): string {
  const parts: string[] = []
  if (uploadOthersCount.value) parts.push(`${uploadOthersCount.value} 张相似上传记录将被删除（磁盘文件保留）`)
  if (folderOthersCount.value) parts.push(`${folderOthersCount.value} 张相似本地文件将从本地库移除（磁盘文件保留）`)
  return parts.join('；')
}

function selectKeep(e: Emoji): void {
  keepId.value = String(e.id)
}

/** 保留此张，其余隐藏 */
function onKeepHide(): void {
  if (!keepId.value) return
  store.keepInGroup(repId.value, keepId.value)
  ElMessage.success('已保留所选，其余相似图已隐藏')
}

/** 保留此张，其余移出本地库（跨库组按来源分别处理，磁盘文件均保留） */
async function onKeepRemove(): Promise<void> {
  if (!keepId.value) return
  const others = group.value.filter((e) => String(e.id) !== keepId.value).length
  if (!others) return
  try {
    await ElMessageBox.confirm(
      `将保留所选图片，其余 ${others} 张相似图：${othersDesc()}。确定？`,
      '移出本地库',
      { confirmButtonText: '移出', cancelButtonText: '取消', type: 'warning' }
    )
    await store.removeOthersFromLibrary(repId.value, keepId.value)
    ElMessage.success(`已保留所选，${others} 张相似图已移出本地库`)
  } catch {
    /* 用户取消 */
  }
}

/** 删除本地库中全部重复副本（保留各组代表/已选保留项），带确认与进度提示 */
async function onBatchRemoveAll(): Promise<void> {
  const n = store.dupAllCopies
  if (!n) {
    ElMessage.info('本地库没有可清理的重复副本')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将删除本地库中全部 ${n} 张重复副本（每组保留代表；上传记录删除、本地文件移出本地库，磁盘文件均保留）。确定？`,
      '删除全部重复副本',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const removed = await store.removeAllDuplicates()
    if (removed) ElMessage.success(`已删除 ${removed} 张重复副本，每组保留代表`)
  } catch {
    /* 用户取消 */
  }
}
</script>

<template>
  <Transition name="compare-fade">
    <div v-if="store.compareOpen" class="compare-mask" @click.self="store.closeDuplicateCompare">
      <div class="compare-panel" @click.stop>
        <header class="compare-header">
          <div class="compare-title">
            相似图对比
            <span class="compare-count">{{ group.length }} 张 · 最高相似 {{ maxSim }}%</span>
          </div>
          <button class="compare-close" title="关闭" @click="store.closeDuplicateCompare">
            <el-icon :size="14"><Close /></el-icon>
          </button>
        </header>
        <p class="compare-sub">以下图片被检测为相似/重复，点击选择要保留的一张：</p>

        <div class="compare-grid">
          <div
            v-for="e in group"
            :key="e.id"
            class="compare-card"
            :class="{ kept: isKept(e) }"
            @click="selectKeep(e)"
          >
            <el-image :src="resolveImageUrl(e.url)" fit="cover" class="compare-img" lazy />
            <span v-if="isRep(e)" class="compare-tag rep" title="该组代表（排序最靠前的文件）">代表</span>
            <span v-if="isKept(e)" class="compare-check"><el-icon :size="12"><Check /></el-icon></span>
            <div class="compare-info">
              <span class="compare-name" :title="e.name">{{ e.name }}</span>
              <span class="compare-dir" :title="e.parentDir">{{ e.parentDir }}</span>
              <span v-if="simOf(e) != null" class="compare-sim" :class="{ rep: isRep(e) }">
                {{ isRep(e) ? '基准 · 100%' : `与代表相似度 ${simOf(e)}%` }}
              </span>
            </div>
          </div>
        </div>

        <footer class="compare-footer">
          <span class="compare-tip">保留所选后，其余将隐藏或移出本地库</span>
          <div class="compare-actions">
            <el-button size="small" @click="store.closeDuplicateCompare">取消</el-button>
            <el-button size="small" type="danger" plain @click="onKeepRemove">
              <el-icon :size="12"><Delete /></el-icon>
              <span style="margin-left: 3px">移出本地库</span>
            </el-button>
            <el-button size="small" type="primary" @click="onKeepHide">保留此张，隐藏其余</el-button>
          </div>
        </footer>

        <!-- 全库批量清理：删除全部重复副本（保留各组代表），带确认与进度 -->
        <div class="compare-batch">
          <el-button size="small" type="danger" plain :disabled="store.batchRemove.running" @click="onBatchRemoveAll">
            <el-icon :size="12"><Delete /></el-icon>
            <span style="margin-left: 3px">删除本地库中全部重复副本{{ store.dupAllCopies ? `（${store.dupAllCopies}）` : '' }}</span>
          </el-button>
          <div v-if="store.batchRemove.running" class="batch-progress">
            <el-progress
              :percentage="Math.round((store.batchRemove.done / store.batchRemove.total) * 100)"
              :stroke-width="5"
              :show-text="false"
            />
            <span class="batch-progress-text">正在清理 {{ store.batchRemove.done }}/{{ store.batchRemove.total }}</span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 遮罩：覆盖整个面板（与 onboard-mask 同层级），点击空白关闭 */
.compare-mask {
  position: absolute;
  inset: 0;
  z-index: 450;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg, #0f1220) 45%, transparent);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  -webkit-app-region: no-drag;
}
.compare-fade-enter-active,
.compare-fade-leave-active {
  transition: opacity 0.16s ease;
}
.compare-fade-enter-from,
.compare-fade-leave-to {
  opacity: 0;
}

/* 面板：玻璃卡片，比网格宽一档 */
.compare-panel {
  width: min(560px, 88%);
  max-height: 78%;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  border-radius: var(--radius-xl);
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
  animation: compare-pop 0.18s ease-out;
}
@keyframes compare-pop {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.compare-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.compare-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
}
.compare-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  background: var(--surface-strong);
  padding: 1px 8px;
  border-radius: 999px;
  margin-left: 6px;
}
.compare-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.compare-close:hover {
  background: var(--surface-strong);
  color: var(--text-1);
}
.compare-sub {
  margin: 6px 0 10px;
  font-size: 11.5px;
  color: var(--text-3);
}

/* 相似图网格：卡片可点选，选中项主题色描边 + 对勾 */
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  overflow-y: auto;
  padding: 2px 2px 8px;
  min-height: 0;
}
.compare-card {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  border: 2px solid var(--border);
  background: var(--surface);
  transition: border-color 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease;
}
.compare-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}
.compare-card.kept {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 6px 18px color-mix(in srgb, var(--accent) 28%, transparent);
}
.compare-img {
  width: 100%;
  height: 100%;
}
/* 组代表 / 选中标记 */
.compare-tag.rep {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  font-size: 8px;
  font-weight: 700;
  color: #fff;
  background: rgba(15, 23, 42, 0.72);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  letter-spacing: 0.4px;
}
.compare-check {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35);
}
.compare-info {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 10px 6px 4px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.62), transparent 75%);
}
.compare-name {
  font-size: 9.5px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.compare-dir {
  font-size: 8.5px;
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 相似度百分比：与代表有多像（组代表 = 基准 100%） */
.compare-sim {
  font-size: 8px;
  font-weight: 700;
  color: #fbbf24;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.compare-sim.rep {
  color: rgba(255, 255, 255, 0.85);
}

.compare-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.compare-tip {
  font-size: 10.5px;
  color: var(--text-3);
  flex-shrink: 1;
}
.compare-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 全库批量清理行：与主操作区分（虚线分隔），进度条铺满剩余空间 */
.compare-batch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 10px;
  margin-top: 8px;
  border-top: 1px dashed var(--border);
}
.batch-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.batch-progress :deep(.el-progress) {
  flex: 1;
  margin: 0;
}
.batch-progress-text {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}
</style>

package com.emojiassistant.task;

import com.emojiassistant.config.AppProperties;
import com.emojiassistant.mapper.EmojiMapper;
import com.emojiassistant.mapper.SearchHistoryMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 数据维护任务（每日凌晨执行，失败不影响主流程）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataMaintenanceTask {

    /** 搜索历史每个用户保留条数 */
    private static final int KEEP_SEARCH_HISTORY = 50;

    private final SearchHistoryMapper searchHistoryMapper;
    private final EmojiMapper emojiMapper;
    private final AppProperties appProperties;

    /** 每天 03:30：清理超量搜索历史 + 热度时间衰减 */
    @Scheduled(cron = "0 30 3 * * *")
    public void maintain() {
        trimSearchHistory();
        decayHotScore();
    }

    /** 搜索历史只保留最近 KEEP_SEARCH_HISTORY 条，防止无限增长 */
    private void trimSearchHistory() {
        try {
            int removed = searchHistoryMapper.trimHistory(appProperties.getDefaultUserId(), KEEP_SEARCH_HISTORY);
            log.info("搜索历史清理完成，删除 {} 条（保留最近 {} 条）", removed, KEEP_SEARCH_HISTORY);
        } catch (Exception e) {
            log.warn("搜索历史清理失败（忽略）: {}", e.getMessage());
        }
    }

    /** 热度时间衰减：每日乘以 0.9，让老表情自然降温、新表情有机会上榜 */
    private void decayHotScore() {
        try {
            int affected = emojiMapper.decayHotScore();
            log.info("热度衰减完成，影响 {} 行", affected);
        } catch (Exception e) {
            log.warn("热度衰减失败（忽略）: {}", e.getMessage());
        }
    }
}

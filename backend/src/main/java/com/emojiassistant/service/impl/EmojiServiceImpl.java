package com.emojiassistant.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emojiassistant.common.BusinessException;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.entity.RecentUse;
import com.emojiassistant.entity.SearchHistory;
import com.emojiassistant.mapper.EmojiMapper;
import com.emojiassistant.mapper.FavoriteMapper;
import com.emojiassistant.mapper.RecentUseMapper;
import com.emojiassistant.mapper.SearchHistoryMapper;
import com.emojiassistant.search.EmojiSearchService;
import com.emojiassistant.search.NetworkEmojiSearchService;
import com.emojiassistant.search.NetworkSourceHealth;
import com.emojiassistant.search.SemanticSearchService;
import com.emojiassistant.service.EmojiService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 表情业务实现。
 * Redis 缓存热门/最近使用；Redis 不可用时自动降级为直查数据库，不影响主流程。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmojiServiceImpl implements EmojiService {

    private static final String HOT_CACHE_KEY = "emoji:hot";
    private static final String RECENT_CACHE_PREFIX = "emoji:recent:";
    private static final Duration HOT_CACHE_TTL = Duration.ofSeconds(60);
    private static final Duration RECENT_CACHE_TTL = Duration.ofMinutes(10);
    /** 热门列表缓存条数上限（允许一次展示更多表情） */
    private static final int HOT_CACHE_SIZE = 100;

    /** 网络搜索结果缓存（按关键词）：命中期内不重复调第三方接口，省共享频次、平滑限流 */
    private static final Duration NETWORK_CACHE_TTL = Duration.ofSeconds(45);
    /** 限流/空结果时短暂缓存，避免短时间重复请求把共享频次打满 */
    private static final Duration NETWORK_CACHE_EMPTY_TTL = Duration.ofSeconds(12);
    private final Map<String, NetworkCacheEntry> networkCache = new ConcurrentHashMap<>();

    /** 网络结果缓存条目 */
    private static class NetworkCacheEntry {
        final List<Emoji> list;
        final long expireAt;
        NetworkCacheEntry(List<Emoji> list, long expireAt) {
            this.list = list;
            this.expireAt = expireAt;
        }
    }

    private final EmojiMapper emojiMapper;
    private final RecentUseMapper recentUseMapper;
    private final FavoriteMapper favoriteMapper;
    private final SearchHistoryMapper searchHistoryMapper;
    private final EmojiSearchService emojiSearchService;
    private final SemanticSearchService semanticSearchService;
    private final List<NetworkEmojiSearchService> networkSearchServices;
    private final NetworkSourceHealth networkSourceHealth;
    private final NetworkSearchProperties networkSearchProperties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final AppProperties appProperties;

    @Override
    public Page<Emoji> search(String keyword, int page, int size, String userId) {
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return new Page<>(page, size);
        }
        recordSearchHistory(userId, kw);
        Page<Emoji> result = emojiSearchService.search(kw, page, size);
        // AI 语义搜索增强：第一页在关键词结果后追加语义相似表情（去重，不虚增 total）
        if (page <= 1) {
            mergeSemanticResults(result, kw);
        }
        mergeNetworkResults(result, kw, page);
        return result;
    }

    /**
     * 语义搜索增强：用本地向量相似度补充关键词结果。
     * 关键词命中的在前（更精确），语义候选按相似度排序去重后追加在后，并带上
     * semanticScore（供前端展示"AI 推荐"角标与相似度百分比）。
     * 关键词无命中时语义候选即成为主要结果（自然语言查询场景）。
     * 任何异常静默降级，不影响原有关键词搜索。
     */
    private void mergeSemanticResults(Page<Emoji> result, String keyword) {
        try {
            List<SemanticSearchService.SemanticHit> hits =
                    semanticSearchService.searchWithScore(keyword, SemanticSearchService.DEFAULT_LIMIT);
            if (hits.isEmpty()) {
                return;
            }
            Set<Long> seen = new HashSet<>();
            for (Emoji e : result.getRecords()) {
                seen.add(e.getId());
            }
            List<Emoji> merged = new ArrayList<>(result.getRecords());
            for (SemanticSearchService.SemanticHit hit : hits) {
                if (seen.add(hit.emoji().getId())) {
                    hit.emoji().setSemanticScore((double) hit.score());
                    merged.add(hit.emoji());
                }
            }
            result.setRecords(merged);
        } catch (Exception e) {
            log.debug("语义搜索异常（忽略，不影响关键词搜索）: {}", e.getMessage());
        }
    }

    /**
     * 关键词搜索时合并网络图库结果（Giphy/Tenor 等）：本地结果在前，网络结果在后。
     * 仅第一页合并；网络结果不入库（id 为合成负值，用于前端列表 key）。
     * 各来源并发请求（互不阻塞、总耗时≈最慢来源）；任一异常/超时/未配置 key 均静默降级。
     */
    private void mergeNetworkResults(Page<Emoji> result, String keyword, int page) {
        if (page > 1 || !networkSearchProperties.isEnabled()) {
            return;
        }
        String cacheKey = keyword.trim().toLowerCase(Locale.ROOT);
        List<Emoji> network = getNetworkCache(cacheKey);
        if (network == null) {
            network = fetchNetworkResults(keyword);
            putNetworkCache(cacheKey, network);
        }
        if (!network.isEmpty()) {
            List<Emoji> merged = new ArrayList<>(result.getRecords());
            merged.addAll(network);
            result.setRecords(merged);
            result.setTotal(result.getTotal() + network.size());
        }
    }

    /** 并发请求各启用来源；任一来源异常/限流均静默降级（返回空列表不影响主流程） */
    private List<Emoji> fetchNetworkResults(String keyword) {
        List<Emoji> network = new ArrayList<>();
        List<CompletableFuture<List<Emoji>>> futures = new ArrayList<>();
        for (NetworkEmojiSearchService svc : networkSearchServices) {
            // 临时抽风/熔断中的来源自动跳过（healthy() 由熔断器驱动）
            if (svc.enabled() && svc.healthy()) {
                futures.add(CompletableFuture
                        .supplyAsync(() -> safeNetworkSearch(svc, keyword))
                        .orTimeout(networkSearchProperties.getTimeoutMs(), TimeUnit.MILLISECONDS));
            }
        }
        for (CompletableFuture<List<Emoji>> future : futures) {
            try {
                List<Emoji> hits = future.join();
                if (hits != null && !hits.isEmpty()) {
                    network.addAll(hits);
                }
            } catch (Exception e) {
                log.debug("网络搜索异常（忽略）: {}", e.getMessage());
            }
        }
        return network;
    }

    /** 网络来源单个请求包装：任何异常转为空列表（供并行任务内部消化，不向上抛出） */
    private List<Emoji> safeNetworkSearch(NetworkEmojiSearchService svc, String keyword) {
        try {
            return svc.search(keyword, networkSearchProperties.getLimit());
        } catch (Exception e) {
            log.warn("[{}] 网络搜索异常（忽略）: {}", svc.name(), e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * 网络图库浏览（无关键词）：并发生成各启用来源的随机推荐，去重后收敛到 count 条。
     * 网络总开关关闭或所有来源不可用时返回空列表（前端「梗图库」标签显示为空态）。
     */
    @Override
    public List<Emoji> browseNetwork(int count) {
        if (!networkSearchProperties.isEnabled() || count <= 0) {
            return List.of();
        }
        List<CompletableFuture<List<Emoji>>> futures = new ArrayList<>();
        for (NetworkEmojiSearchService svc : networkSearchServices) {
            // 临时抽风/熔断中的来源自动跳过
            if (svc.enabled() && svc.healthy()) {
                futures.add(CompletableFuture
                        .supplyAsync(() -> safeNetworkBrowse(svc, count))
                        .orTimeout(networkSearchProperties.getTimeoutMs(), TimeUnit.MILLISECONDS));
            }
        }
        List<Emoji> out = new ArrayList<>(Math.min(count, 64));
        Set<Long> seen = new HashSet<>();
        for (CompletableFuture<List<Emoji>> future : futures) {
            try {
                for (Emoji e : future.join()) {
                    if (seen.add(e.getId())) {
                        out.add(e);
                        if (out.size() >= count) {
                            return out;
                        }
                    }
                }
            } catch (Exception e) {
                log.debug("网络浏览异常（忽略）: {}", e.getMessage());
            }
        }
        return out;
    }

    /** 网络来源单个浏览请求包装：任何异常转为空列表 */
    private List<Emoji> safeNetworkBrowse(NetworkEmojiSearchService svc, int count) {
        try {
            return svc.browse(count);
        } catch (Exception e) {
            log.warn("[{}] 网络浏览异常（忽略）: {}", svc.name(), e.getMessage());
            return Collections.emptyList();
        }
    }

    /* ---------- 网络结果缓存 ---------- */

    private List<Emoji> getNetworkCache(String key) {
        NetworkCacheEntry entry = networkCache.get(key);
        if (entry == null) {
            return null;
        }
        if (System.currentTimeMillis() >= entry.expireAt) {
            networkCache.remove(key);
            return null;
        }
        return entry.list;
    }

    private void putNetworkCache(String key, List<Emoji> list) {
        if (networkCache.size() > 200) {
            networkCache.clear();
        }
        long ttl = list.isEmpty() ? NETWORK_CACHE_EMPTY_TTL.toMillis() : NETWORK_CACHE_TTL.toMillis();
        networkCache.put(key, new NetworkCacheEntry(list, System.currentTimeMillis() + ttl));
    }

    @Override
    public List<Emoji> hot(int size) {
        int limit = Math.min(Math.max(size, 1), 100);
        // 1. 尝试读缓存
        String cached = readCache(HOT_CACHE_KEY);
        if (cached != null) {
            List<Emoji> list = parseEmojiList(cached);
            if (!list.isEmpty()) {
                return list.size() > limit ? list.subList(0, limit) : list;
            }
        }
        // 2. 缓存未命中，查库并回填
        List<Emoji> list = emojiMapper.selectHot(HOT_CACHE_SIZE);
        writeCache(HOT_CACHE_KEY, list, HOT_CACHE_TTL);
        return list.size() > limit ? list.subList(0, limit) : list;
    }

    @Override
    public Page<Emoji> byCategory(String category, int page, int size) {
        String cat = category == null ? "" : category.trim();
        if (cat.isEmpty() || "hot".equals(cat)) {
            List<Emoji> list = hot(size);
            Page<Emoji> result = new Page<>(page, size);
            result.setTotal(list.size());
            result.setRecords(list);
            return result;
        }
        long pageNo = Math.max(page, 1);
        long pageSize = Math.min(Math.max(size, 1), 100);
        Page<Emoji> result = new Page<>(pageNo, pageSize);
        result.setTotal(emojiMapper.countByCategory(cat));
        result.setRecords(emojiMapper.selectByCategory(cat, (pageNo - 1) * pageSize, pageSize));
        return result;
    }

    @Override
    public List<Emoji> recent(String userId, int size) {
        int limit = Math.min(Math.max(size, 1), 100);
        String key = RECENT_CACHE_PREFIX + userId;
        String cached = readCache(key);
        if (cached != null) {
            List<Emoji> list = parseEmojiList(cached);
            if (!list.isEmpty()) {
                return list.size() > limit ? list.subList(0, limit) : list;
            }
        }
        List<Emoji> list = emojiMapper.selectRecentByUser(userId, HOT_CACHE_SIZE);
        writeCache(key, list, RECENT_CACHE_TTL);
        return list.size() > limit ? list.subList(0, limit) : list;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void recordUse(Long id, String userId) {
        if (id == null) {
            return;
        }
        recentUseMapper.upsertUse(userId, id);
        emojiMapper.incrementHotScore(id);
        // 热度/最近缓存失效
        evictCache(HOT_CACHE_KEY);
        evictCache(RECENT_CACHE_PREFIX + userId);
    }

    @Override
    public Emoji create(Emoji emoji) {
        if (emoji == null || emoji.getName() == null || emoji.getUrl() == null) {
            throw new BusinessException("表情名称与地址不能为空");
        }
        emoji.setId(null);
        emoji.setHotScore(emoji.getHotScore() == null ? 0 : emoji.getHotScore());
        if (emoji.getSource() == null) {
            emoji.setSource("LOCAL");
        }
        if (emoji.getCategory() == null) {
            emoji.setCategory("custom");
        }
        emojiMapper.insert(emoji);
        evictCache(HOT_CACHE_KEY);
        semanticSearchService.rebuild();
        return emoji;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete(Long id, String userId) {
        if (id == null) {
            return;
        }
        Emoji emoji = emojiMapper.selectById(id);
        if (emoji == null) {
            return;
        }
        if (!"UPLOAD".equals(emoji.getSource())) {
            throw new BusinessException("仅支持删除自定义上传的表情");
        }
        emojiMapper.deleteById(id);
        favoriteMapper.deleteByEmojiId(id);
        recentUseMapper.delete(new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<RecentUse>()
                .eq(RecentUse::getEmojiId, id));
        evictCache(HOT_CACHE_KEY);
        evictCache(RECENT_CACHE_PREFIX + userId);
        semanticSearchService.rebuild();
    }

    /* ---------- 私有工具 ---------- */

    private void recordSearchHistory(String userId, String keyword) {
        SearchHistory history = new SearchHistory();
        history.setUserId(userId);
        history.setKeyword(keyword);
        searchHistoryMapper.insert(history);
    }

    private String readCache(String key) {
        try {
            return redisTemplate.opsForValue().get(key);
        } catch (Exception e) {
            log.debug("Redis 读取失败（降级直查数据库）: {}", e.getMessage());
            return null;
        }
    }

    private void writeCache(String key, Object value, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(value), ttl);
        } catch (Exception e) {
            log.debug("Redis 写入失败（忽略）: {}", e.getMessage());
        }
    }

    private void evictCache(String key) {
        try {
            redisTemplate.delete(key);
        } catch (Exception e) {
            log.debug("Redis 删除失败（忽略）: {}", e.getMessage());
        }
    }

    private List<Emoji> parseEmojiList(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<List<Emoji>>() {
            });
        } catch (Exception e) {
            log.debug("缓存解析失败: {}", e.getMessage());
            return Collections.emptyList();
        }
    }
}

package com.emojiassistant.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emojiassistant.common.BusinessException;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.entity.SearchHistory;
import com.emojiassistant.mapper.EmojiMapper;
import com.emojiassistant.mapper.FavoriteMapper;
import com.emojiassistant.mapper.RecentUseMapper;
import com.emojiassistant.mapper.SearchHistoryMapper;
import com.emojiassistant.search.EmojiSearchService;
import com.emojiassistant.search.NetworkEmojiSearchService;
import com.emojiassistant.search.NetworkSourceHealth;
import com.emojiassistant.search.SemanticSearchService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EmojiServiceImplTest {

    @Mock
    private EmojiMapper emojiMapper;
    @Mock
    private RecentUseMapper recentUseMapper;
    @Mock
    private FavoriteMapper favoriteMapper;
    @Mock
    private SearchHistoryMapper searchHistoryMapper;
    @Mock
    private EmojiSearchService emojiSearchService;
    @Mock
    private SemanticSearchService semanticSearchService;
    @Mock
    private NetworkEmojiSearchService networkSvc;
    @Mock
    private StringRedisTemplate redisTemplate;
    @Mock
    private ValueOperations<String, String> valueOps;
    @Mock
    private ObjectMapper objectMapper;

    private NetworkSearchProperties netProps;
    private EmojiServiceImpl service;

    @BeforeEach
    void setUp() {
        netProps = new NetworkSearchProperties();
        AppProperties appProps = new AppProperties();
        service = new EmojiServiceImpl(
                emojiMapper, recentUseMapper, favoriteMapper, searchHistoryMapper,
                emojiSearchService, semanticSearchService, List.of(networkSvc), new NetworkSourceHealth(),
                netProps, redisTemplate, objectMapper, appProps);
    }

    private Emoji emoji(long id, String name, String source) {
        Emoji e = new Emoji();
        e.setId(id);
        e.setName(name);
        e.setSource(source);
        return e;
    }

    @Test
    void search_空关键词_返回空页且不记录历史() {
        Page<Emoji> result = service.search("   ", 1, 24, "u1");
        assertTrue(result.getRecords().isEmpty());
        verify(searchHistoryMapper, never()).insert(any(SearchHistory.class));
    }

    @Test
    void search_正常关键词_记录历史并委托搜索() {
        Page<Emoji> page = new Page<>(1, 24);
        page.setRecords(List.of(emoji(1, "狗头", "LOCAL")));
        page.setTotal(1);
        when(emojiSearchService.search(eq("狗头"), eq(1L), eq(24L))).thenReturn(page);

        Page<Emoji> result = service.search("狗头", 1, 24, "u1");

        verify(searchHistoryMapper).insert(any(SearchHistory.class));
        assertEquals(1, result.getTotal());
        assertEquals("狗头", result.getRecords().get(0).getName());
    }

    @Test
    void search_启用网络源_合并网络结果() {
        netProps.setEnabled(true);
        netProps.setLimit(5);
        Page<Emoji> local = new Page<>(1, 24);
        local.setRecords(List.of(emoji(1, "本地", "LOCAL")));
        local.setTotal(1);
        when(emojiSearchService.search(anyString(), anyLong(), anyLong())).thenReturn(local);
        when(networkSvc.enabled()).thenReturn(true);
        when(networkSvc.healthy()).thenReturn(true);
        when(networkSvc.search(anyString(), eq(5))).thenReturn(List.of(emoji(-100, "网络", "GIPHY")));

        Page<Emoji> result = service.search("cat", 1, 24, "u1");

        assertEquals(2, result.getRecords().size());
        assertEquals(2, result.getTotal());
        assertEquals("GIPHY", result.getRecords().get(1).getSource());
    }

    @Test
    void search_网络源异常_静默降级() {
        netProps.setEnabled(true);
        Page<Emoji> local = new Page<>(1, 24);
        local.setRecords(List.of(emoji(1, "本地", "LOCAL")));
        local.setTotal(1);
        when(emojiSearchService.search(anyString(), anyLong(), anyLong())).thenReturn(local);
        when(networkSvc.enabled()).thenReturn(true);
        when(networkSvc.healthy()).thenReturn(true);
        when(networkSvc.search(anyString(), anyInt())).thenThrow(new RuntimeException("timeout"));

        Page<Emoji> result = service.search("cat", 1, 24, "u1");

        assertEquals(1, result.getRecords().size());
        assertEquals(1, result.getTotal());
    }

    @Test
    void search_网络源熔断中_自动跳过() {
        netProps.setEnabled(true);
        Page<Emoji> local = new Page<>(1, 24);
        local.setRecords(List.of(emoji(1, "本地", "LOCAL")));
        local.setTotal(1);
        when(emojiSearchService.search(anyString(), anyLong(), anyLong())).thenReturn(local);
        when(networkSvc.enabled()).thenReturn(true);
        when(networkSvc.healthy()).thenReturn(false); // 熔断中 → 不应发起网络搜索

        Page<Emoji> result = service.search("cat", 1, 24, "u1");

        assertEquals(1, result.getRecords().size());
        assertEquals(1, result.getTotal());
        verify(networkSvc, never()).search(anyString(), anyInt());
    }

    @Test
    void search_第二页_不合并网络() {
        netProps.setEnabled(true);
        Page<Emoji> local = new Page<>(2, 24);
        local.setRecords(List.of(emoji(2, "本地2", "LOCAL")));
        local.setTotal(30);
        when(emojiSearchService.search(anyString(), anyLong(), anyLong())).thenReturn(local);

        Page<Emoji> result = service.search("cat", 2, 24, "u1");

        verify(networkSvc, never()).enabled();
        assertEquals(1, result.getRecords().size());
    }

    @Test
    void hot_redis异常_降级直查数据库() {
        when(redisTemplate.opsForValue()).thenThrow(new RuntimeException("redis down"));
        when(emojiMapper.selectHot(anyLong())).thenReturn(List.of(emoji(1, "热门", "LOCAL")));

        List<Emoji> list = service.hot(24);

        assertEquals(1, list.size());
        verify(emojiMapper).selectHot(100);
    }

    @Test
    void delete_非UPLOAD来源_拒绝删除() {
        when(emojiMapper.selectById(1L)).thenReturn(emoji(1, "种子", "LOCAL"));

        assertThrows(BusinessException.class, () -> service.delete(1L, "u1"));
        verify(emojiMapper, never()).deleteById(anyLong());
    }

    @Test
    void delete_UPLOAD表情_删除并清理关联() {
        when(emojiMapper.selectById(9L)).thenReturn(emoji(9, "自传", "UPLOAD"));

        service.delete(9L, "u1");

        verify(emojiMapper).deleteById(9L);
        verify(favoriteMapper).deleteByEmojiId(9L);
        verify(recentUseMapper).delete(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class));
        verify(redisTemplate, times(2)).delete(anyString());
    }
}

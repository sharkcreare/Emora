package com.emojiassistant.search;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emojiassistant.entity.Emoji;

/**
 * 表情搜索服务抽象。
 *
 * <p>第一版实现为 MySQL 模糊搜索（{@link LocalEmojiSearchServiceImpl}）。
 * 后续可扩展：
 * <ul>
 *   <li>ElasticsearchEmojiSearchServiceImpl —— 接入 ES，支持分词/相关度</li>
 *   <li>GiphyEmojiSearchServiceImpl / TenorEmojiSearchServiceImpl —— 接入网络图库 API</li>
 * </ul>
 * 通过 Spring 的 {@code @Primary} 或配置切换实现，业务代码无需改动。
 */
public interface EmojiSearchService {

    /** 服务标识（LOCAL / ELASTICSEARCH / GIPHY / TENOR ...） */
    String name();

    /** 关键词搜索，返回分页结果 */
    Page<Emoji> search(String keyword, long page, long size);
}

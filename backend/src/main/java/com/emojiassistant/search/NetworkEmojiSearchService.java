package com.emojiassistant.search;

import com.emojiassistant.entity.Emoji;

import java.util.List;

/**
 * 网络表情搜索服务抽象（Giphy / Tenor / 其他图片 API）。
 *
 * <p>与本地搜索（{@link EmojiSearchService}）解耦：业务层在关键词搜索时把两类结果合并返回。
 * 新增图库 API 只需新写一个实现类并注册为 Spring Bean，业务代码无需改动。
 */
public interface NetworkEmojiSearchService {

    /** 来源标识：GIPHY / TENOR ... */
    String name();

    /** 是否启用（已配置 api-key 且总开关打开） */
    boolean enabled();

    /**
     * 来源是否健康可用（未熔断）。默认实现恒为 true；走 HTTP 的来源由熔断器驱动，
     * 连续失败后返回 false，业务层据此自动跳过临时抽风的来源。
     */
    default boolean healthy() {
        return true;
    }

    /**
     * 关键词搜索。
     *
     * @return 网络表情列表（不会入库，id 为合成负值）；任何异常都应自行捕获并返回空列表，保证降级
     */
    List<Emoji> search(String keyword, int limit);

    /**
     * 无关键词浏览 / 随机推荐（如「梗图库」标签）。
     *
     * @return 随机网络表情列表；不支持的来源默认返回空列表
     */
    default List<Emoji> browse(int count) {
        return List.of();
    }
}

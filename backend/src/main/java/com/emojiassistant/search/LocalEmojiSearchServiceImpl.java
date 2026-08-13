package com.emojiassistant.search;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.mapper.EmojiMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 第一版搜索实现：MySQL LIKE 模糊匹配名称/标签/分类，按热度排序。
 * 数据量大后可替换为 Elasticsearch 实现，接口不变。
 */
@Service
@RequiredArgsConstructor
public class LocalEmojiSearchServiceImpl implements EmojiSearchService {

    /** 本地搜索单页上限（与前端搜索页大小对齐，一次尽量多给） */
    private static final long MAX_SIZE = 200;

    private final EmojiMapper emojiMapper;

    @Override
    public String name() {
        return "LOCAL";
    }

    @Override
    public Page<Emoji> search(String keyword, long page, long size) {
        long pageNo = Math.max(page, 1);
        long pageSize = Math.min(Math.max(size, 1), MAX_SIZE);
        long offset = (pageNo - 1) * pageSize;

        Page<Emoji> result = new Page<>(pageNo, pageSize);
        result.setTotal(emojiMapper.countByKeyword(keyword));
        result.setRecords(emojiMapper.searchByKeyword(keyword, offset, pageSize));
        return result;
    }
}

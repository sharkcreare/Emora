package com.emojiassistant.controller;

import com.emojiassistant.common.Result;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.entity.SearchHistory;
import com.emojiassistant.mapper.SearchHistoryMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 搜索历史：面板搜索框下拉展示最近关键词，可一键清空。
 */
@RestController
@RequestMapping("/api/search-history")
@RequiredArgsConstructor
public class SearchHistoryController {

    private final SearchHistoryMapper searchHistoryMapper;
    private final AppProperties appProperties;

    @GetMapping
    public Result<List<SearchHistory>> recent(@RequestParam(defaultValue = "10") int limit) {
        int l = Math.min(Math.max(limit, 1), 50);
        return Result.ok(searchHistoryMapper.selectRecent(appProperties.getDefaultUserId(), l));
    }

    @DeleteMapping
    public Result<Void> clear() {
        searchHistoryMapper.deleteByUser(appProperties.getDefaultUserId());
        return Result.ok();
    }
}

package com.emojiassistant.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emojiassistant.common.Result;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.search.NetworkSourceHealth;
import com.emojiassistant.service.EmojiService;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 表情相关接口：搜索 / 热门 / 分类 / 最近使用 / 使用上报
 */
@RestController
@RequestMapping("/api/emoji")
@RequiredArgsConstructor
public class EmojiController {

    private final EmojiService emojiService;
    private final AppProperties appProperties;
    private final NetworkSourceHealth networkSourceHealth;

    /** 关键词搜索（第一版：MySQL 模糊搜索） */
    @GetMapping("/search")
    public Result<Page<Emoji>> search(@RequestParam @NotBlank String keyword,
                                      @RequestParam(defaultValue = "1") int page,
                                      @RequestParam(defaultValue = "24") int size) {
        return Result.ok(emojiService.search(keyword, page, size, appProperties.getDefaultUserId()));
    }

    /** 网络图库浏览（无关键词随机，供「梗图库」标签使用；不入库不可收藏） */
    @GetMapping("/network/browse")
    public Result<List<Emoji>> browseNetwork(@RequestParam(defaultValue = "36") int count) {
        return Result.ok(emojiService.browseNetwork(count));
    }

    /** 网络图库来源健康度（各源请求/失败/熔断状态，供设置页与调试排查） */
    @GetMapping("/network/health")
    public Result<java.util.Map<String, java.util.Map<String, Object>>> networkHealth() {
        return Result.ok(networkSourceHealth.snapshot());
    }

    /** 热门表情 */
    @GetMapping("/hot")
    public Result<List<Emoji>> hot(@RequestParam(defaultValue = "24") int size) {
        return Result.ok(emojiService.hot(size));
    }

    /** 按分类查询（funny / animal / emoji / custom，hot 表示热门） */
    @GetMapping("/category/{category}")
    public Result<Page<Emoji>> byCategory(@PathVariable String category,
                                          @RequestParam(defaultValue = "1") int page,
                                          @RequestParam(defaultValue = "24") int size) {
        return Result.ok(emojiService.byCategory(category, page, size));
    }

    /** 最近使用 */
    @GetMapping("/recent")
    public Result<List<Emoji>> recent(@RequestParam(defaultValue = "24") int size) {
        return Result.ok(emojiService.recent(appProperties.getDefaultUserId(), size));
    }

    /** 使用上报：热度 +1、写入最近使用（由 Electron 主进程点击发送后调用） */
    @PostMapping("/{id}/use")
    public Result<Void> recordUse(@PathVariable Long id) {
        emojiService.recordUse(id, appProperties.getDefaultUserId());
        return Result.ok();
    }

    /** 新增表情（管理/导入用） */
    @PostMapping
    public Result<Emoji> create(@RequestBody Emoji emoji) {
        return Result.ok(emojiService.create(emoji));
    }

    /** 删除自定义上传的表情（同时清理收藏/最近使用关联） */
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        emojiService.delete(id, appProperties.getDefaultUserId());
        return Result.ok();
    }
}

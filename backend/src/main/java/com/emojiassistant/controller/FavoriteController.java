package com.emojiassistant.controller;

import com.emojiassistant.common.Result;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.dto.FavoriteRequest;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.service.FavoriteService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 收藏管理
 */
@RestController
@RequestMapping("/api/favorite")
@RequiredArgsConstructor
public class FavoriteController {

    private final FavoriteService favoriteService;
    private final AppProperties appProperties;

    @PostMapping
    public Result<Void> add(@Valid @RequestBody FavoriteRequest request) {
        favoriteService.add(request.getEmojiId(), appProperties.getDefaultUserId());
        return Result.ok();
    }

    @DeleteMapping("/{emojiId}")
    public Result<Void> remove(@PathVariable Long emojiId) {
        favoriteService.remove(emojiId, appProperties.getDefaultUserId());
        return Result.ok();
    }

    @GetMapping("/list")
    public Result<List<Emoji>> list() {
        return Result.ok(favoriteService.list(appProperties.getDefaultUserId()));
    }
}

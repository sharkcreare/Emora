package com.emojiassistant.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 收藏请求
 */
@Data
public class FavoriteRequest {

    @NotNull(message = "表情 id 不能为空")
    private Long emojiId;
}

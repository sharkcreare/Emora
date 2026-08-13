package com.emojiassistant.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 最近使用记录
 */
@Data
@TableName("recent_use")
public class RecentUse {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String userId;

    private Long emojiId;

    private Integer useCount;

    private LocalDateTime lastUsedAt;
}

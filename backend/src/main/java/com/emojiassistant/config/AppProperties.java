package com.emojiassistant.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 应用级配置（application.yml 中 app.*）
 */
@Data
@Component
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    /** 桌面端单机默认用户标识 */
    private String defaultUserId = "default-user";

    /** 本地文件存储目录（storage-mode=local 时上传的表情存到这里） */
    private String uploadDir = System.getProperty("user.home") + "/.emoji-assistant/uploads";

    /** 存储模式：local（本地磁盘，默认，无需任何外部依赖）或 minio（对象存储） */
    private String storageMode = "local";
}

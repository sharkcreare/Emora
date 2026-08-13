package com.emojiassistant;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 表情包助手后端服务
 */
@SpringBootApplication
@EnableScheduling
@MapperScan("com.emojiassistant.mapper")
public class EmojiAssistantApplication {

    public static void main(String[] args) {
        SpringApplication.run(EmojiAssistantApplication.class, args);
    }
}

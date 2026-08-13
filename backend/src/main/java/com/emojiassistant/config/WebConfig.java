package com.emojiassistant.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC 补充配置。
 *
 * <p>Spring Boot 默认把 classpath:/static/ 映射到根路径（文件 static/emojis/xx.png 的 URL 是
 * /emojis/xx.png）。而表情数据中约定存的是 /static/emojis/xx.png，这里补一条 /static/** 映射，
 * 让两种写法都能访问到 classpath:/static/ 下的资源（与默认 /webjars/**、/** 处理器共存，更具体的模式优先生效）。
 *
 * <p>/uploads/** 映射到本地存储目录（app.upload-dir），供"自定义表情上传"的本地降级存储访问。
 */
@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final AppProperties appProperties;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/static/**").addResourceLocations("classpath:/static/");
        String uploadDir = appProperties.getUploadDir().replace('\\', '/');
        if (!uploadDir.endsWith("/")) {
            uploadDir += "/";
        }
        registry.addResourceHandler("/uploads/**").addResourceLocations("file:" + uploadDir);
    }
}

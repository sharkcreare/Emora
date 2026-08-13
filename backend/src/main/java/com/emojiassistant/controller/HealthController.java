package com.emojiassistant.controller;

import com.emojiassistant.common.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 健康检查接口：Electron 主进程启动内置后端后轮询此接口判断是否就绪。
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    @GetMapping("/health")
    public Result<String> health() {
        return Result.ok("UP");
    }
}

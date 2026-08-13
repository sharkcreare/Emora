package com.emojiassistant.common;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 全局异常处理：所有异常统一返回 Result 结构
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusiness(BusinessException e) {
        return Result.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .orElse("参数校验失败");
        return Result.fail(msg);
    }

    /**
     * 静态资源不存在：返回真正的 404，避免被兜底处理器伪装成 200 JSON
     * （前端据此能正确报"下载图片失败: HTTP 404"，而不是把错误 JSON 当图片写入剪贴板）。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Result<Void>> handleNoResource(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Result.fail(404, "资源不存在: " + e.getResourcePath()));
    }

    @ExceptionHandler(Exception.class)
    public Result<Void> handleOther(Exception e) {
        // 完整堆栈进日志便于排查，但响应只给通用文案，不泄露内部实现细节/堆栈信息
        log.error("未捕获异常", e);
        return Result.fail(500, "服务器内部错误，请稍后重试");
    }
}

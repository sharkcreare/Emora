package com.emojiassistant.common;

import lombok.Getter;

/**
 * 业务异常：由 GlobalExceptionHandler 统一转为 Result
 */
@Getter
public class BusinessException extends RuntimeException {

    private final int code;

    public BusinessException(String message) {
        this(Result.CODE_ERROR, message);
    }

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }
}

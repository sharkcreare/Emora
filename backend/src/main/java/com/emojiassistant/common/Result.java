package com.emojiassistant.common;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 统一 API 响应结构
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Result<T> {

    public static final int CODE_OK = 0;
    public static final int CODE_ERROR = 500;

    private int code;
    private String message;
    private T data;

    public static <T> Result<T> ok() {
        return new Result<>(CODE_OK, "ok", null);
    }

    public static <T> Result<T> ok(T data) {
        return new Result<>(CODE_OK, "ok", data);
    }

    public static <T> Result<T> fail(String message) {
        return new Result<>(CODE_ERROR, message, null);
    }

    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null);
    }
}

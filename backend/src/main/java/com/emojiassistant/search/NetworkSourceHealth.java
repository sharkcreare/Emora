package com.emojiassistant.search;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 网络图库来源健康度统计与熔断器。
 *
 * <p>对每个来源（按 {@link NetworkEmojiSearchService#name()} 区分）跟踪连续失败次数：
 * 连续失败达到 {@link #FAIL_THRESHOLD} 次即熔断 {@link #OPEN_MS} 毫秒——熔断期间
 * {@link #isUsable(String)} 返回 false，业务层自动跳过该来源（降级到其他图库/本地结果）；
 * 熔断期结束后自动放行一次请求探测（半开），成功即复位、失败重新累计。
 *
 * <p>线程安全：所有状态用原子变量/volatile，并发搜索（各来源 CompletableFuture 并行）安全。
 */
@Slf4j
@Component
public class NetworkSourceHealth {

    /** 连续失败多少次触发熔断 */
    static final int FAIL_THRESHOLD = 3;
    /** 熔断持续时间（毫秒） */
    static final long OPEN_MS = 60_000L;

    /** 单个来源的健康状态 */
    public static final class SourceState {
        final AtomicLong total = new AtomicLong();
        final AtomicLong failures = new AtomicLong();
        final AtomicInteger consecutiveFailures = new AtomicInteger();
        final AtomicInteger trips = new AtomicInteger();
        /** 熔断截止时间戳（0 = 未熔断） */
        volatile long openedUntil = 0;
        volatile long lastFailAt = 0;
        volatile long lastOkAt = 0;
    }

    private final Map<String, SourceState> states = new ConcurrentHashMap<>();

    /** 该来源当前是否可用（未熔断 / 熔断期已过可半开探测） */
    public boolean isUsable(String name) {
        SourceState s = states.get(name);
        if (s == null) return true;
        return System.currentTimeMillis() >= s.openedUntil;
    }

    /** 记录一次成功：复位连续失败、解除熔断（半开探测成功） */
    public void onSuccess(String name) {
        SourceState s = states.computeIfAbsent(name, k -> new SourceState());
        s.total.incrementAndGet();
        s.lastOkAt = System.currentTimeMillis();
        s.consecutiveFailures.set(0);
        s.openedUntil = 0;
    }

    /** 记录一次失败：累计；连续失败达到阈值则熔断 */
    public void onFailure(String name) {
        SourceState s = states.computeIfAbsent(name, k -> new SourceState());
        s.total.incrementAndGet();
        s.failures.incrementAndGet();
        s.lastFailAt = System.currentTimeMillis();
        int c = s.consecutiveFailures.incrementAndGet();
        if (c >= FAIL_THRESHOLD && s.openedUntil == 0) {
            s.openedUntil = System.currentTimeMillis() + OPEN_MS;
            s.trips.incrementAndGet();
            log.warn("[health] 来源 {} 连续失败 {} 次，熔断 {}s，期间自动跳过（半开后自动探测恢复）",
                    name, c, OPEN_MS / 1000);
        }
    }

    /** 全部来源健康度快照（供查询接口 / 前端展示） */
    public Map<String, Map<String, Object>> snapshot() {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        for (Map.Entry<String, SourceState> e : states.entrySet()) {
            SourceState s = e.getValue();
            long now = System.currentTimeMillis();
            long remaining = s.openedUntil > now ? (s.openedUntil - now) / 1000 : 0;
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("total", s.total.get());
            info.put("failures", s.failures.get());
            info.put("consecutiveFailures", s.consecutiveFailures.get());
            info.put("trips", s.trips.get());
            info.put("open", remaining > 0);
            info.put("remainingSeconds", remaining);
            info.put("lastFailAt", s.lastFailAt == 0 ? null : s.lastFailAt);
            info.put("lastOkAt", s.lastOkAt == 0 ? null : s.lastOkAt);
            out.put(e.getKey(), info);
        }
        return out;
    }
}

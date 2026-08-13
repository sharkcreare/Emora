package com.emojiassistant.search;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 网络来源熔断器测试：连续失败熔断、熔断期间跳过、成功恢复、统计快照。
 */
class NetworkSourceHealthTest {

    @Test
    void 初始状态_可用且无统计() {
        NetworkSourceHealth h = new NetworkSourceHealth();
        assertTrue(h.isUsable("SOGOU"));
        assertTrue(h.snapshot().isEmpty());
    }

    @Test
    void 连续失败3次_触发熔断() {
        NetworkSourceHealth h = new NetworkSourceHealth();
        for (int i = 0; i < 3; i++) {
            h.onFailure("SOGOU");
        }
        assertFalse(h.isUsable("SOGOU"), "连续失败 3 次后应熔断");
        Map<String, Map<String, Object>> snap = h.snapshot();
        Map<String, Object> s = snap.get("SOGOU");
        assertEquals(3L, ((Number) s.get("total")).longValue());
        assertEquals(3L, ((Number) s.get("failures")).longValue());
        assertEquals(Boolean.TRUE, s.get("open"));
    }

    @Test
    void 熔断期间_其他来源不受影响() {
        NetworkSourceHealth h = new NetworkSourceHealth();
        for (int i = 0; i < 3; i++) {
            h.onFailure("SOGOU");
        }
        assertFalse(h.isUsable("SOGOU"));
        assertTrue(h.isUsable("BQB"), "未失败的来源不受影响");
    }

    @Test
    void 成功一次_复位并解除熔断() {
        NetworkSourceHealth h = new NetworkSourceHealth();
        for (int i = 0; i < 3; i++) {
            h.onFailure("SOGOU");
        }
        assertFalse(h.isUsable("SOGOU"));
        // 熔断期结束后放行一次探测请求（半开），成功即恢复
        h.onSuccess("SOGOU");
        assertTrue(h.isUsable("SOGOU"));
        assertEquals(0, ((Number) h.snapshot().get("SOGOU").get("consecutiveFailures")).intValue());
        assertFalse((Boolean) h.snapshot().get("SOGOU").get("open"));
    }

    @Test
    void 失败未达阈值_不熔断() {
        NetworkSourceHealth h = new NetworkSourceHealth();
        h.onFailure("SOGOU");
        h.onFailure("SOGOU");
        assertTrue(h.isUsable("SOGOU"), "连续失败 2 次未达阈值不应熔断");
    }

    @Test
    void 成功失败交替_不触发熔断() {
        NetworkSourceHealth h = new NetworkSourceHealth();
        for (int i = 0; i < 10; i++) {
            h.onFailure("SOGOU");
            h.onSuccess("SOGOU");
        }
        assertTrue(h.isUsable("SOGOU"), "成功复位后不应熔断");
        assertEquals(10L, ((Number) h.snapshot().get("SOGOU").get("failures")).longValue());
        assertEquals(20L, ((Number) h.snapshot().get("SOGOU").get("total")).longValue());
    }
}

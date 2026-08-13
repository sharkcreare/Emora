package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;

/**
 * 网络搜索实现共用基类：统一 HTTP 客户端、超时控制与降级日志。
 * 子类只需实现 name() / enabled() / 以及 JSON 解析。
 */
abstract class AbstractNetworkEmojiSearchService implements NetworkEmojiSearchService {

    protected final Logger log = LoggerFactory.getLogger(getClass());
    protected final NetworkSearchProperties props;
    protected final ObjectMapper objectMapper;
    protected final NetworkSourceHealth health;
    private final HttpClient httpClient;

    protected AbstractNetworkEmojiSearchService(NetworkSearchProperties props, ObjectMapper objectMapper,
                                                NetworkSourceHealth health) {
        this.props = props;
        this.objectMapper = objectMapper;
        this.health = health;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(props.getTimeoutMs()))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /** 是否健康可用（未熔断 / 熔断期已过待探测） */
    @Override
    public boolean healthy() {
        return health.isUsable(name());
    }

    /**
     * 单次请求超时（毫秒）。默认取全局配置；多线路重试类来源（如 BAIDU）可覆盖为更短值，
     * 让单线路失败快速切换到下一线路。
     */
    protected long requestTimeoutMillis() {
        return props.getTimeoutMs();
    }

    /**
     * 单次请求失败后自动重试次数。默认 1（缓解瞬时抖动）；多线路来源（BAIDU）覆盖为 0，
     * 由自身的线路级重试兜底，避免重试翻倍。
     */
    protected int retryCount() {
        return 1;
    }

    /**
     * 发起 GET 请求并返回响应体（带自动重试 + 健康度上报）。
     * 非 200 或任何异常均返回 null（调用方据此降级为本地结果），绝不向上抛出；
     * 失败重试耗尽后上报 health.onFailure，供熔断器累计。
     */
    protected String get(String url) {
        int attempts = 1 + Math.max(0, retryCount());
        for (int i = 1; i <= attempts; i++) {
            String body = getOnce(url);
            if (body != null) {
                health.onSuccess(name());
                return body;
            }
            if (i < attempts) {
                log.debug("[{}] 请求失败，自动重试 ({}/{})", name(), i, attempts);
            }
        }
        health.onFailure(name());
        return null;
    }

    /** 单次 HTTP GET，不做任何重试；成功返回响应体，失败返回 null */
    private String getOnce(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMillis(requestTimeoutMillis()))
                    .GET()
                    .header("Accept", "application/json")
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                return resp.body();
            }
            log.warn("[{}] 请求失败 HTTP {}: {}", name(), resp.statusCode(), url);
            return null;
        } catch (Exception e) {
            log.warn("[{}] 请求异常（降级为本地结果）: {}", name(), e.getMessage());
            return null;
        }
    }

    protected static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    /** 为网络结果生成稳定的负 id（仅用于前端列表 key，不作为数据库主键） */
    protected static long syntheticId(String sourceId) {
        return -((long) (sourceId.hashCode() & 0x7fffffff)) - 1;
    }

    protected Emoji buildEmoji(long id, String name, String url, String tags, String source) {
        Emoji e = new Emoji();
        e.setId(id);
        e.setName(name);
        e.setUrl(url);
        e.setTags(tags);
        e.setCategory("funny");
        e.setHotScore(0);
        e.setSource(source);
        e.setCreateTime(LocalDateTime.now());
        return e;
    }
}

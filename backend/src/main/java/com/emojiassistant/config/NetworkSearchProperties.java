package com.emojiassistant.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 网络图片搜索配置（application.yml 中 network-search.*）。
 *
 * <p>本地不保存表情图库，只保存这份配置文件：未配置 api-key 时对应来源自动禁用，
 * 接口不可达/超时/解析失败时自动降级为仅本地结果，不影响主流程。
 */
@Data
@Component
@ConfigurationProperties(prefix = "network-search")
public class NetworkSearchProperties {

    /** 总开关（配置任一来源的 key 后建议置为 true） */
    private boolean enabled = false;

    /** 每个网络来源单次最多返回条数（BAIDU 接口上限 100，一次拉满） */
    private int limit = 100;

    /** 单次请求超时（毫秒），网络异常时快速降级 */
    private int timeoutMs = 4000;

    private Giphy giphy = new Giphy();
    private Tenor tenor = new Tenor();
    /** 内置中文梗图库（ChineseBQB），无需 Key；默认开启，开箱即用 */
    private Chinesebqb chinesebqb = new Chinesebqb();
    /** 免费搜狗表情包（接口盒子聚合，公开演示凭据，无需 Key；依赖第三方共享频次） */
    private Sogou sogou = new Sogou();
    /** 百度图库实时通道（接口盒子 apihzbqbbaidu，IP 直连集群，免 Key；内容实时更新，比静态 BQB 新） */
    private Baidu baidu = new Baidu();
    /** 萌芽表情包（meme.smyhub.com，2600+ 梗图，50 分类，免 Key，仅浏览） */
    private Mengya mengya = new Mengya();

    @Data
    public static class Chinesebqb {
        private boolean enabled = true;
    }

    @Data
    public static class Sogou {
        private boolean enabled = true;
        private String id = "88888888";
        private String key = "88888888";
        private String baseUrl = "https://cn.apihz.cn/api/img/apihzbqbsougou.php";
    }

    @Data
    public static class Baidu {
        private boolean enabled = true;
        private String id = "88888888";
        private String key = "88888888";
        /** 接口盒子普通集群 IP 线路（域名 cn.apihz.cn 时常不可达，IP 直连更稳）；按顺序重试 */
        private List<String> baseUrls = new ArrayList<>(List.of(
                "http://101.35.2.25",
                "http://124.222.204.22",
                "http://101.34.207.105",
                "http://43.142.65.209"));
    }

    @Data
    public static class Mengya {
        private boolean enabled = true;
    }

    @Data
    public static class Giphy {
        private String apiKey = "";
        private String baseUrl = "https://api.giphy.com/v1/stickers";
        /** 内容分级：g / pg / pg-13 / r */
        private String rating = "g";
    }

    @Data
    public static class Tenor {
        private String apiKey = "";
        private String baseUrl = "https://tenor.com/v2";
        /** 安全过滤：off / low / medium / high */
        private String contentFilter = "medium";
    }
}

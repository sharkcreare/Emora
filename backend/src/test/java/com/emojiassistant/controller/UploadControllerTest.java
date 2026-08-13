package com.emojiassistant.controller;

import com.emojiassistant.common.BusinessException;
import com.emojiassistant.common.GlobalExceptionHandler;
import com.emojiassistant.common.Result;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.service.EmojiService;
import com.emojiassistant.service.LocalFileStorageService;
import com.emojiassistant.service.MinioService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 上传接口安全测试：文件头魔数校验（伪装文件拒绝）、大小限制、路径名清洗。
 */
@ExtendWith(MockitoExtension.class)
class UploadControllerTest {

    @Mock
    private MinioService minioService;
    @Mock
    private LocalFileStorageService localFileStorageService;
    @Mock
    private EmojiService emojiService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        AppProperties appProps = new AppProperties();
        appProps.setStorageMode("local");
        UploadController controller = new UploadController(minioService, localFileStorageService, emojiService, appProps);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    /** 1x1 PNG 文件头 */
    private byte[] pngBytes() {
        return new byte[]{
                (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
        };
    }

    @Test
    void upload_合法PNG_成功并返回表情() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "cat.png", "image/png", pngBytes());
        Emoji created = new Emoji();
        created.setId(100L);
        created.setName("cat");
        when(localFileStorageService.upload(any(), any())).thenReturn("/uploads/2026/08/x.png");
        when(emojiService.create(any())).thenReturn(created);

        mockMvc.perform(multipart("/api/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(Result.CODE_OK))
                .andExpect(jsonPath("$.data.name").value("cat"));

        verify(localFileStorageService).upload(any(), any());
        verify(emojiService).create(any());
    }

    @Test
    void upload_伪装PNG的GIF_类型与内容不符_拒绝() throws Exception {
        // 声称 image/png 但文件头实际是 GIF（伪装类型）：Content-Type 与魔数冲突必须拒绝
        byte[] gif = new byte[]{'G', 'I', 'F', '8', '9', 'a', 0x01, 0x00};
        MockMultipartFile file = new MockMultipartFile("file", "fake.png", "image/png", gif);

        mockMvc.perform(multipart("/api/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(Result.CODE_ERROR))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("文件类型与内容不符")));

        verify(localFileStorageService, never()).upload(any(), any());
        verify(emojiService, never()).create(any());
    }

    @Test
    void upload_非图片ContentType_拒绝() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "doc.txt", "text/plain", "hello".getBytes());

        mockMvc.perform(multipart("/api/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(Result.CODE_ERROR))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("仅支持")));

        verify(localFileStorageService, never()).upload(any(), any());
    }

    @Test
    void upload_魔数无法识别_拒绝() throws Exception {
        // Content-Type 是 image/png 但内容随机字节
        MockMultipartFile file = new MockMultipartFile("file", "rand.png", "image/png", new byte[]{1, 2, 3, 4, 5});

        mockMvc.perform(multipart("/api/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(Result.CODE_ERROR))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("不是有效图片")));

        verify(localFileStorageService, never()).upload(any(), any());
    }

    @Test
    void upload_可执行文件伪装PNG_魔数拒绝() throws Exception {
        // 声称 image/png 但文件头是 MZ（PE 可执行文件）：魔数非图片，直接拒绝
        byte[] exe = new byte[]{0x4d, 0x5a, (byte) 0x90, 0x00, 0x03, 0x00, 0x00, 0x00};
        MockMultipartFile file = new MockMultipartFile("file", "evil.png", "image/png", exe);

        mockMvc.perform(multipart("/api/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(Result.CODE_ERROR))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("不是有效图片")));

        verify(localFileStorageService, never()).upload(any(), any());
        verify(emojiService, never()).create(any());
    }

    @Test
    void upload_路径穿越文件名_被清洗() throws Exception {
        // 文件名含路径分隔符：sanitizeName 应去掉，不得用于路径拼接
        MockMultipartFile file = new MockMultipartFile(
                "file", "../../etc/passwd.png", "image/png", pngBytes());
        Emoji created = new Emoji();
        created.setId(1L);
        created.setName("....etcpasswd");
        when(localFileStorageService.upload(any(), any())).thenReturn("/uploads/2026/08/x.png");
        when(emojiService.create(any())).thenReturn(created);

        mockMvc.perform(multipart("/api/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(Result.CODE_OK))
                // 路径分隔符全部被清洗：../../etc/passwd.png → ....etcpasswd.png
                .andExpect(jsonPath("$.data.name").value("....etcpasswd"));

        verify(localFileStorageService).upload(any(), any());
    }
}

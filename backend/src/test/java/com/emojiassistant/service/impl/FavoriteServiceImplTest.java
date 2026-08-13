package com.emojiassistant.service.impl;

import com.emojiassistant.common.BusinessException;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.entity.Favorite;
import com.emojiassistant.mapper.EmojiMapper;
import com.emojiassistant.mapper.FavoriteMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FavoriteServiceImplTest {

    @Mock
    private FavoriteMapper favoriteMapper;
    @Mock
    private EmojiMapper emojiMapper;

    private FavoriteServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new FavoriteServiceImpl(favoriteMapper, emojiMapper);
    }

    @Test
    void add_表情不存在_抛业务异常() {
        when(emojiMapper.selectById(1L)).thenReturn(null);

        assertThrows(BusinessException.class, () -> service.add(1L, "u1"));
        verify(favoriteMapper, never()).insert(ArgumentMatchers.any(Favorite.class));
    }

    @Test
    void add_已收藏_幂等不重复插入() {
        when(emojiMapper.selectById(1L)).thenReturn(new Emoji());
        when(favoriteMapper.countByUserAndEmoji("u1", 1L)).thenReturn(1L);

        service.add(1L, "u1");

        verify(favoriteMapper, never()).insert(ArgumentMatchers.any(Favorite.class));
    }

    @Test
    void remove_删除收藏记录() {
        service.remove(1L, "u1");

        verify(favoriteMapper).deleteByUserAndEmoji("u1", 1L);
    }
}

# 共享字型

- `noto-color-emoji.woff2`：Google 的 [Noto Color Emoji](https://github.com/googlefonts/noto-emoji) v2.055（COLRv1/CPAL 彩色字型），取自 [google/fonts](https://github.com/google/fonts/tree/main/ofl/notocoloremoji) 的 `NotoColorEmoji-Regular.ttf`（25.3 MB），去掉瀏覽器不吃的 `SVG ` 表後轉 woff2，得 1.91 MB。只在 `data-host="windows"` 的 `--font-sans` 使用，取代 Segoe UI Emoji；macOS／iOS／Android 保留系統 emoji。`styles/emoji-font.css` 以 `unicode-range` 限定只承接 emoji 碼位。
- `OFL.txt`：上述字型的 SIL Open Font License 1.1 全文，按授權要求隨字型分發。

重新產生的命令：

```sh
curl -sSLo NotoColorEmoji-Regular.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf
python3 -m pip install fonttools brotli
python3 -c "from fontTools.ttLib import TTFont
f = TTFont('NotoColorEmoji-Regular.ttf')
del f['SVG ']
for t in ('vhea', 'vmtx'):
    f.pop(t, None)
f.flavor = 'woff2'
f.save('noto-color-emoji.woff2')"
```

署名見根目錄 `THIRD-PARTY-NOTICES.md`。

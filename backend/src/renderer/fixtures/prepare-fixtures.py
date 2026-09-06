"""Development-only fixture generator. Requires fontTools 4.53.1; never runs in rendering.

Pass the fixed upstream Noto Sans SC variable TTF path as the only argument.
The output font is an OFL-licensed, renamed, regular-weight test subset.
The PNG is an original, deliberately synthetic bottle illustration (CC0).
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).parent
UPSTREAM_HASH = "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"
source = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == UPSTREAM_HASH, "Wrong upstream font"
font = TTFont(sys.argv[1], recalcTimestamp=False)
font = instantiateVariableFont(font, {"wght": 400}, inplace=True)
corpus = (
    "轻量随行这是一件用于验证的合成产品。保留中英文原文、数值和单位，不添加功效。"
    "参数容量材质素材用途排版与图片绑定审核样稿不代表真实产品"
    "这是很长的正文标题说明证据比较功能步骤仅供测试缺失字体"
    "·：，（）/"
)
options = subset.Options()
options.recalc_timestamp = False
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
options.name_legacy = True
options.name_languages = [0x409]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=set(range(32, 127)) | {ord(c) for c in corpus})
subsetter.subset(font)
names = {
    1: "Tujiang Renderer Fixture Sans",
    2: "Regular",
    3: "TujiangRendererFixtureSans-Regular-1.0",
    4: "Tujiang Renderer Fixture Sans Regular",
    6: "TujiangRendererFixtureSans-Regular",
    16: "Tujiang Renderer Fixture Sans",
    17: "Regular",
}
for name_id, value in names.items():
    font["name"].setName(value, name_id, 3, 1, 0x409)
font["head"].created = font["head"].modified = 3786912000  # Fixed OpenType timestamp.
font_path = ROOT / "fixture-sans-regular.ttf"
font.save(font_path)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


width, height = 600, 400
pixels = bytearray()
for y in range(height):
    pixels.append(0)  # PNG no-filter row.
    for x in range(width):
        color = (241, 239, 232)
        if ((x - 300) / 110) ** 2 + ((y - 348) / 16) ** 2 <= 1:
            color = (220, 220, 212)
        if 224 <= x <= 376 and 118 <= y <= 340:
            color = (69, 95, 86)
        if 240 <= x <= 360 and 98 <= y < 118:
            color = (69, 95, 86)
        if 252 <= x <= 348 and 67 <= y < 98:
            color = (42, 53, 49)
        if 244 <= x <= 258 and 134 <= y <= 320:
            color = (96, 121, 109)
        if 261 <= x <= 339 and 197 <= y <= 253:
            color = (235, 228, 207)
        pixels.extend(color)
png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(pixels), 9))
png += chunk(b"IEND", b"")
(ROOT / "synthetic-bottle.png").write_bytes(png)
print(json.dumps({
    "fontSha256": hashlib.sha256(font_path.read_bytes()).hexdigest(),
    "imageSha256": hashlib.sha256(png).hexdigest(),
    "imageWidth": width,
    "imageHeight": height,
}, indent=2))

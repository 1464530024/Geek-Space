#!/usr/bin/env python3
# ============================================================
# 极客空间 Geek Space — 截图压缩并归档到 docs/images/
# ------------------------------------------------------------
# 用法：先运行 node tools/screenshot.js 生成 .shots/*.png
#       再运行 python tools/optimize-shots.py
#
# 处理内容：
#   1. 等比缩放到 README 需要的宽度（桌面 1440、移动 780）
#   2. 转 256 色调色板 —— UI 截图色数少，体积可减小约 60%
#      且实测无色带（背景光晕与环形仪表渐变均平滑）
#   3. 生成圆角透明的 README 用应用图标
#
# 依赖：pip install pillow
# ============================================================
import os
import shutil
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.shots')
DST = os.path.join(ROOT, 'docs', 'images')

# (源文件, 输出名, 目标宽度)
MAPPING = [
    ('r-onboard-welcome.png', 'onboarding.png',       1440),
    ('r-dashboard.png',       'dashboard-dark.png',   1440),
    ('r-monitor-cpu.png',     'monitor-cpu.png',      1440),
    ('r-monitor-storage.png', 'monitor-storage.png',  1440),
    ('r-link.png',            'link-phone.png',       1440),
    ('r-tools-bench.png',     'tools-bench.png',      1440),
    ('r-tools-startup.png',   'tools-startup.png',    1440),
    ('r-settings.png',        'settings-colors.png',  1440),
    ('r-style-minimal.png',   'style-minimal.png',    1440),
    ('r-style-apple.png',     'style-apple.png',      1440),
    ('r-theme-cyber.png',     'theme-cyber.png',      1440),
    ('r-mobile-dashboard.png', 'mobile-dashboard.png', 780),
    ('r-mobile-monitor.png',   'mobile-monitor.png',   780),
]

ICON_SRC = os.path.join(ROOT, 'src-tauri', 'icons', 'icon.png')


def main():
    if not os.path.isdir(SRC):
        print('缺少 .shots/ 目录，请先运行：node tools/screenshot.js', file=sys.stderr)
        return 1

    os.makedirs(DST, exist_ok=True)
    total = 0
    missing = []

    for src_name, dst_name, width in MAPPING:
        sp = os.path.join(SRC, src_name)
        if not os.path.exists(sp):
            missing.append(src_name)
            continue
        im = Image.open(sp).convert('RGB')
        if im.width != width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        dp = os.path.join(DST, dst_name)
        im.convert('P', palette=Image.ADAPTIVE, colors=256).save(dp, 'PNG', optimize=True)
        size = os.path.getsize(dp)
        total += size
        print('  %-24s %4dx%-4d  %6.0f KB' % (dst_name, im.width, im.height, size / 1024))

    # README 顶部应用图标：切圆角并保留透明通道
    if os.path.exists(ICON_SRC):
        icon = Image.open(ICON_SRC).convert('RGBA')
        w, h = icon.size
        mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(w * 0.22), fill=255)
        icon.putalpha(mask)
        dp = os.path.join(DST, 'logo.png')
        icon.save(dp, 'PNG', optimize=True)
        size = os.path.getsize(dp)
        total += size
        print('  %-24s %4dx%-4d  %6.0f KB' % ('logo.png', w, h, size / 1024))
    else:
        missing.append(ICON_SRC)

    print('\n  合计 %.2f MB' % (total / 1048576))
    if missing:
        print('  注意：以下文件缺失，相关截图未更新：%s' % ', '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())

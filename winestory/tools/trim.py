#!/usr/bin/env python3
"""Trim transparent padding off bottle PNGs so shelf sizing is accurate.
usage: python3 tools/trim.py bottles/*.png   (edits in place)"""
import sys
from PIL import Image

for path in sys.argv[1:]:
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not box or box == (0, 0, *im.size):
        print(f"{path}: already tight")
        continue
    im.crop(box).save(path)
    print(f"{path}: {im.size} -> {box[2]-box[0]}x{box[3]-box[1]}")

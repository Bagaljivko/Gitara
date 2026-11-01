# Iscrtava obrise ključeva sa slike glave gitare: python3 scripts/trace-knobs.py <izvorna-slika.jpg> <izlazni-folder>
import sys, json, math
from PIL import Image, ImageDraw
import numpy as np
src = sys.argv[1]; out = sys.argv[2]
im = Image.open(src).convert('RGB')
TOP = 625                       # odsecamo prazan gornji deo
BOTTOM = 1830                   # i deo vrata (vrat se nastavlja ispod)
crop = im.crop((0, TOP, im.width, BOTTOM))
W, H = crop.size
L = np.asarray(crop.convert('L')).astype(int)
knobs = [('L', 925), ('L', 1132), ('L', 1340), ('R', 925), ('R', 1132), ('R', 1340)]
res = []
for side, cy in knobs:
    cy -= TOP
    y0, y1 = cy - 95, cy + 95
    if side == 'L': x0, x1 = 80, 191
    else: x0, x1 = 737, 850
    box = L[y0:y1, x0:x1] > 48
    # najveća povezana komponenta (flood fill od najsvetlijeg centra)
    ys, xs = np.nonzero(box)
    cyl, cxl = int(np.median(ys)), int(np.median(xs))
    seen = np.zeros_like(box); stack = [(cyl, cxl)]; comp = []
    while stack:
        y, x = stack.pop()
        if y < 0 or x < 0 or y >= box.shape[0] or x >= box.shape[1] or seen[y, x] or not box[y, x]: continue
        seen[y, x] = 1; comp.append((y, x))
        stack += [(y+1, x), (y-1, x), (y, x+1), (y, x-1)]
    comp = np.array(comp)
    # popuni rupe: za svaki red uzmi raspon
    mask = np.zeros_like(box)
    for y in np.unique(comp[:, 0]):
        xs_ = comp[comp[:, 0] == y][:, 1]; mask[y, xs_.min():xs_.max()+1] = 1
    my, mx = np.nonzero(mask)
    ccy, ccx = my.mean(), mx.mean()
    pts = []
    N = 64
    for i in range(N):
        ang = 2 * math.pi * i / N
        dx, dy = math.cos(ang), math.sin(ang)
        r = 0
        for rr in np.arange(0, 120, 0.5):
            x = int(round(ccx + dx * rr)); y = int(round(ccy + dy * rr))
            if 0 <= y < mask.shape[0] and 0 <= x < mask.shape[1] and mask[y, x]: r = rr
            elif rr > 10 and (x < 0 or y < 0 or x >= mask.shape[1] or y >= mask.shape[0]): break
        pts.append((ccx + dx * (r + 1.5), ccy + dy * (r + 1.5)))
    # izgladi radijuse (pokretni prosek 3)
    sm = []
    for i in range(N):
        px = sum(pts[(i + k) % N][0] for k in (-1, 0, 1)) / 3
        py = sum(pts[(i + k) % N][1] for k in (-1, 0, 1)) / 3
        sm.append((px + x0, py + y0))
    res.append({'side': side, 'cx': (ccx + x0) / W * 100, 'cy': (ccy + y0) / H * 100,
                'pts': [(round(x / W * 100, 2), round(y / H * 100, 2)) for x, y in sm]})
# debug slika
dbg = crop.copy(); d = ImageDraw.Draw(dbg)
for k in res:
    d.line([(x * W / 100, y * H / 100) for x, y in k['pts']] + [(k['pts'][0][0] * W / 100, k['pts'][0][1] * H / 100)], fill=(0, 255, 0), width=2)
dbg.save(out + '/trace-debug.png')
crop.save(out + '/headstock-crop.png')
json.dump({'w': W, 'h': H, 'knobs': res}, open(out + '/knobs.json', 'w'))
print(W, H, [(k['side'], round(k['cx'], 1), round(k['cy'], 1)) for k in res])

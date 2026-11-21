"""Собирает шрифт «Оттиск» из открытой (OFL) основы.

Каждая буква проходит через «оттиск»: углы смягчаются (скругление внутренних
и внешних углов), контур чуть растекается, как краска под прессом, и получает
едва заметную неровность края. Хинтинг снимается, имена меняются.
"""
import argparse, math, random
import numpy as np
import pyclipper
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.basePen import BasePen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools import subset

S = 16  # координаты в клиппере ×16 для точности


class FlatPen(BasePen):
    def __init__(self, gs, step=3.0):
        super().__init__(gs)
        self.paths, self.cur, self.step = [], [], step

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        L = math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)
        n = max(2, int(L / self.step))
        for i in range(1, n + 1):
            t = i / n; u = 1 - t
            x = u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0]
            y = u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]
            self.cur.append((x, y))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        L = math.dist(p0, p1) + math.dist(p1, p2)
        n = max(2, int(L / self.step))
        for i in range(1, n + 1):
            t = i / n; u = 1 - t
            self.cur.append((u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]))

    def _closePath(self):
        if len(self.cur) > 2:
            self.paths.append(self.cur)
        self.cur = []

    _endPath = _closePath


def offset(paths, d, arc):
    if not paths:
        return []
    o = pyclipper.PyclipperOffset()
    o.ArcTolerance = arc * S
    o.AddPaths(paths, pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    return o.Execute(d * S)


def union(paths):
    c = pyclipper.Pyclipper()
    c.AddPaths(paths, pyclipper.PT_SUBJECT, True)
    return c.Execute(pyclipper.CT_UNION, pyclipper.PFT_NONZERO, pyclipper.PFT_NONZERO)


# --- гладкий 2D-шум (градиентный), детерминированный ---
_rng = np.random.default_rng(7)
_G = _rng.normal(size=(256, 2)); _G /= np.linalg.norm(_G, axis=1)[:, None]
_P = _rng.permutation(256)


def _grad(ix, iy):
    return _G[_P[(_P[ix % 256] + iy) % 256]]


def noise2(x, y):
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    def dot(ix, iy):
        g = _grad(ix, iy); return g[0] * (x - ix) + g[1] * (y - iy)
    sx = fx * fx * (3 - 2 * fx); sy = fy * fy * (3 - 2 * fy)
    a = dot(x0, y0) + sx * (dot(x0 + 1, y0) - dot(x0, y0))
    b = dot(x0, y0 + 1) + sx * (dot(x0 + 1, y0 + 1) - dot(x0, y0 + 1))
    return a + sy * (b - a)


def roughen(path, amp, lam, seed, spacing=4.0):
    """Ресэмплирует контур и сдвигает точки по нормали на шум."""
    pts = [(p[0] / S, p[1] / S) for p in path]
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        L = math.dist(a, b)
        k = max(1, int(L / spacing))
        for j in range(k):
            t = j / k
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    m = len(out)
    res = []
    for i in range(m):
        p0, p1 = out[i - 1], out[(i + 1) % m]
        tx, ty = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = ty / ln, -tx / ln
        x, y = out[i]
        v = noise2(x / lam + seed * 13.1, y / lam - seed * 7.7) + 0.45 * noise2(x / (lam * .38) + 50 + seed, y / (lam * .38) - seed)
        res.append((x + nx * amp * v, y + ny * amp * v))
    return res


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a = np.array(pts)
    keep = np.zeros(len(a), bool); keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        p, q = a[s], a[e]
        d = q - p; L = math.hypot(*d)
        seg = a[s + 1:e] - p
        if L == 0:
            dist = np.hypot(seg[:, 0], seg[:, 1])
        else:
            dist = np.abs(seg[:, 0] * d[1] - seg[:, 1] * d[0]) / L
        i = int(np.argmax(dist))
        if dist[i] > eps:
            k = s + 1 + i; keep[k] = True
            stack += [(s, k), (k, e)]
    return [tuple(x) for x in a[keep]]


def simplify_closed(pts, eps):
    # разрезаем замкнутый контур в самой «острой» точке, чтобы RDP не потерял угол
    n = len(pts)
    if n < 8:
        return pts
    i0 = int(np.argmax([p[0] + p[1] * 0.001 for p in pts]))
    rot = pts[i0:] + pts[:i0] + [pts[i0]]
    r = rdp(rot, eps)[:-1]
    return r


def area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def press(paths, args, seed):
    P = [[(round(x * S), round(y * S)) for x, y in p] for p in paths]
    P = union(P)
    if args.spread:
        P = offset(P, args.spread, .2)
    if args.close:
        P = offset(P, args.close, .2); P = offset(P, -args.close, .2)
    if args.open:
        P = offset(P, -args.open, .2); P = offset(P, args.open, .2)
    out = []
    for p in P:
        a = area(p) / (S * S)
        if abs(a) < 12:
            continue
        if a < 0 and abs(a) < args.minhole:  # крошечные дырочки на стыках заливаем краской
            continue
        q = roughen(p, args.amp, args.lam, seed) if args.amp > 0 else [(x / S, y / S) for x, y in p]
        q = simplify_closed(q, args.eps)
        if len(q) < 3:
            continue
        out.append(q)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--axes', default='')
    ap.add_argument('--family', default='Ottisk')
    ap.add_argument('--style', default='Regular')
    ap.add_argument('--close', type=float, default=14)
    ap.add_argument('--open', type=float, default=10)
    ap.add_argument('--spread', type=float, default=3)
    ap.add_argument('--amp', type=float, default=2.2)
    ap.add_argument('--lam', type=float, default=110)
    ap.add_argument('--eps', type=float, default=0.9)
    ap.add_argument('--subset', default='1')
    ap.add_argument('--track', type=float, default=0)
    ap.add_argument('--minhole', type=float, default=2200)
    args = ap.parse_args()

    f = TTFont(args.src)
    if 'fvar' in f:
        loc = {}
        for kv in filter(None, args.axes.split(',')):
            k, v = kv.split('='); loc[k] = float(v)
        for a in f['fvar'].axes:
            loc.setdefault(a.axisTag, a.defaultValue)
        f = instancer.instantiateVariableFont(f, loc, updateFontNames=False)

    if args.subset == '1':
        opts = subset.Options()
        opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.name_languages = ['*']
        opts.notdef_outline = True; opts.glyph_names = True; opts.hinting = False
        opts.drop_tables += ['DSIG', 'STAT']
        sub = subset.Subsetter(opts)
        uni = list(range(0x20, 0x7f)) + list(range(0xa0, 0x180)) + list(range(0x400, 0x460)) + [0x490, 0x491, 0x492, 0x493, 0x49a, 0x49b, 0x4a2, 0x4a3, 0x4ae, 0x4af, 0x4b0, 0x4b1, 0x4ba, 0x4bb, 0x4d8, 0x4d9, 0x4e8, 0x4e9] + list(range(0x2010, 0x2027)) + [0x2030, 0x2039, 0x203a, 0x2116, 0x20bd, 0x20b8, 0x20ac, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2248, 0x2260, 0x2264, 0x2265, 0x2022, 0x2026]
        sub.populate(unicodes=uni)
        sub.subset(f)

    gs = f.getGlyphSet()
    glyf = f['glyf']
    order = f.getGlyphOrder()
    for gi, name in enumerate(order):
        g = glyf[name]
        if g.isComposite() or g.numberOfContours <= 0:
            continue
        pen = FlatPen(gs)
        gs[name].draw(pen)
        paths = press(pen.paths, args, seed=gi % 97)
        tp = TTGlyphPen(None)
        for p in paths:
            p = p[::-1]  # клиппер: внешние против часовой → TrueType: по часовой, дыры наоборот
            tp.moveTo((round(p[0][0]), round(p[0][1])))
            for x, y in p[1:]:
                tp.lineTo((round(x), round(y)))
            tp.closePath()
        ng = tp.glyph()
        if args.track:
            ng.coordinates.translate((round(args.track), 0)) if ng.numberOfContours > 0 else None
        glyf[name] = ng

    if args.track:
        hm = f['hmtx'].metrics
        for name in order:
            w, lsb = hm[name]
            if w > 0:
                hm[name] = (w + round(2 * args.track), lsb + round(args.track))
    for t in ('fpgm', 'prep', 'cvt ', 'gasp', 'hdmx', 'LTSH', 'VDMX'):
        if t in f:
            del f[t]
    for name in order:
        g = glyf[name]
        if hasattr(g, 'program'):
            from fontTools.ttLib.tables import ttProgram
            g.program = ttProgram.Program(); g.program.fromBytecode(b'')
    f['maxp'].maxSizeOfInstructions = 0
    f['head'].flags &= ~(1 << 3)
    glyf.compile(f)  # пересчёт bbox
    for name in order:
        glyf[name].recalcBounds(glyf)

    hm = f['hmtx'].metrics
    for name in order:
        g = glyf[name]
        w, _ = hm[name]
        hm[name] = (w, getattr(g, 'xMin', 0) if g.numberOfContours != 0 else 0)
    # имена
    fam, sty = args.family, args.style
    nm = f['name']
    base = nm.getDebugName(1) or 'base'
    for rec in list(nm.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            nm.removeNames(nameID=rec.nameID)
    full = f'{fam} {sty}' if sty != 'Regular' else fam
    ps = f'{fam}-{sty.replace(" ", "")}'
    nm.setName(fam, 1, 3, 1, 0x409); nm.setName(sty, 2, 3, 1, 0x409)
    nm.setName(f'{ps};2026', 3, 3, 1, 0x409); nm.setName(full, 4, 3, 1, 0x409)
    nm.setName(ps, 6, 3, 1, 0x409)
    nm.setName(f'{fam} — шрифт «Оттиска». Основан на {base} (SIL Open Font License 1.1).', 10, 3, 1, 0x409)
    nm.setName('This Font Software is licensed under the SIL Open Font License, Version 1.1.', 13, 3, 1, 0x409)
    nm.setName('https://openfontlicense.org', 14, 3, 1, 0x409)
    f.save(args.dst)
    print('ok', args.dst)


if __name__ == '__main__':
    main()

// Локализация RU/EN.
// Интерфейс написан по-русски; в английском режиме строки переводятся по словарю на лету:
// текст в DOM, подсказки (placeholder/title/aria-label/alt), окна confirm/alert и надписи на холстах.
// Пользовательский текст (записи, названия дней) не трогается: в словаре его нет, а поля ввода пропускаются.
import { EN, RULES, MONTHS_GEN, MONTHS_NOM, WEEKDAYS, WD_SHORT, MON_SHORT } from './en';

export type Lang = 'ru' | 'en';
const KEY = 'ottisk:lang';
const CYR = /[А-Яа-яЁё]/;

function detect(): Lang {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'ru' || s === 'en') return s;
  } catch {
    /* хранилище недоступно */
  }
  const nav = (navigator.languages?.[0] || navigator.language || 'ru').toLowerCase();
  return /^(ru|kk|uk|be|ky|uz|tg|tt)/.test(nav) ? 'ru' : 'en';
}

let lang: Lang = detect();
export const getLang = () => lang;
export const isEn = () => lang === 'en';
/** Язык речи для распознавания и озвучки */
export const speechLang = () => (lang === 'en' ? 'en-US' : 'ru-RU');

export function setLang(l: Lang) {
  if (l === lang) return;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ничего */
  }
  // перезапуск проще и надёжнее, чем откатывать уже переведённые узлы
  location.reload();
}

const wordRe = (list: string[]) => new RegExp('(^|[^А-Яа-яЁё])(' + list.join('|') + ')(?![А-Яа-яЁё])', 'g');
const MG = Object.keys(MONTHS_GEN);
const DATE_RE = new RegExp('(\\d{1,2})\\s(' + MG.join('|') + ')(?:\\s(\\d{4})(?:\\sг\\.?)?)?(?:,?\\s(?:в\\s)?(\\d{1,2}:\\d{2}))?', 'g');
const MN_RE = wordRe(Object.keys(MONTHS_NOM));
const WD_RE = wordRe(Object.keys(WEEKDAYS));
const WDS_RE = wordRe(Object.keys(WD_SHORT));
const MS_RE = wordRe(Object.keys(MON_SHORT));

/** даты, месяцы и дни недели внутри строки */
function tokens(t: string): string {
  return t
    .replace(DATE_RE, (_m, d, mon, y, hm) => MONTHS_GEN[mon] + ' ' + d + (y ? ', ' + y : '') + (hm ? ', ' + hm : ''))
    .replace(MN_RE, (_m, p, w) => p + MONTHS_NOM[w])
    .replace(WD_RE, (_m, p, w) => p + WEEKDAYS[w])
    .replace(WDS_RE, (_m, p, w) => p + WD_SHORT[w])
    .replace(MS_RE, (_m, p, w) => p + MON_SHORT[w]);
}

function core(t: string): string | null {
  const e = EN[t];
  if (e !== undefined) return e;
  for (const [re, rep] of RULES) {
    const m = t.match(re);
    if (m) return typeof rep === 'string' ? t.replace(re, rep) : rep(m, tr);
  }
  return null;
}

function translate(t: string): string | null {
  let r = core(t);
  if (r != null) return r;
  // строки из частей через « · »
  if (t.includes(' · ')) {
    const raw = t.split(' · ');
    const parts = raw.map((p) => {
      if (!CYR.test(p)) return p;
      const c = core(p.trim());
      if (c != null) return c;
      const tk = tokens(p);
      return CYR.test(tk) ? p : tk;
    });
    // переводим служебные части, пользовательский текст (название дня) оставляем как есть
    if (parts.some((p, i) => p !== raw[i])) return parts.join(' · ');
  }
  // значки по краям: «+ », «▶ », « →», двоеточие…
  const m = t.match(/^([^А-Яа-яЁё0-9«]*)(.*?)([^А-Яа-яЁё0-9»]*)$/);
  if (m && (m[1] || m[3]) && m[2]) {
    r = core(m[2]);
    if (r != null) return m[1] + r + m[3];
  }
  const tk = tokens(t);
  if (!CYR.test(tk)) return tk;
  return null;
}

const cache = new Map<string, string>();
/** Перевести строку интерфейса (в русском режиме возвращает как есть) */
export function tr(s: string): string {
  if (lang === 'ru' || !s || !CYR.test(s)) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const lead = s.match(/^\s*/)![0];
  const trail = s.match(/\s*$/)![0];
  const t = s.trim();
  const r = translate(t);
  const out = r == null ? s : lead + r + trail;
  if (cache.size > 4000) cache.clear();
  cache.set(s, out);
  return out;
}

// ---------- DOM ----------
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = 'textarea,script,style,[contenteditable=""],[contenteditable="true"],[data-i18n-skip]';

function skipEl(el: Element | null) {
  return !el || !!el.closest(SKIP);
}

function doText(n: Text) {
  const v = n.nodeValue;
  if (!v || !CYR.test(v) || skipEl(n.parentElement)) return;
  const t = tr(v);
  if (t !== v) n.nodeValue = t;
}

function doAttrs(el: Element) {
  // подсказки в полях ввода переводим, сами введённые значения — нет
  if (el.closest('[data-i18n-skip],script,style')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && CYR.test(v)) {
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === 3) return doText(root as Text);
  if (root.nodeType !== 1) return;
  const el = root as Element;
  doAttrs(el);
  if (skipEl(el)) return;
  const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = it.nextNode())) {
    if (n.nodeType === 3) doText(n as Text);
    else doAttrs(n as Element);
  }
}

function patchCanvas() {
  const P = CanvasRenderingContext2D.prototype;
  const fill = P.fillText,
    stroke = P.strokeText,
    measure = P.measureText;
  P.fillText = function (text: string, x: number, y: number, mw?: number) {
    return mw === undefined ? fill.call(this, tr(String(text)), x, y) : fill.call(this, tr(String(text)), x, y, mw);
  };
  P.strokeText = function (text: string, x: number, y: number, mw?: number) {
    return mw === undefined ? stroke.call(this, tr(String(text)), x, y) : stroke.call(this, tr(String(text)), x, y, mw);
  };
  P.measureText = function (text: string) {
    return measure.call(this, tr(String(text)));
  };
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    const O = OffscreenCanvasRenderingContext2D.prototype;
    const of = O.fillText,
      om = O.measureText;
    O.fillText = function (text: string, x: number, y: number, mw?: number) {
      return mw === undefined ? of.call(this, tr(String(text)), x, y) : of.call(this, tr(String(text)), x, y, mw);
    };
    O.measureText = function (text: string) {
      return om.call(this, tr(String(text)));
    };
  }
}

/** Отладка: какие строки интерфейса остались без перевода */
function left() {
  const out = new Set<string>();
  const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = it.nextNode())) {
    const v = n.nodeValue?.trim();
    if (v && CYR.test(v) && !skipEl(n.parentElement)) out.add(v);
  }
  document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach((el) => {
    if (el.closest('[data-i18n-skip]')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && CYR.test(v)) out.add('@' + a + ': ' + v);
    }
  });
  return [...out];
}
(window as unknown as Record<string, unknown>).__i18nLeft = left;

/** Запускается до первого рендера */
export function initI18n() {
  document.documentElement.lang = lang;
  if (lang === 'ru') return;
  patchCanvas();
  const conf = window.confirm.bind(window),
    al = window.alert.bind(window);
  window.confirm = (m?: string) => conf(tr(String(m ?? '')));
  window.alert = (m?: string) => al(tr(String(m ?? '')));
  const fix = () => {
    const t = tr(document.title);
    if (t !== document.title) document.title = t;
  };
  fix();
  new MutationObserver(fix).observe(document.querySelector('title') ?? document.head, { childList: true, characterData: true, subtree: true });
  const start = () => {
    walk(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target as Text);
        else if (m.type === 'attributes') doAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start();
  else addEventListener('DOMContentLoaded', start);
}

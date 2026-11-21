/**
 * Анимации при прокрутке по всему сайту.
 *
 * Элементы находятся по селекторам (RULES) — компоненты трогать не нужно,
 * новые узлы подхватывает MutationObserver. Когда элемент заходит на экран,
 * получает класс .rv-in (и .rv-up, если пришёл сверху — листали вверх),
 * CSS проигрывает его анимацию. Ушёл с экрана — сбрасывается и при
 * следующем появлении проиграется снова, в какую сторону ни листай.
 * После анимации ставится .rv-done, чтобы вернулись «родные» анимации элемента.
 */

type Kind =
  | 'head' // заголовки: проявляются из размытия
  | 'rise' // блоки: всплывают
  | 'book' // тетради: падают на полку и приоткрываются
  | 'cap' // капсулы времени: письмо в конверт, клапан, сургуч
  | 'deal' // фото-карточки: раскладываются как снимки на столе
  | 'bubble' // пузыри-воспоминания на главной
  | 'stamp' // штампы и печати: вдавливаются
  | 'tl' // строки ленты: линия растёт, запись выезжает
  | 'tile' // плитки фото
  | 'pop' // мелкие карточки и цифры
  | 'spot' // экспонаты музея: включается подсветка
  | 'grid' // сетка «год в пикселях»: клетки загораются по месяцам
  | 'bar'; // полоски статистики растут

const RULES: [string, Kind][] = [
  // главная
  ['.hero-pre', 'head'],
  ['.hero-main', 'head'],
  ['.prompt-card', 'rise'],
  ['.dater', 'stamp'],
  ['.streak', 'pop'],
  ['.mc-b', 'bubble'],
  ['.otd', 'deal'],
  ['.recent-head', 'head'],
  ['.recent-card', 'deal'],
  ['.home-h', 'head'],
  ['.shelf .book-new', 'pop'],
  ['.shelf .book', 'book'],
  ['.caps .cap:not(.cap-add)', 'cap'],
  ['.cap-add', 'pop'],
  ['.how > .h2', 'head'],
  ['.how .hs', 'rise'],
  // тетрадь
  ['.nb-head', 'rise'],
  ['.tl-month', 'head'],
  ['.tl-row', 'tl'],
  ['.pw > a', 'tile'],
  ['.yp-grid', 'grid'],
  ['.yp-legend', 'rise'],
  ['.stat', 'pop'],
  ['.mbar', 'bar'],
  // музей, марки, справочник
  ['.exhibit', 'spot'],
  ['.album > *', 'stamp'],
  ['.hall-head', 'rise'],
  ['.modes > .mode', 'pop'],
  ['main .strip, main .cols > *, main .note', 'rise'],
  ['main .box', 'rise'],
  // день и капсула
  ['.panel .place-stamp', 'stamp'],
  ['.panel .day-text, .panel .day-song, .panel .navdays, .panel .why-more', 'rise'],
  ['.there-tiles > *', 'tile'],
  ['.cap-view .letter', 'rise'],
  // карта и общий доступ по ссылке
  ['.atl-map', 'rise'],
  ['.sv-hero', 'rise'],
  ['.sv-day', 'rise'],
  // общее — в конце, чтобы контейнеры выше успели разметиться первыми
  ['main .h1:not(.hero-h)', 'head'],
  ['main .h2:not(.home-h)', 'head'],
  ['main .sec', 'rise'],
];

const SKIP = '.jr-stage, .sl-modal, .mb-modal, [data-rv-skip], .leaflet-container';
const ENTER_RATIO = 0.12;

let enterIO: IntersectionObserver;
let leaveIO: IntersectionObserver;
let lastY = 0;
let up = false;
const tokens = new WeakMap<Element, number>();

function register(el: Element) {
  // уже размечен, в исключениях или внутри размеченного блока (иначе анимация сложится дважды)
  if ((el as HTMLElement).dataset.rv || el.closest(SKIP) || el.parentElement?.closest('[data-rv]')) return;
  for (const [sel, kind] of RULES) {
    if (el.matches(sel)) {
      // анимируется внешний блок целиком — вложенные размеченные снимаем
      el.querySelectorAll<HTMLElement>('[data-rv]').forEach(unregister);
      (el as HTMLElement).dataset.rv = kind;
      enterIO.observe(el);
      leaveIO.observe(el);
      return;
    }
  }
}

function unregister(el: HTMLElement) {
  enterIO.unobserve(el);
  leaveIO.unobserve(el);
  tokens.delete(el);
  delete el.dataset.rv;
  el.classList.remove('rv-in', 'rv-up', 'rv-done');
}

function scan(root: ParentNode) {
  if (root instanceof Element) register(root);
  for (const [sel] of RULES) root.querySelectorAll(sel).forEach(register);
}

function show(el: HTMLElement, i: number, fromTop: boolean) {
  el.style.setProperty('--rv-i', String(i));
  el.classList.remove('rv-done');
  el.classList.toggle('rv-up', fromTop);
  el.classList.add('rv-in');
  const t = (tokens.get(el) ?? 0) + 1;
  tokens.set(el, t);
  // ждём все анимации элемента и детей с префиксом rv- и «отпускаем» элемент
  requestAnimationFrame(() => {
    const anims = el.getAnimations({ subtree: true }).filter((a) => String((a as CSSAnimation).animationName ?? '').startsWith('rv-'));
    if (!anims.length) return;
    Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (tokens.get(el) !== t) return;
        el.classList.remove('rv-in', 'rv-up');
        el.classList.add('rv-done');
      },
      () => {},
    );
  });
}

function hide(el: HTMLElement) {
  tokens.set(el, (tokens.get(el) ?? 0) + 1);
  el.classList.remove('rv-in', 'rv-up', 'rv-done');
}

export function initReveal() {
  if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('rv-on');

  lastY = scrollY;
  addEventListener(
    'scroll',
    () => {
      const y = scrollY;
      if (Math.abs(y - lastY) > 2) up = y < lastY;
      lastY = y;
    },
    { passive: true },
  );
  addEventListener('hashchange', () => (up = false));

  enterIO = new IntersectionObserver(
    (entries) => {
      const vh = innerHeight;
      const ready = entries.filter((e) => e.isIntersecting && (e.intersectionRatio >= ENTER_RATIO || e.intersectionRect.height >= vh * 0.25) && !e.target.classList.contains('rv-in') && !e.target.classList.contains('rv-done'));
      if (!ready.length) return;
      // пришли сверху — значит листают вверх; порядок появления тогда обратный
      const fromTop = (e: IntersectionObserverEntry) => up && e.boundingClientRect.top < vh / 2;
      const top = ready.filter(fromTop);
      const bottom = ready.filter((e) => !fromTop(e));
      const byPos = (a: IntersectionObserverEntry, b: IntersectionObserverEntry) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left;
      bottom.sort(byPos).forEach((e, i) => show(e.target as HTMLElement, Math.min(i, 9), false));
      top
        .sort(byPos)
        .reverse()
        .forEach((e, i) => show(e.target as HTMLElement, Math.min(i, 9), true));
    },
    { threshold: [0, 0.05, ENTER_RATIO, 0.25, 0.5] },
  );
  // сброс — только когда элемент ушёл далеко за край, чтобы не мигал на границе
  leaveIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (!e.isIntersecting) hide(e.target as HTMLElement);
    },
    { rootMargin: '140px 0px 140px 0px', threshold: 0 },
  );

  scan(document);
  new MutationObserver((muts) => {
    for (const m of muts)
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) scan(n as Element);
      });
  }).observe(document.body, { childList: true, subtree: true });
}

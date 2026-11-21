/**
 * Зайчик Пуговка — маскот дневника. Нарисован в ChatGPT, очищен от зерна и
 * подготовлен в точных размерах 1x/2x/3x, чтобы на любом экране был чётким.
 */
export type Pose = 'idle' | 'wave' | 'happy' | 'sad' | 'think' | 'point' | 'sleep';

const FILE: Record<Pose, string> = { idle: 'idle', wave: 'wave', happy: 'happy', sad: 'sad', think: 'think', point: 'wave', sleep: 'sleep' };
// размер картинки 1x в CSS-пикселях: зайчик во всех позах одного роста
const SIZE: Record<string, [number, number]> = { idle: [74, 111], wave: [94, 111], happy: [92, 111], sad: [89, 109], think: [83, 110], sleep: [90, 86] };
const url = (f: string, x: number) => `/ui/bunny-${f}@${x}x.png`;
const srcSet = (f: string) => `${url(f, 1)} 1x, ${url(f, 2)} 2x, ${url(f, 3)} 3x`;

// все позы грузим заранее, чтобы смена позы не мигала
if (typeof window !== 'undefined') {
  const d = Math.min(3, Math.max(1, Math.round(devicePixelRatio || 1)));
  for (const f of new Set(Object.values(FILE))) new Image().src = url(f, d);
}

export default function Bunny({ pose = 'idle' }: { pose?: Pose; size?: number }) {
  const f = FILE[pose];
  const [w, h] = SIZE[f];
  return (
    <span className={'bunny pose-' + pose} aria-hidden>
      <span className="b-all">
        <img key={f} src={url(f, 1)} srcSet={srcSet(f)} width={w} height={h} style={{ ['--h' as string]: h }} alt="" draggable={false} />
      </span>
    </span>
  );
}

export const moodImg = (m: number) => `/ui/mood-${Math.max(1, Math.min(5, Math.round(m)))}.webp`;

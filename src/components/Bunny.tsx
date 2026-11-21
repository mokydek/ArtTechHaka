/** Зайчик Пуговка — маскот дневника. Рисунки сгенерированы в ChatGPT (public/ui/bunny-*.webp). */
export type Pose = 'idle' | 'wave' | 'happy' | 'sad' | 'think' | 'point' | 'sleep';

const FILE: Record<Pose, string> = {
  idle: 'bunny-idle',
  wave: 'bunny-wave',
  happy: 'bunny-happy',
  sad: 'bunny-sad',
  think: 'bunny-think',
  point: 'bunny-wave',
  sleep: 'bunny-sleep',
};
// все позы грузим заранее, чтобы смена позы не мигала
if (typeof window !== 'undefined') for (const f of new Set(Object.values(FILE))) new Image().src = `/ui/${f}.webp`;

export default function Bunny({ pose = 'idle', size = 88 }: { pose?: Pose; size?: number }) {
  return (
    <span className={'bunny pose-' + pose} style={{ width: size, height: size * 1.2 }} aria-hidden>
      <span className="b-all">
        <img key={pose} src={`/ui/${FILE[pose]}.webp`} alt="" draggable={false} />
      </span>
    </span>
  );
}

export const moodImg = (m: number) => `/ui/mood-${Math.max(1, Math.min(5, Math.round(m)))}.webp`;

/** Зайчик Пуговка — маскот дневника. Нарисован вручную в SVG, позы и мимика меняются частями. */
export type Pose = 'idle' | 'wave' | 'happy' | 'sad' | 'think' | 'point' | 'sleep';

const INK = '#4f3f99';
const FUR = '#fdf6ea';
const PINK = '#f4b3b8';
const SCARF = '#e3b23c';

export default function Bunny({ pose = 'idle', size = 88 }: { pose?: Pose; size?: number }) {
  const closedHappy = pose === 'happy';
  const asleep = pose === 'sleep';
  const sad = pose === 'sad';
  const s = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg className={'bunny pose-' + pose} viewBox="-6 -12 132 152" width={size} height={(size * 152) / 132} aria-hidden>
      <ellipse cx="60" cy="133" rx="30" ry="4.5" fill="rgba(43,33,28,.13)" />
      <g className="b-all">
        {/* хвостик */}
        <circle cx="88" cy="114" r="8.5" fill="#fff" {...s} />
        {/* уши: левое торчит, правое свисает */}
        <g className="b-ear-l">
          <ellipse cx="45" cy="20" rx="9.5" ry="23" transform="rotate(-8 45 20)" fill={FUR} {...s} />
          <ellipse cx="45.5" cy="22" rx="4.2" ry="15" transform="rotate(-8 45.5 22)" fill={PINK} />
        </g>
        <g className="b-ear-r">
          <ellipse cx="90" cy="40" rx="8.5" ry="20" transform="rotate(118 90 40)" fill={FUR} {...s} />
          <ellipse cx="90.5" cy="40.5" rx="3.8" ry="12.5" transform="rotate(118 90.5 40.5)" fill={PINK} />
        </g>
        {/* лапки-ступни и тело */}
        <ellipse cx="46" cy="125" rx="11" ry="6.5" fill={FUR} {...s} />
        <ellipse cx="74" cy="125" rx="11" ry="6.5" fill={FUR} {...s} />
        <ellipse cx="60" cy="106" rx="29" ry="23" fill={FUR} {...s} />
        <ellipse cx="60" cy="111" rx="15" ry="12" fill="#fffcf6" />
        {/* голова */}
        <ellipse cx="60" cy="63" rx="36" ry="30" fill={FUR} {...s} />
        {/* шарфик */}
        <path d="M33 87 Q60 99 87 87 L88.5 94 Q60 107 31.5 94 Z" fill={SCARF} {...s} />
        <path d="M69 97 L77 115 L69.5 117.5 L63.5 99.5 Z" fill={SCARF} {...s} />
        <path d="M70 112.5 l-1.5 5 M73.5 111.5 l-1 5" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        {/* лицо */}
        <ellipse cx="37" cy="73" rx="7" ry="4.3" fill={PINK} opacity=".6" />
        <ellipse cx="83" cy="73" rx="7" ry="4.3" fill={PINK} opacity=".6" />
        <g className="b-look">
        <g className="b-eyes">
          {closedHappy ? (
            <>
              <path d="M41.5 64 Q47 57.5 52.5 64" fill="none" stroke="#2b211c" strokeWidth="2.8" strokeLinecap="round" />
              <path d="M67.5 64 Q73 57.5 78.5 64" fill="none" stroke="#2b211c" strokeWidth="2.8" strokeLinecap="round" />
            </>
          ) : asleep ? (
            <>
              <path d="M41.5 62 Q47 67 52.5 62" fill="none" stroke="#2b211c" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M67.5 62 Q73 67 78.5 62" fill="none" stroke="#2b211c" strokeWidth="2.6" strokeLinecap="round" />
            </>
          ) : (
            <g transform={pose === 'think' ? 'translate(1.5 -2.5)' : undefined}>
              <ellipse cx="47" cy="62" rx="4.7" ry="5.8" fill="#2b211c" />
              <ellipse cx="73" cy="62" rx="4.7" ry="5.8" fill="#2b211c" />
              <circle cx="48.7" cy="59.6" r="1.7" fill="#fff" />
              <circle cx="74.7" cy="59.6" r="1.7" fill="#fff" />
            </g>
          )}
        </g>
        </g>
        {sad && (
          <path d="M41 53.5 l8 -2.5 M79 53.5 l-8 -2.5" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        )}
        <path d="M56.8 69 Q60 67.2 63.2 69 Q61 72.4 60 72.4 Q59 72.4 56.8 69 Z" fill="#e9858f" />
        {sad ? (
          <path d="M55.5 78 Q60 74.5 64.5 78" fill="none" stroke={INK} strokeWidth="1.9" strokeLinecap="round" />
        ) : asleep ? (
          <path d="M58 76 Q60 77.5 62 76" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        ) : (
          <path d="M60 72.4 v2.4 M55.5 75 Q58 78.2 60 75 Q62 78.2 64.5 75" fill="none" stroke={INK} strokeWidth="1.9" strokeLinecap="round" />
        )}
        {/* передние лапки — по позе */}
        {pose === 'happy' ? (
          <>
            <ellipse className="b-paw-l" cx="31" cy="86" rx="7" ry="9" transform="rotate(30 31 86)" fill={FUR} {...s} />
            <ellipse className="b-paw-r" cx="89" cy="86" rx="7" ry="9" transform="rotate(-30 89 86)" fill={FUR} {...s} />
          </>
        ) : pose === 'wave' ? (
          <>
            <ellipse cx="42" cy="106" rx="7" ry="9" fill={FUR} {...s} />
            <g className="b-wave">
              <ellipse cx="92" cy="84" rx="7" ry="9.5" transform="rotate(-25 92 84)" fill={FUR} {...s} />
            </g>
          </>
        ) : pose === 'sad' ? (
          <>
            <path className="b-heart" d="M60 115 C51 108 50 100.5 55 99 C57.6 98.2 59.3 99.6 60 101.4 C60.7 99.6 62.4 98.2 65 99 C70 100.5 69 108 60 115 Z" fill="#e2564f" {...s} strokeWidth="2.2" />
            <ellipse cx="50" cy="104" rx="6.5" ry="8.5" transform="rotate(35 50 104)" fill={FUR} {...s} />
            <ellipse cx="70" cy="104" rx="6.5" ry="8.5" transform="rotate(-35 70 104)" fill={FUR} {...s} />
          </>
        ) : pose === 'think' ? (
          <>
            <ellipse cx="42" cy="106" rx="7" ry="9" fill={FUR} {...s} />
            <ellipse cx="70" cy="86" rx="6.5" ry="8" transform="rotate(-20 70 86)" fill={FUR} {...s} />
          </>
        ) : pose === 'point' ? (
          <>
            <ellipse cx="42" cy="106" rx="7" ry="9" fill={FUR} {...s} />
            <g className="b-point">
              <ellipse cx="96" cy="99" rx="10" ry="6.5" transform="rotate(-12 96 99)" fill={FUR} {...s} />
            </g>
          </>
        ) : (
          <>
            <ellipse cx="42" cy="106" rx="7" ry="9" fill={FUR} {...s} />
            <ellipse cx="78" cy="106" rx="7" ry="9" fill={FUR} {...s} />
          </>
        )}
      </g>
      {pose === 'think' && (
        <g className="b-dots" fill={INK}>
          <circle cx="24" cy="30" r="2.6" />
          <circle cx="16" cy="20" r="3.4" />
          <circle cx="8" cy="8" r="4.4" />
        </g>
      )}
      {asleep && (
        <g className="b-z" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 30 h8 l-8 9 h8" />
          <path d="M4 12 h6 l-6 7 h6" />
        </g>
      )}
      {pose === 'happy' && (
        <g className="b-hearts" fill="#e2564f">
          <path d="M14 40 c-3-2.5-3-5 -1-5.6 c1-.3 1.7.3 2 1 c.3-.7 1-1.3 2-1 c2 .6 2 3.1 -1 5.6z" />
          <path d="M104 26 c-3.6-3-3.6-6 -1.2-6.8 c1.2-.4 2 .4 2.4 1.2 c.4-.8 1.2-1.6 2.4-1.2 c2.4.8 2.4 3.8 -1.2 6.8z" />
        </g>
      )}
    </svg>
  );
}

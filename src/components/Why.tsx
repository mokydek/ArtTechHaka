import type { DayRecord } from '../lib/types';
import { MODES, PARTICLE_NAMES } from '../lib/design/system';

const G: Record<string, string> = { text: 'текст', photo: 'фото', music: 'музыка', mix: 'итог' };

/** «Почему день выглядит так» — объяснимая логика системы */
export default function Why({ rec, compact }: { rec: DayRecord; compact?: boolean }) {
  const d = rec.design;
  const m = MODES[d.mode];
  const order = ['text', 'photo', 'music', 'mix'];
  const rules = [...d.rules].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return (
    <div>
      <div className="box">
        <div className="sec">Приём</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 28, lineHeight: 1.1 }}>{m.name}</div>
        <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 18 }} className="muted">
          {m.ref}
        </div>
        {!compact && (
          <>
            <p style={{ margin: '10px 0 4px', fontSize: 14 }}>{m.technique}.</p>
            <p className="note" style={{ margin: '8px 0' }}>
              {m.why}.
            </p>
          </>
        )}
        <div className="sw" style={{ marginTop: 12 }}>
          {d.palette.colors.map((c) => (
            <span key={c} style={{ background: c }} title={c} />
          ))}
          <span style={{ background: d.palette.accent, borderRadius: 999 }} title={'акцент ' + d.palette.accent} />
        </div>
        <div className="mono muted" style={{ marginTop: 8 }}>
          погода внутри: {PARTICLE_NAMES[d.particles.kind]} · воздух {Math.round(d.air * 100)}%
        </div>
      </div>
      <div className="box">
        <div className="sec">Почему день выглядит так</div>
        {rules.map((r, i) => (
          <div className="rule" key={i}>
            <span className="g">{G[r.group]}</span>
            <div>
              <div>{r.from}</div>
              <div className="to">{r.to}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

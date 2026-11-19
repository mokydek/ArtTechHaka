import type { DayRecord } from './types';

// «Музей мелочей»: сенсорные детали, которые человек сам написал, — запахи, звуки, свет, вкус, тепло, сказанные слова

export type DetailKind = 'smell' | 'sound' | 'light' | 'taste' | 'touch' | 'said';

export const DETAIL_KINDS: { id: DetailKind; title: string; mark: string; hint: string }[] = [
  { id: 'smell', title: 'Запахи', mark: '◌', hint: 'то, что пахло' },
  { id: 'sound', title: 'Звуки', mark: '◍', hint: 'то, что было слышно' },
  { id: 'light', title: 'Свет', mark: '☼', hint: 'как светило' },
  { id: 'taste', title: 'Вкус', mark: '◒', hint: 'что ели и пили' },
  { id: 'touch', title: 'Тепло и холод', mark: '✋', hint: 'что чувствовала кожа' },
  { id: 'said', title: 'Сказанное', mark: '❝', hint: 'слова, которые остались' },
];

const CUES: Record<Exclude<DetailKind, 'said'>, RegExp> = {
  smell: /(пах|аромат|запах|благоух|дым)/i,
  sound: /(слыш|звук|звуч|шум|шурш|шорох|стуч|скрип|стрекот|хруст|пел[иа]?\b|играл|музык|тишин|смеял|гудел|журч|шелест|кричал|долбил)/i,
  light: /(свет|солнц|фонар|огн|огон|закат|рассвет|сиял|мерцал|блик|луч|сумер|темн|ярк)/i,
  taste: /(какао|кофе|ча[йяюе]|торт|вкус|ел[иа]?\b|пил[иа]?\b|шашлык|плов|пицц|морожен|вино|глинтвейн|шоколад|ужин|завтрак)/i,
  touch: /(холод|тепл|мёрз|мерз|мороз|ветер|ветр|дожд|снег|капл|плед|босиком|песк|мягк|жарк|жар\b|горяч|прохлад|мокр|дрожал|обнял)/i,
};

export interface Detail {
  kind: DetailKind;
  text: string;
  day: DayRecord;
}

function clauses(text: string): string[] {
  const out: string[] = [];
  for (const sent of text.replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+/)) {
    const parts = sent.split(/[,;:—–]\s+/);
    const merged: string[] = [];
    for (const p of parts) {
      // придаточные («…так, что болели щёки») не отрываем от главного
      if (merged.length && /^(что|чтобы|как|будто|словно|котор|когда\b)/i.test(p)) merged[merged.length - 1] += ', ' + p;
      else merged.push(p);
    }
    out.push(...merged);
  }
  return out
    .map((s) => s.trim().replace(/^[—–-]\s*/, '').replace(/^(но|а|и|и\s+вот|потом)\s+/i, '').replace(/[.!?…]+$/, ''))
    .filter((s) => s.length > 6);
}

export function detailsOf(day: DayRecord): Detail[] {
  const out: Detail[] = [];
  // прямая речь в кавычках
  for (const m of day.text.matchAll(/[«"„]([^»"“]{4,120})[»"“]/g)) out.push({ kind: 'said', text: m[1].trim(), day });
  const seen = new Set<string>();
  for (const c of clauses(day.text)) {
    for (const k of Object.keys(CUES) as (keyof typeof CUES)[]) {
      if (!CUES[k].test(c)) continue;
      const key = k + c;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = c.length > 90 ? c.slice(0, 90).replace(/\s+\S*$/, '') + '…' : c;
      out.push({ kind: k, text: t.charAt(0).toUpperCase() + t.slice(1), day });
      break; // одна фраза — одна витрина (по первому совпавшему смыслу)
    }
  }
  return out;
}

export function museum(days: DayRecord[]): Record<DetailKind, Detail[]> {
  const res = { smell: [], sound: [], light: [], taste: [], touch: [], said: [] } as Record<DetailKind, Detail[]>;
  for (const d of days) for (const x of detailsOf(d)) res[x.kind].push(x);
  return res;
}

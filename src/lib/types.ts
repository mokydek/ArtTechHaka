// Общие типы «Оттиска»

export type RGB = [number, number, number];

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';
export type Weather = 'rain' | 'snow' | 'sun' | 'fog' | 'wind' | 'cold' | 'hot' | 'storm' | 'clouds';

export interface Phrase {
  key: string;
  nom: string; // именительный: «парк»
  loc?: string; // «в парке», «у пруда»
  inst?: string; // «с девушкой»
  phrase?: string; // «перед сдачей»
  gender?: 'm' | 'f' | 'n' | 'pl';
  kind?: string;
  warmth?: number; // вклад в «тепло» (-1..1)
  hits: number;
  firstIndex: number;
}

export interface TextFeatures {
  valence: number; // -1..1
  arousal: number; // -1..1
  warmth: number; // -1..1
  nostalgia: number; // 0..1
  tension: number; // 0..1
  season: Season | null;
  seasonFromText: boolean;
  timeOfDay: TimeOfDay | null;
  weather: Weather[];
  weatherWords?: Partial<Record<Weather, string>>; // какое слово дало погоду
  places: Phrase[];
  companions: Phrase[];
  objects: Phrase[];
  events: Phrase[];
  solitude: boolean;
  celebration: boolean;
  work: boolean;
  nature: boolean;
  night: boolean;
  sensory: string[]; // найденные сенсорные слова
  moodWords: { word: string; v: number; a: number }[];
  caption: string;
  wordCount: number;
}

export interface PhotoFeatures {
  palette: { hex: string; weight: number }[]; // доминирующие цвета
  brightness: number; // 0..1
  saturation: number; // 0..1
  warmth: number; // -1..1
  contrast: number; // 0..1
  edges: number; // 0..1 плотность деталей
  sky: number; // 0..1 доля «неба» в верхней трети
  lights: number; // 0..1 яркие точки в тёмном кадре
  width: number;
  height: number;
}

export interface PhotosSummary {
  count: number;
  palette: { hex: string; weight: number }[];
  brightness: number;
  saturation: number;
  warmth: number;
  contrast: number;
  edges: number;
  sky: number;
  lights: number;
}

export interface AudioFeatures {
  bpm: number;
  beatOffset: number; // секунда первой доли
  beatConfidence: number;
  key: number; // 0..11 (0 = до)
  mode: 'major' | 'minor';
  modeConfidence: number; // 0..1
  loudness: number; // 0..1
  energy: number; // 0..1 итоговая энергия
  brightness: number; // 0..1 спектральный центроид
  onsetRate: number; // атак в секунду
  dynamics: number; // 0..1 разброс громкости
  duration: number;
  peaks: number[]; // 0..1, для «дорожки»
  envelope: number[]; // громкость 4 раза в секунду
}

export interface MusicMeta {
  source: 'itunes' | 'file' | 'link';
  title: string;
  artist: string;
  genre?: string;
  year?: number;
  trackId?: number;
  previewUrl?: string;
  artwork?: string;
  link?: string; // ссылка пользователя на сервис
  serviceUrl?: string; // ссылка на трек в Apple Music
  fileName?: string;
}

export interface MusicFeatures {
  meta: MusicMeta;
  audio: AudioFeatures | null;
  // итог по музыке (с учётом жанра/эпохи)
  energy: number; // 0..1
  valence: number; // -1..1
  warmth: number; // -1..1
  era: number; // 0..1, 1 = очень давно
  electronic: boolean;
  acoustic: boolean;
  tempoClass: 'slow' | 'mid' | 'fast';
}

export type ModeId = 'impression' | 'construct' | 'film' | 'ma' | 'collage' | 'nocturne';

export type ParticleKind =
  | 'none'
  | 'leaves'
  | 'snow'
  | 'rain'
  | 'petals'
  | 'motes'
  | 'fireflies'
  | 'confetti'
  | 'sparks'
  | 'stars';

export interface Rule {
  from: string; // что заметили
  to: string; // что из этого следует в форме
  group: 'text' | 'photo' | 'music' | 'mix';
}

export interface DesignSpec {
  mode: ModeId;
  secondary: ModeId | null;
  scores: Record<ModeId, number>;
  mood: { valence: number; energy: number; warmth: number; nostalgia: number; tension: number; air: number };
  palette: {
    paper: string;
    ink: string;
    accent: string;
    colors: string[]; // 5 цветов, от тёмного к светлому
  };
  air: number; // 0..1 — сколько «воздуха» на странице
  cutBeats: number; // смена кадра каждые N долей
  transition: 'paint' | 'cut' | 'fade' | 'slide' | 'pop' | 'dissolve';
  motion: number; // 0..1 скорость движения
  grain: number; // 0..1
  strokeSize: number; // множитель мазка
  saturation: number; // множитель насыщенности
  particles: { kind: ParticleKind; density: number };
  title: { family: 'serif' | 'sans'; weight: number; italic: boolean; upper: boolean; tracking: number };
  captionSpeed: number; // символов в секунду
  seed: number;
  rules: Rule[];
  voice: VoiceProfile;
}

export interface VoiceProfile {
  rate: number;
  pitch: number;
  pauseMs: number;
  gender: 'female' | 'male';
  character: string; // «тихий и тёплый»
  musicDuck: number; // громкость музыки под голос
}

export interface DayAnalysis {
  text: TextFeatures;
  photos: PhotosSummary;
  photoList: PhotoFeatures[];
  music: MusicFeatures;
}

export interface DayRecord {
  id: string;
  createdAt: string;
  date: string; // YYYY-MM-DD
  title: string; // название папки
  folder: string; // «2026-11-19 Осенний парк и какао»
  text: string;
  music: MusicMeta;
  analysis: DayAnalysis;
  design: DesignSpec;
  photoCount: number;
  pageNo: number;
  demo?: boolean;
  ownerId?: string; // владелец (для демо-дней в облаке)
  notebookId?: string; // тетрадь
  ambience?: AmbLayer[]; // звуки дня
  sealedUntil?: string; // запечатан до (ISO)
  sealedAt?: string;
  unsealedAt?: string;
  hasVoice?: boolean; // свой голос
  voiceName?: string;
  place?: PlaceInfo; // место и погода
  hasVideo?: boolean;
  videoName?: string;
  photoUrls?: string[]; // для демо-дней: внешние ссылки на фото
  titlePattern?: string;
  hasExcerpt?: boolean;
}

// День с загруженными медиа (для просмотра)
export interface DayMedia {
  photos: string[]; // URL (blob: или https:)
  cover?: string;
  excerpt?: string; // фрагмент песни из файла
  video?: string;
  voice?: string; // свой голос
}

export type CoverStyle = 'kraft' | 'marble' | 'guava' | 'birds' | 'linen' | 'night' | 'olive' | 'ransom' | 'collage';

export interface Notebook {
  id: string;
  title: string;
  cover: { style: CoverStyle };
  createdAt: string;
  demo?: boolean;
}

export interface PlaceInfo {
  name: string; // «Астана»
  country?: string;
  lat: number;
  lon: number;
  weather?: {
    code: number; // WMO
    label: string; // «снег»
    tmax?: number;
    tmin?: number;
    precip?: number;
    wind?: number;
    sunrise?: string; // «08:12» по местному времени
    sunset?: string;
    daylight?: number; // секунд
  };
}

export type AmbKind = 'rain' | 'wind' | 'fire' | 'sea' | 'birds' | 'crickets' | 'city' | 'vinyl';
export interface AmbLayer {
  kind: AmbKind;
  gain: number; // 0..1 относительно музыки
  why: string;
}

/** Капсула времени: письмо себе в будущее */
export interface Capsule {
  kind: 'capsule';
  id: string;
  createdAt: string;
  openAt: string; // ISO — когда можно вскрыть
  text: string;
  context: { date: string; moon?: string; lastDay?: string; song?: string; place?: string };
  openedAt?: string;
  hasVoice?: boolean;
  voiceName?: string;
}

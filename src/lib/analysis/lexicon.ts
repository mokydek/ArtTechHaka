// Русский лексикон Imprint. Слова нормализованы: нижний регистр, ё → е.
// Собственная разработка команды: ключи, словоформы и правила согласования для названий папок.

const f = (base: string, ends: string[]) => ends.map((e) => base + e);

export interface LexEntry {
  key: string;
  forms: string[]; // точные словоформы
  stems?: string[]; // префиксы (только безопасные)
  nom: string;
  loc?: string;
  inst?: string;
  phrase?: string;
  gender?: 'm' | 'f' | 'n' | 'pl';
  kind?: string;
  warmth?: number;
  salience?: number;
  group?: boolean;
}

export const PLACES: LexEntry[] = [
  { key: 'park', forms: f('парк', ['', 'а', 'е', 'у', 'ом', 'и', 'ах', 'ов']), nom: 'парк', loc: 'в парке', gender: 'm', kind: 'nature', salience: 1 },
  { key: 'pond', forms: f('пруд', ['', 'а', 'у', 'ом', 'ы', 'ах']), nom: 'пруд', loc: 'у пруда', gender: 'm', kind: 'water', salience: 1.1 },
  { key: 'lake', forms: f('озер', ['о', 'а', 'е', 'у', 'ом']), nom: 'озеро', loc: 'у озера', gender: 'n', kind: 'water', salience: 1.1 },
  { key: 'sea', forms: ['море', 'моря', 'морю', 'морем', 'морской', 'морская', 'морское', 'морские'], nom: 'море', loc: 'у моря', gender: 'n', kind: 'water', warmth: 0.2, salience: 1.2 },
  { key: 'beach', forms: f('пляж', ['', 'а', 'е', 'у', 'ем']), nom: 'пляж', loc: 'на пляже', gender: 'm', kind: 'water', warmth: 0.5, salience: 1.1 },
  { key: 'river', forms: f('рек', ['а', 'и', 'е', 'у', 'ой']), nom: 'река', loc: 'у реки', gender: 'f', kind: 'water', salience: 1 },
  { key: 'shore', forms: f('берег', ['', 'а', 'у', 'ом']), nom: 'берег', loc: 'на берегу', gender: 'm', kind: 'water', salience: 0.9 },
  { key: 'forest', forms: ['лес', 'леса', 'лесу', 'лесом', 'лесе', 'лесной', 'лесная', 'лесное'], nom: 'лес', loc: 'в лесу', gender: 'm', kind: 'nature', salience: 1 },
  { key: 'mountains', forms: ['горы', 'горах', 'горам', 'гору', 'гора', 'горе', 'горой', 'горный', 'горная', 'горное'], nom: 'горы', loc: 'в горах', gender: 'pl', kind: 'nature', salience: 1.1 },
  { key: 'steppe', forms: f('степ', ['ь', 'и', 'ью']), nom: 'степь', loc: 'в степи', gender: 'f', kind: 'nature', salience: 1.1 },
  { key: 'field', forms: ['поле', 'полю', 'полем', 'полях'], nom: 'поле', loc: 'в поле', gender: 'n', kind: 'nature', salience: 0.9 },
  { key: 'garden', forms: ['сад', 'сада', 'саду', 'садом', 'саде'], nom: 'сад', loc: 'в саду', gender: 'm', kind: 'nature', salience: 1 },
  { key: 'dacha', forms: f('дач', ['а', 'е', 'у', 'и']), nom: 'дача', loc: 'на даче', gender: 'f', kind: 'nature', warmth: 0.3, salience: 1 },
  { key: 'village', forms: f('деревн', ['я', 'е', 'ю', 'и']), nom: 'деревня', loc: 'в деревне', gender: 'f', kind: 'nature', warmth: 0.3, salience: 1 },
  { key: 'city', forms: f('город', ['', 'а', 'е', 'у', 'ом']), nom: 'город', loc: 'в городе', gender: 'm', kind: 'urban', salience: 0.6 },
  { key: 'street', forms: f('улиц', ['а', 'е', 'у', 'ы', 'ам', 'ах']), nom: 'улица', loc: 'на улице', gender: 'f', kind: 'urban', salience: 0.35 },
  { key: 'embankment', forms: f('набережн', ['ая', 'ой', 'ую']), nom: 'набережная', loc: 'на набережной', gender: 'f', kind: 'water', salience: 1 },
  { key: 'roof', forms: f('крыш', ['а', 'е', 'у', 'и']), nom: 'крыша', loc: 'на крыше', gender: 'f', kind: 'urban', salience: 1.1 },
  { key: 'balcony', forms: f('балкон', ['', 'е', 'а', 'у']), nom: 'балкон', loc: 'на балконе', gender: 'm', kind: 'home', warmth: 0.2, salience: 0.9 },
  { key: 'office', forms: f('офис', ['', 'е', 'а', 'у', 'ом']), nom: 'офис', loc: 'в офисе', gender: 'm', kind: 'work', warmth: -0.5, salience: 1 },
  { key: 'kitchen', forms: f('кухн', ['я', 'е', 'ю', 'и']), nom: 'кухня', loc: 'на кухне', gender: 'f', kind: 'home', warmth: 0.5, salience: 1 },
  { key: 'home', forms: ['дом', 'дома', 'домой', 'доме', 'домом', 'дому', 'домашний', 'домашняя', 'домашнее'], nom: 'дом', loc: 'дома', gender: 'm', kind: 'home', warmth: 0.4, salience: 0.55 },
  { key: 'cafe', forms: ['кафе', 'кафешка', 'кафешке', 'кафешку', 'кофейня', 'кофейне', 'кофейню', 'кофейни', 'ресторан', 'ресторане'], nom: 'кафе', loc: 'в кафе', gender: 'n', kind: 'urban', warmth: 0.4, salience: 0.9 },
  { key: 'bar', forms: ['бар', 'бара', 'баре', 'бару', 'баром'], nom: 'бар', loc: 'в баре', gender: 'm', kind: 'party', salience: 0.9 },
  { key: 'club', forms: f('клуб', ['', 'е', 'а', 'у']), nom: 'клуб', loc: 'в клубе', gender: 'm', kind: 'party', salience: 0.9 },
  { key: 'station', forms: f('вокзал', ['', 'е', 'а', 'у']), nom: 'вокзал', loc: 'на вокзале', gender: 'm', kind: 'transit', warmth: -0.2, salience: 1 },
  { key: 'airport', forms: ['аэропорт', 'аэропорту', 'аэропорта', 'аэропорте'], nom: 'аэропорт', loc: 'в аэропорту', gender: 'm', kind: 'transit', warmth: -0.2, salience: 1 },
  { key: 'train', forms: ['поезд', 'поезде', 'поезда', 'поездом', 'электричка', 'электричке', 'электричку'], nom: 'поезд', loc: 'в поезде', gender: 'm', kind: 'transit', salience: 1 },
  { key: 'car', forms: f('машин', ['а', 'е', 'у', 'ой']), nom: 'машина', loc: 'в машине', gender: 'f', kind: 'transit', salience: 0.6 },
  { key: 'university', forms: ['универ', 'универе', 'университет', 'университете', 'универа'], nom: 'университет', loc: 'в универе', gender: 'm', kind: 'work', salience: 0.9 },
  { key: 'school', forms: f('школ', ['а', 'е', 'у', 'ы']), nom: 'школа', loc: 'в школе', gender: 'f', kind: 'work', salience: 0.9 },
  { key: 'gym', forms: ['спортзал', 'спортзале', 'тренажерка', 'тренажерке', 'качалка', 'качалке', 'зале'], nom: 'зал', loc: 'в зале', gender: 'm', kind: 'sport', salience: 0.8 },
  { key: 'ring', forms: ['ринг', 'ринге', 'ринга'], nom: 'ринг', loc: 'на ринге', gender: 'm', kind: 'sport', salience: 1.1 },
  { key: 'rink', forms: ['каток', 'катке', 'катка'], nom: 'каток', loc: 'на катке', gender: 'm', kind: 'sport', warmth: -0.3, salience: 1.1 },
  { key: 'bridge', forms: ['мост', 'мосту', 'моста', 'мостом'], nom: 'мост', loc: 'на мосту', gender: 'm', kind: 'urban', salience: 1 },
  { key: 'square', forms: f('площад', ['ь', 'и', 'ью']), nom: 'площадь', loc: 'на площади', gender: 'f', kind: 'urban', salience: 0.9 },
  { key: 'museum', forms: f('музе', ['й', 'е', 'я', 'ю']), nom: 'музей', loc: 'в музее', gender: 'm', kind: 'culture', salience: 1 },
  { key: 'cinema', forms: ['кинотеатр', 'кинотеатре'], nom: 'кино', loc: 'в кино', gender: 'n', kind: 'culture', salience: 0.9 },
  { key: 'concert', forms: f('концерт', ['', 'е', 'а', 'у']), nom: 'концерт', loc: 'на концерте', gender: 'm', kind: 'party', salience: 1.2 },
  { key: 'yard', forms: ['двор', 'дворе', 'двора', 'двором'], nom: 'двор', loc: 'во дворе', gender: 'm', kind: 'urban', salience: 0.8 },
  { key: 'hackathon', forms: ['хакатон', 'хакатоне', 'хакатона'], nom: 'хакатон', loc: 'на хакатоне', gender: 'm', kind: 'work', salience: 1.2 },
];

export const COMPANIONS: LexEntry[] = [
  { key: 'girlfriend', forms: ['девушка', 'девушкой', 'девушке', 'девушку', 'девушки'], nom: 'девушка', inst: 'с девушкой', salience: 1.2 },
  { key: 'boyfriend', forms: ['парень', 'парнем', 'парня', 'парню'], nom: 'парень', inst: 'с парнем', salience: 1.2 },
  { key: 'friends', forms: ['друзья', 'друзьями', 'друзей', 'друзьям'], nom: 'друзья', inst: 'с друзьями', group: true, salience: 1 },
  { key: 'friend', forms: ['другом', 'друга'], nom: 'друг', inst: 'с другом', salience: 1 },
  { key: 'gfriend', forms: ['подруга', 'подругой', 'подруге', 'подругу'], nom: 'подруга', inst: 'с подругой', salience: 1 },
  { key: 'gfriends', forms: ['подруги', 'подругами', 'подруг'], nom: 'подруги', inst: 'с подругами', group: true, salience: 1 },
  { key: 'mom', forms: ['мама', 'мамой', 'маме', 'маму', 'мамы', 'мамочка', 'мамулей', 'мамой'], nom: 'мама', inst: 'с мамой', warmth: 0.4, salience: 1.1 },
  { key: 'dad', forms: ['папа', 'папой', 'папе', 'папу', 'папы', 'отец', 'отцом'], nom: 'папа', inst: 'с папой', warmth: 0.3, salience: 1.1 },
  { key: 'parents', forms: ['родители', 'родителями', 'родителей', 'родителям'], nom: 'родители', inst: 'с родителями', group: true, warmth: 0.4, salience: 1.1 },
  { key: 'brother', forms: ['брат', 'братом', 'брата', 'брату', 'братья', 'братьями', 'братишкой'], nom: 'брат', inst: 'с братом', salience: 1.1 },
  { key: 'sister', forms: f('сестр', ['а', 'ой', 'е', 'у', 'ы', 'енкой', 'ичкой']), nom: 'сестра', inst: 'с сестрой', salience: 1.1 },
  { key: 'family', forms: ['семья', 'семьей', 'семье', 'семью', 'семьи'], nom: 'семья', inst: 'с семьёй', group: true, warmth: 0.5, salience: 1.1 },
  { key: 'grandma', forms: ['бабушка', 'бабушкой', 'бабушке', 'бабушку', 'бабушки', 'бабуля', 'бабулей'], nom: 'бабушка', inst: 'с бабушкой', warmth: 0.6, salience: 1.2 },
  { key: 'grandpa', forms: ['дедушка', 'дедушкой', 'дедушке', 'дедушку', 'дедом'], nom: 'дедушка', inst: 'с дедушкой', warmth: 0.5, salience: 1.2 },
  { key: 'colleagues', forms: ['коллеги', 'коллегами', 'коллег', 'коллегам'], nom: 'коллеги', inst: 'с коллегами', group: true, salience: 0.9 },
  { key: 'team', forms: f('команд', ['а', 'ой', 'е', 'у', 'ы']), nom: 'команда', inst: 'с командой', group: true, salience: 0.9 },
  { key: 'dog', forms: ['собака', 'собакой', 'собаке', 'собаку', 'пес', 'псом', 'щенок', 'щенком'], nom: 'собака', inst: 'с собакой', warmth: 0.4, salience: 1.1 },
  { key: 'cat', forms: ['кот', 'котом', 'кошка', 'кошкой', 'котик', 'котиком'], nom: 'кот', inst: 'с котом', warmth: 0.5, salience: 1.1 },
  { key: 'wife', forms: ['жена', 'женой', 'жене', 'жену'], nom: 'жена', inst: 'с женой', salience: 1.2 },
  { key: 'husband', forms: ['муж', 'мужем', 'мужа', 'мужу'], nom: 'муж', inst: 'с мужем', salience: 1.2 },
  { key: 'son', forms: ['сын', 'сыном', 'сыну', 'сына'], nom: 'сын', inst: 'с сыном', salience: 1.2 },
  { key: 'daughter', forms: ['дочка', 'дочкой', 'дочь', 'дочерью', 'дочке'], nom: 'дочка', inst: 'с дочкой', salience: 1.2 },
  { key: 'kids', forms: ['дети', 'детьми', 'детей'], nom: 'дети', inst: 'с детьми', group: true, salience: 1.1 },
  { key: 'classmates', forms: ['одноклассники', 'одноклассниками', 'одногруппники', 'одногруппниками'], nom: 'одноклассники', inst: 'с одноклассниками', group: true, salience: 1 },
  { key: 'coach', forms: ['тренер', 'тренером', 'тренеру'], nom: 'тренер', inst: 'с тренером', salience: 0.9 },
];

export const SOLITUDE = ['одиночестве', 'одиночество', 'одна', 'один', 'сама', 'наедине'];

export const OBJECTS: LexEntry[] = [
  { key: 'cocoa', forms: ['какао'], nom: 'какао', gender: 'n', warmth: 0.8, salience: 1 },
  { key: 'coffee', forms: ['кофе', 'кофейку', 'капучино', 'латте', 'раф'], nom: 'кофе', gender: 'm', warmth: 0.4, salience: 0.8 },
  { key: 'tea', forms: ['чай', 'чаем', 'чая', 'чаю', 'чаек'], nom: 'чай', gender: 'm', warmth: 0.5, salience: 0.8 },
  { key: 'mulled', forms: ['глинтвейн', 'глинтвейна', 'глинтвейном'], nom: 'глинтвейн', gender: 'm', warmth: 0.8, salience: 1 },
  { key: 'wine', forms: ['вино', 'вином'], nom: 'вино', gender: 'n', warmth: 0.3, salience: 0.7 },
  { key: 'pizza', forms: f('пицц', ['а', 'у', 'ей', 'ы']), nom: 'пицца', gender: 'f', warmth: 0.2, salience: 0.8 },
  { key: 'icecream', forms: ['мороженое', 'мороженым', 'мороженку', 'мороженки'], nom: 'мороженое', gender: 'n', warmth: 0.2, salience: 0.9 },
  { key: 'shashlik', forms: ['шашлык', 'шашлыки', 'шашлыками', 'шашлыков'], nom: 'шашлыки', gender: 'pl', warmth: 0.5, salience: 0.9 },
  { key: 'plov', forms: ['плов', 'плова', 'пловом'], nom: 'плов', gender: 'm', warmth: 0.5, salience: 0.9 },
  { key: 'beshbarmak', forms: ['бешбармак', 'бешбармака', 'баурсаки', 'баурсаков'], nom: 'бешбармак', gender: 'm', warmth: 0.6, salience: 1 },
  { key: 'cake', forms: ['торт', 'торта', 'тортом', 'тортик'], nom: 'торт', gender: 'm', warmth: 0.3, salience: 0.9 },
  { key: 'bonfire', forms: ['костер', 'костра', 'костром', 'костре'], nom: 'костёр', gender: 'm', warmth: 0.9, salience: 1.1 },
  { key: 'blanket', forms: ['плед', 'пледом', 'пледе'], nom: 'плед', gender: 'm', warmth: 0.7, salience: 0.9 },
  { key: 'candles', forms: f('свеч', ['и', 'ами', 'а', 'ей', 'ой']), nom: 'свечи', gender: 'pl', warmth: 0.7, salience: 0.9 },
  { key: 'fireplace', forms: ['камин', 'камина', 'камином'], nom: 'камин', gender: 'm', warmth: 0.9, salience: 1 },
  { key: 'guitar', forms: f('гитар', ['а', 'у', 'ой', 'е', 'ы']), nom: 'гитара', gender: 'f', warmth: 0.4, salience: 1 },
  { key: 'book', forms: f('книг', ['а', 'у', 'ой', 'и', 'е']), nom: 'книга', gender: 'f', warmth: 0.3, salience: 0.8 },
  { key: 'film', forms: ['фильм', 'фильмы', 'фильма', 'фильмом', 'сериал', 'сериалы', 'сериала'], nom: 'фильм', gender: 'm', salience: 0.7 },
  { key: 'talks', forms: ['разговор', 'разговоры', 'разговаривали', 'разговорами', 'разговоров', 'болтали', 'говорили'], nom: 'разговоры', gender: 'pl', warmth: 0.3, salience: 0.6 },
  { key: 'walk', forms: ['гуляли', 'гулял', 'гуляла', 'прогулка', 'прогулку', 'прогулке', 'гулять'], nom: 'прогулка', gender: 'f', salience: 0.4 },
  { key: 'dances', forms: ['танцы', 'танцевали', 'танцевал', 'танцевала', 'танцах'], nom: 'танцы', gender: 'pl', salience: 0.9 },
  { key: 'songs', forms: ['песни', 'пели', 'песнями'], nom: 'песни', gender: 'pl', salience: 0.7 },
  { key: 'stars', forms: ['звезды', 'звездами', 'звезд'], nom: 'звёзды', gender: 'pl', salience: 0.9 },
  { key: 'sunset', forms: ['закат', 'заката', 'закатом', 'закате'], nom: 'закат', gender: 'm', warmth: 0.5, salience: 0.9 },
  { key: 'sunrise', forms: ['рассвет', 'рассвета', 'рассветом'], nom: 'рассвет', gender: 'm', warmth: 0.3, salience: 0.9 },
  { key: 'fireworks', forms: ['салют', 'фейерверк', 'салюта', 'фейерверки'], nom: 'салют', gender: 'm', salience: 1 },
  { key: 'lights', forms: ['гирлянды', 'гирлянда', 'огни', 'огоньки', 'фонари', 'фонарей'], nom: 'огни', gender: 'pl', warmth: 0.3, salience: 0.7 },
  { key: 'leaves', forms: ['листья', 'листьях', 'листьями', 'листопад', 'листва', 'листву', 'листвой'], nom: 'листопад', gender: 'm', warmth: 0.2, salience: 0.7 },
  { key: 'bike', forms: ['велосипед', 'велосипеде', 'велосипедах', 'велик', 'велике'], nom: 'велосипед', gender: 'm', salience: 0.9 },
  { key: 'code', forms: ['код', 'кодил', 'кодили', 'кодинг', 'баг', 'баги', 'релиз'], nom: 'код', gender: 'm', warmth: -0.3, salience: 0.6 },
  { key: 'headphones', forms: ['наушниках', 'наушники'], nom: 'наушники', gender: 'pl', warmth: -0.1, salience: 0.3 },
];

export const EVENTS: LexEntry[] = [
  { key: 'deadline', forms: ['дедлайн', 'дедлайна', 'дедлайном', 'сдача', 'сдачи', 'сдачей', 'сдачу'], nom: 'сдача проекта', phrase: 'перед сдачей', kind: 'work', salience: 1.3 },
  { key: 'exam', forms: ['экзамен', 'экзамена', 'экзаменом', 'сессия', 'сессии'], nom: 'экзамен', phrase: 'перед экзаменом', kind: 'work', salience: 1.2 },
  { key: 'birthday', forms: ['днюха', 'днюхе', 'днюху', 'днюхи'], nom: 'день рождения', phrase: 'в день рождения', kind: 'celebration', salience: 1.4 },
  { key: 'wedding', forms: f('свадьб', ['а', 'е', 'у', 'ы']), nom: 'свадьба', phrase: 'на свадьбе', kind: 'celebration', salience: 1.4 },
  { key: 'graduation', forms: ['выпускной', 'выпускном', 'выпускного'], nom: 'выпускной', phrase: 'на выпускном', kind: 'celebration', salience: 1.4 },
  { key: 'party', forms: ['вечеринка', 'вечеринке', 'вечеринку', 'туса', 'тусовка', 'тусовке', 'тусе'], nom: 'вечеринка', phrase: 'на вечеринке', kind: 'celebration', salience: 1.1 },
  { key: 'trip', forms: ['поездка', 'поездке', 'путешествие', 'путешествии', 'дорога', 'дороге', 'дорогу'], nom: 'дорога', phrase: 'в дороге', kind: 'trip', salience: 0.9 },
  { key: 'move', forms: ['переезд', 'переезда', 'переездом'], nom: 'переезд', phrase: 'перед переездом', kind: 'life', salience: 1.2 },
  { key: 'training', forms: ['тренировка', 'тренировки', 'тренировку', 'тренировке', 'спарринг', 'спарринга'], nom: 'тренировка', phrase: 'после тренировки', kind: 'sport', salience: 1 },
  { key: 'tournament', forms: ['турнир', 'турнире', 'турнира', 'соревнования', 'соревнованиях'], nom: 'турнир', phrase: 'в день турнира', kind: 'sport', salience: 1.3 },
  { key: 'date', forms: ['свидание', 'свидании', 'свиданку'], nom: 'свидание', phrase: 'на свидании', kind: 'love', salience: 1.3 },
];

// Биграммы — проверяются по нормализованному тексту
export const BIGRAM_EVENTS: { re: RegExp; key: string; nom: string; phrase: string; kind: string; salience: number }[] = [
  { re: /день рождени|дне рождени|дня рождени|днем рождени/, key: 'birthday', nom: 'день рождения', phrase: 'в день рождения', kind: 'celebration', salience: 1.4 },
  { re: /нов(ый|ого|ым) год|под новый/, key: 'newyear', nom: 'Новый год', phrase: 'под Новый год', kind: 'celebration', salience: 1.4 },
  { re: /перв(ый|ого|ым) снег/, key: 'firstsnow', nom: 'первый снег', phrase: 'в первый снег', kind: 'nature', salience: 1.5 },
];

export interface MoodWord {
  stems: string[];
  v: number;
  a: number;
}

export const MOOD: MoodWord[] = [
  // спокойное и светлое
  { stems: ['спокой', 'умиротвор', 'безмятеж', 'расслаб'], v: 0.55, a: -0.65 },
  { stems: ['тих', 'тишин'], v: 0.2, a: -0.6 },
  { stems: ['уют'], v: 0.7, a: -0.4 },
  { stems: ['нежн', 'нежно', 'ласков'], v: 0.65, a: -0.4 },
  { stems: ['мягк'], v: 0.4, a: -0.4 },
  { stems: ['ленив', 'лениво'], v: 0.3, a: -0.6 },
  { stems: ['сонн', 'сонлив'], v: 0.1, a: -0.7 },
  { stems: ['медленн', 'неспешн', 'неторопл'], v: 0.15, a: -0.55 },
  { stems: ['благодар'], v: 0.7, a: -0.1 },
  { stems: ['обним', 'обнял', 'объят'], v: 0.75, a: 0.0 },
  { stems: ['любим', 'люблю', 'любов', 'любил'], v: 0.8, a: 0.1 },
  { stems: ['мило', 'милый', 'милая', 'милое'], v: 0.6, a: -0.1 },
  { stems: ['хорош', 'приятн', 'душевн', 'тепло'], v: 0.55, a: -0.15 },
  { stems: ['красив', 'прекрас', 'волшебн', 'сказочн'], v: 0.7, a: 0.1 },
  // яркое и радостное
  { stems: ['счаст'], v: 0.9, a: 0.4 },
  { stems: ['радост', 'радовал', 'обрадов', 'рады', 'рада'], v: 0.8, a: 0.4 },
  { stems: ['весел', 'веселье'], v: 0.8, a: 0.6 },
  { stems: ['смея', 'смех', 'смешн', 'ржал', 'хохот'], v: 0.8, a: 0.6 },
  { stems: ['восторг', 'кайф', 'обожа'], v: 0.9, a: 0.7 },
  { stems: ['круто', 'крут', 'класс', 'офигенн', 'шикарн'], v: 0.7, a: 0.6 },
  { stems: ['праздн', 'ура'], v: 0.75, a: 0.6 },
  { stems: ['танцева', 'прыга', 'орал', 'кричал'], v: 0.6, a: 0.85 },
  { stems: ['бегал', 'бежал', 'носились'], v: 0.2, a: 0.7 },
  { stems: ['азарт', 'драйв', 'адреналин'], v: 0.5, a: 0.9 },
  { stems: ['побед', 'победи', 'выиграл', 'горжусь', 'гордост'], v: 0.8, a: 0.75 },
  { stems: ['вдохнов', 'свобод'], v: 0.75, a: 0.45 },
  { stems: ['ярк', 'солнечн'], v: 0.55, a: 0.4 },
  // грустное и тихое
  { stems: ['грус', 'печал', 'тоск'], v: -0.65, a: -0.3 },
  { stems: ['одинок'], v: -0.6, a: -0.4 },
  { stems: ['устал', 'усталост', 'вымотал'], v: -0.4, a: -0.45 },
  { stems: ['скучн', 'скукот'], v: -0.4, a: -0.55 },
  { stems: ['скучал', 'скучаю'], v: -0.2, a: -0.3 },
  { stems: ['пусто', 'пустот'], v: -0.45, a: -0.45 },
  { stems: ['серый', 'серая', 'серое', 'серые', 'серо', 'серост'], v: -0.25, a: -0.35 },
  { stems: ['меланхол', 'задумчив', 'задумал'], v: -0.15, a: -0.5 },
  { stems: ['жаль', 'жалко'], v: -0.4, a: -0.2 },
  { stems: ['плак', 'слез', 'рыдал'], v: -0.6, a: 0.3 },
  { stems: ['разочаров', 'обид', 'потерял', 'потеря'], v: -0.6, a: 0.1 },
  { stems: ['прощал', 'прощани', 'простились'], v: -0.35, a: 0.0 },
  // напряжённое
  { stems: ['стресс', 'нерв'], v: -0.55, a: 0.8 },
  { stems: ['паник', 'ужас'], v: -0.7, a: 0.9 },
  { stems: ['тревог', 'тревож', 'волновал', 'переживал'], v: -0.5, a: 0.6 },
  { stems: ['страх', 'страшн', 'боял'], v: -0.65, a: 0.7 },
  { stems: ['злой', 'злая', 'злил', 'злост', 'бесит', 'бесил', 'раздраж'], v: -0.7, a: 0.7 },
  { stems: ['срочн', 'аврал', 'горел', 'горит'], v: -0.25, a: 0.85 },
  { stems: ['дедлайн'], v: -0.3, a: 0.8 },
  { stems: ['напряж', 'сосредоточ', 'собран'], v: -0.2, a: 0.65 },
  { stems: ['хаос', 'сумасшед', 'бешен'], v: -0.15, a: 0.85 },
  { stems: ['ругал', 'ссор', 'поссор'], v: -0.7, a: 0.6 },
  { stems: ['опазд', 'спешил', 'спешка', 'торопил'], v: -0.2, a: 0.65 },
  { stems: ['бессон', 'не спал'], v: -0.3, a: 0.4 },
];

export const NEGATIONS = ['не', 'ни', 'без', 'нет'];
export const INTENSIFIERS = ['очень', 'так', 'такой', 'такая', 'сильно', 'безумно', 'невероятно', 'жутко', 'супер', 'самый', 'самая'];

export const NOSTALGIA_STEMS = ['вспомин', 'вспомн', 'детств', 'ностальг', 'когда-то', 'давно', 'школьн', 'пластинк', 'пленк', 'фотоаппарат', 'как раньше', 'старые', 'старый', 'старая'];
export const WORK_STEMS = ['работ', 'офис', 'проект', 'сдач', 'дедлайн', 'отчет', 'совещан', 'созвон', 'код', 'баг', 'релиз', 'экзамен', 'сесси', 'учеб', 'задач', 'клиент', 'презентац', 'хакатон', 'монитор', 'ноутбук'];
export const CELEBRATION_STEMS = ['праздн', 'днюх', 'свадьб', 'выпускн', 'вечеринк', 'тусовк', 'туса', 'концерт', 'фестивал', 'салют', 'фейерверк', 'подарк', 'торт', 'шарик', 'поздрав'];
export const NATURE_STEMS = ['парк', 'лес', 'озер', 'степ', 'небо', 'неба', 'листь', 'листв', 'трав', 'деревь', 'закат', 'рассвет', 'звезд', 'берег', 'пляж', 'природ', 'птиц', 'облак', 'пруд'];
// точные формы — чтобы «города», «мороз», «садились» не считались природой
export const NATURE_FORMS = ['горы', 'горах', 'гору', 'море', 'моря', 'морем', 'морю', 'река', 'реки', 'реке', 'реку', 'рекой', 'поле', 'полю', 'полях', 'сад', 'саду', 'сада', 'цветы', 'цветов', 'цветами', 'дерево', 'деревья'];
export const SENSORY_STEMS = ['запах', 'пахл', 'пахн', 'аромат', 'звук', 'звучал', 'слыш', 'шум', 'шорох', 'скрип', 'тишин', 'свет', 'лучи', 'блик', 'огни', 'фонар', 'тепл', 'холод', 'мороз', 'ветер', 'вкус', 'мягк', 'хруст', 'капл', 'плед', 'шелест', 'журч', 'мерцал', 'сиял', 'горяч', 'прохлад'];

export const SEASON_CUES: { season: 'winter' | 'spring' | 'summer' | 'autumn'; stems: string[]; forms?: string[] }[] = [
  { season: 'autumn', stems: ['осен', 'листопад', 'сентябр', 'октябр', 'ноябр', 'желт'] },
  { season: 'winter', stems: ['зим', 'снег', 'снеж', 'мороз', 'декабр', 'январ', 'феврал', 'елк', 'сугроб', 'метел', 'вьюг', 'гололед'] },
  { season: 'spring', stems: ['весн', 'весен', 'март', 'апрел', 'подснеж', 'капел', 'цветени', 'сирен'], forms: ['май', 'мае', 'мая'] },
  { season: 'summer', stems: ['июн', 'июл', 'август', 'загар', 'зной', 'жара'], forms: ['лето', 'летом', 'летний', 'летняя', 'летнее', 'летние', 'летнюю', 'летнего'] },
];

export const TIME_CUES: { time: 'morning' | 'day' | 'evening' | 'night'; stems: string[] }[] = [
  { time: 'morning', stems: ['утр', 'рассвет', 'проснул', 'завтрак', 'спозаранку'] },
  { time: 'day', stems: ['днем', 'полдень', 'обед', 'днём', 'весь день', 'целый день'] },
  { time: 'evening', stems: ['вечер', 'закат', 'ужин', 'сумерк'] },
  { time: 'night', stems: ['ноч', 'полноч', 'луна', 'луной', 'до утра', 'звездн'] },
];

export const WEATHER_CUES: { w: 'rain' | 'snow' | 'sun' | 'fog' | 'wind' | 'cold' | 'hot' | 'storm' | 'clouds'; stems: string[]; warmth: number }[] = [
  { w: 'rain', stems: ['дожд', 'ливен', 'ливн', 'лужи', 'лужах', 'зонт', 'морос'], warmth: -0.3 },
  { w: 'snow', stems: ['снег', 'снеж', 'метел', 'вьюг', 'сугроб'], warmth: -0.4 },
  { w: 'sun', stems: ['солнц', 'солнечн', 'ясн'], warmth: 0.6 },
  { w: 'fog', stems: ['туман'], warmth: -0.2 },
  { w: 'wind', stems: ['ветер', 'ветрен', 'ветра', 'ветром'], warmth: -0.25 },
  { w: 'cold', stems: ['холод', 'мороз', 'зябк', 'замерз', 'продрог'], warmth: -0.5 },
  { w: 'hot', stems: ['жарк', 'жара', 'зной', 'душн', 'пекло'], warmth: 0.7 },
  { w: 'storm', stems: ['гроз', 'молни', 'громыха', 'гремел'], warmth: -0.2 },
  { w: 'clouds', stems: ['пасмурн', 'облачн', 'тучи', 'хмур'], warmth: -0.2 },
];

// ——— Согласование прилагательных для названий ———
type Decl = 'hard' | 'velar' | 'soft';
const ENDINGS: Record<Decl, Record<'m' | 'f' | 'n' | 'pl', string>> = {
  hard: { m: 'ый', f: 'ая', n: 'ое', pl: 'ые' },
  velar: { m: 'ий', f: 'ая', n: 'ое', pl: 'ие' },
  soft: { m: 'ий', f: 'яя', n: 'ее', pl: 'ие' },
};
export function adj(stem: string, decl: Decl, g: 'm' | 'f' | 'n' | 'pl'): string {
  return stem + ENDINGS[decl][g];
}

export const SEASON_ADJ: Record<string, [string, Decl]> = {
  autumn: ['осенн', 'soft'],
  winter: ['зимн', 'soft'],
  spring: ['весенн', 'soft'],
  summer: ['летн', 'soft'],
};

export const MONTH_ADJ: [string, Decl][] = [
  ['январск', 'velar'],
  ['февральск', 'velar'],
  ['мартовск', 'velar'],
  ['апрельск', 'velar'],
  ['майск', 'velar'],
  ['июньск', 'velar'],
  ['июльск', 'velar'],
  ['августовск', 'velar'],
  ['сентябрьск', 'velar'],
  ['октябрьск', 'velar'],
  ['ноябрьск', 'velar'],
  ['декабрьск', 'velar'],
];

export const WEATHER_ADJ: Record<string, [string, Decl]> = {
  rain: ['дождлив', 'hard'],
  snow: ['снежн', 'hard'],
  fog: ['туманн', 'hard'],
  sun: ['солнечн', 'hard'],
  cold: ['холодн', 'hard'],
  hot: ['жарк', 'velar'],
  wind: ['ветрен', 'hard'],
  storm: ['грозов', 'hard'],
  clouds: ['пасмурн', 'hard'],
};

// Настроение → прилагательное (по квадранту валентность/энергия)
export const MOOD_ADJ: { q: 'calmPos' | 'energyPos' | 'calmNeg' | 'energyNeg'; list: [string, Decl][] }[] = [
  { q: 'calmPos', list: [['тих', 'velar'], ['тёпл', 'hard'], ['светл', 'hard'], ['уютн', 'hard'], ['нежн', 'hard']] },
  { q: 'energyPos', list: [['звонк', 'velar'], ['шумн', 'hard'], ['счастлив', 'hard'], ['ярк', 'velar']] },
  { q: 'calmNeg', list: [['сер', 'hard'], ['долг', 'velar'], ['сонн', 'hard'], ['устал', 'hard']] },
  { q: 'energyNeg', list: [['тревожн', 'hard'], ['нервн', 'hard'], ['бессонн', 'hard'], ['долг', 'velar']] },
];

export const TIME_NOUN: Record<string, { nom: string; g: 'm' | 'f' | 'n' }> = {
  morning: { nom: 'утро', g: 'n' },
  day: { nom: 'день', g: 'm' },
  evening: { nom: 'вечер', g: 'm' },
  night: { nom: 'ночь', g: 'f' },
};

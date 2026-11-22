import { useState } from 'react';

/**
 * Карточка помощи. Если в записи есть слова о том, что жить не хочется, Imprint
 * не молчит: мягко показывает, куда можно позвонить или написать прямо сейчас,
 * и помогает написать близкому. Проверка идёт на устройстве, никуда не отправляется.
 */
const CRISIS = [
  'не хочу жить',
  'не хочется жить',
  'жить не хочу',
  'жить не хочется',
  'хочу умереть',
  'хочется умереть',
  'лучше бы меня не было',
  'лучше бы я умер',
  'лучше бы я умерла',
  'покончить с собой',
  'покончу с собой',
  'убить себя',
  'убью себя',
  'свести счеты с жизнью',
  'уйти из жизни',
  'нет смысла жить',
  'незачем жить',
  'суицид',
  'самоубийств',
  'порезать себя',
  'резать себя',
  'режу себя',
  'селфхарм',
  'селф-харм',
  'want to die',
  'kill myself',
  'end my life',
  'suicide',
  'self-harm',
  "don't want to live",
  'dont want to live',
];

export function needsHelp(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  return CRISIS.some((w) => t.includes(w));
}

const ASK = 'Мне сейчас очень тяжело. Можешь побыть со мной или позвонить?';

export default function HelpCard() {
  const [copied, setCopied] = useState(false);
  const write = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) return void nav.share({ text: ASK }).catch(() => {});
    await navigator.clipboard?.writeText(ASK).catch(() => {});
    setCopied(true);
  };
  return (
    <div className="help-card" role="note">
      <p className="hc-lead">Похоже, тебе сейчас очень тяжело. С этим не нужно справляться в одиночку.</p>
      <p>Можно позвонить или написать прямо сейчас, бесплатно:</p>
      <ul>
        <li>
          <a href="tel:150">
            <b>150</b>
          </a>{' '}
          национальная линия доверия для детей и молодёжи, WhatsApp{' '}
          <a href="https://wa.me/77081060810" target="_blank" rel="noreferrer">
            +7 708 106-08-10
          </a>
        </li>
        <li>
          <a href="tel:112">
            <b>112</b>
          </a>{' '}
          если есть опасность прямо сейчас
        </li>
      </ul>
      <div className="hc-acts">
        <button className="btn small" onClick={write}>
          Написать близкому
        </button>
        {copied && <span className="hc-note">Текст скопирован, вставь его в сообщение: «{ASK}»</span>}
      </div>
      <p className="hc-small">Imprint не заменяет психолога. Эта подсказка появляется прямо на устройстве, мы никому о ней не сообщаем.</p>
    </div>
  );
}

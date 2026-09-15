// ブロックに表示する「お祈りメール」「落選メール」の文面データ
export const EMAIL_TEXTS = [
  '厳正なる選考の結果\n今回はご期待に添えず',
  '誠に残念ながら\nご希望に沿えませんでした',
  '当選者多数のため\n抽選に外れました',
  '貴殿の益々のご活躍を\nお祈り申し上げます',
  '今後のご活躍を\n心よりお祈りしております',
  '大変恐縮ですが\n見送らせていただきます',
  '今回は縁がなかったと\nいうことで',
  '抽選の結果、落選と\nなりました',
  '選考の結果を\nお知らせいたします',
  '内定には至りません\nでした',
];

export function getEmailText(index) {
  return EMAIL_TEXTS[index % EMAIL_TEXTS.length];
}

export function getRandomEmailText() {
  return EMAIL_TEXTS[Math.floor(Math.random() * EMAIL_TEXTS.length)];
}

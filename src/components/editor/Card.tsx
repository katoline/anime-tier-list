import { memo } from 'react';
import { cardColors, cardFontSize } from '../../lib/colors';
import type { AnimeCardData } from '../../lib/data';

interface Props {
  anime: AnimeCardData;
  showImage: boolean;
  selected?: boolean;
  dragging?: boolean;
}

/** エディタ内の作品カード。画像を出さない設定のときはタイトル文字のカードになる */
export const Card = memo(function Card({ anime, showImage, selected, dragging }: Props) {
  const className = ['ecard', selected ? 'is-selected' : '', dragging ? 'is-dragging' : ''].join(' ');
  if (showImage && anime.image) {
    return (
      <div className={`${className} acard`} title={anime.title}>
        <img src={anime.image} alt={anime.title} width={64} height={96} loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  }
  const { bg, fg } = cardColors(anime);
  return (
    <div
      className={`${className} acard text`}
      title={anime.title}
      style={{ ['--card-bg' as string]: bg, ['--card-fg' as string]: fg, ['--card-fs' as string]: smallFont(anime.title) }}
    >
      <span>{anime.title}</span>
    </div>
  );
});

function smallFont(title: string): string {
  // エディタのカードは小さいので一段小さくする
  const map: Record<string, string> = { '.95rem': '.78rem', '.82rem': '.68rem', '.72rem': '.6rem', '.64rem': '.55rem' };
  return map[cardFontSize(title)] ?? '.6rem';
}

// Schreibt die App-Icons aus public/stamp.svg: schwarze Marke auf Weiß mit hartem Schatten.
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync('public/stamp.svg', 'utf8');
const inner = svg.match(/<path[^>]*\/>/)[0];
const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
const [sw, sh] = [+viewBox[1], +viewBox[2]];
const S = 1024, h = 720, k = h / sh, w = sw * k, x = (S - w) / 2 - 12, y = (S - h) / 2 - 12;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="#fff"/>
  <g transform="translate(${x + 30} ${y + 34}) scale(${k})">${inner}</g>
  <g transform="translate(${x} ${y}) scale(${k})" fill="#fff" stroke="#000" stroke-width="${10 / k}">${inner.replace('<path', '<path')}</g>
</svg>`;

mkdirSync('assets-input/generated', { recursive: true });
const png = await sharp(Buffer.from(icon)).flatten({ background: '#fff' }).png().toBuffer();
await sharp(png).toFile('assets-input/generated/icon-1024.png');
for (const size of [180, 192, 512]) await sharp(png).resize(size).toFile(`public/icon-${size}.png`);

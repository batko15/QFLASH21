// Erzeugt Launcher-Icons aus dem QFLASH21-App-Icon (bun scripts/make-apk-icons.mjs)
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const SRC = 'public/icon-source.png';
const BASE = 'apk-src/res';
mkdirSync(BASE, { recursive: true });

// Android-Launcher-Größen (mdpi=48 … xxxhdpi=192)
const sizes = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

for (const [dpi, size] of sizes) {
  await sharp(SRC)
    .resize(size, size, { fit: 'cover' })
    .flatten({ background: '#18181b' })
    .png()
    .toFile(`${BASE}/mipmap-${dpi}/ic_launcher.png`);
  console.log(`✓ mipmap-${dpi}/ic_launcher.png (${size}px)`);
}

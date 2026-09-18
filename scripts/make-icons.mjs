// Generiert PWA-Icons aus public/icon-source.png (einmalig via `bun scripts/make-icons.mjs`)
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const SRC = 'public/icon-source.png';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-192.png', size: 192, pad: 0.12 }, // Safe-Zone für Kreis-Maske
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12 },
  { file: 'apple-touch-icon.png', size: 180, opaque: '#09090b' },
];

for (const t of targets) {
  const inner = Math.round(t.size * (1 - (t.pad ?? 0) * 2));
  const resized = sharp(SRC)
    .resize(inner, inner, { fit: 'cover' })
    .flatten({ background: t.opaque ?? '#18181b' });
  if (t.pad) {
    // Zentriert auf transparentem Quadrat (Maskable-Safe-Zone)
    await sharp({
      create: { width: t.size, height: t.size, channels: 4, background: { r: 24, g: 24, b: 27, alpha: 1 } },
    })
      .composite([{ input: await resized.png().toBuffer(), gravity: 'center' }])
      .png()
      .toFile(`${OUT}/${t.file}`);
  } else {
    await resized.png().toFile(`${OUT}/${t.file}`);
  }
  console.log(`✓ ${t.file}`);
}

// Favicon 32px
await sharp(SRC).resize(32, 32).png().toFile('public/favicon-32.png');
console.log('✓ favicon-32.png');

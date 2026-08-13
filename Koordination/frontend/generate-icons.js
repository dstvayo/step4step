// Run: node generate-icons.js
// Generates PNG icons for PWA using Canvas API (Node.js with canvas package)
// Fallback: creates SVG icons if canvas not available

const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 192, 512];

function generateSVG(size) {
  const fontSize = Math.round(size * 0.45);
  const borderRadius = Math.round(size * 0.22);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2563eb"/>
      <stop offset="100%" style="stop-color:#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${borderRadius}" fill="url(#g)"/>
  <text x="50%" y="54%" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">K</text>
</svg>`;
}

const publicDir = path.join(__dirname, 'public');

sizes.forEach((size) => {
  const svgContent = generateSVG(size);
  // Write SVG (browsers can use SVG as icon source)
  fs.writeFileSync(path.join(publicDir, `icon-${size}.svg`), svgContent);
  console.log(`Created icon-${size}.svg`);
});

// Create apple-touch-icon (180x180)
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.svg'), generateSVG(180));
console.log('Created apple-touch-icon.svg');
console.log('Done. For production PNG icons, convert SVGs with: npx sharp-cli ...');

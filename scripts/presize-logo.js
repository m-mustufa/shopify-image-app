'use strict';

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, '../assets/logo.png'));
  const resized = await sharp(raw)
    .resize(176, 54, { fit: 'inside' })
    .png()
    .toBuffer();
  console.log('Resized logo base64:');
  console.log(resized.toString('base64'));
  console.log('Size:', resized.length, 'bytes');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

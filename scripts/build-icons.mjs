// Generates PNG app icons from public/icons/icon.svg.
import sharp from "sharp";
const src = "public/icons/icon.svg";
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["icon-maskable-512.png", 512],
]) {
  await sharp(src).resize(size, size).png().toFile(`public/icons/${name}`);
}
console.log("icons written");

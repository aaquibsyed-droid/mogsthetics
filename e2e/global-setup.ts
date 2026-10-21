import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/** Synthetic test photo (the mock provider does not inspect it). The DB is wiped by the webServer command. */
export default async function globalSetup() {
  await mkdir("e2e/fixtures", { recursive: true });
  const w = 1200;
  const h = 900;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#7a5a3c"/>
    <circle cx="600" cy="450" r="380" fill="#f4f2ec"/>
    <circle cx="600" cy="450" r="330" fill="#ffffff"/>
    <ellipse cx="480" cy="380" rx="150" ry="95" fill="#c98b4a"/>
    <ellipse cx="720" cy="420" rx="140" ry="120" fill="#f6f1e1"/>
    <circle cx="560" cy="600" r="70" fill="#2f6b2a"/><circle cx="640" cy="620" r="60" fill="#3d7d33"/>
    ${Array.from({ length: 220 }, (_, i) => `<circle cx="${(i * 97) % w}" cy="${(i * 53) % h}" r="${2 + (i % 5)}" fill="rgba(0,0,0,0.25)"/>`).join("")}
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile("e2e/fixtures/synthetic-meal.jpg");
}

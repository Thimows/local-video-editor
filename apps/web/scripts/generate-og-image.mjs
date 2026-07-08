import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const publicRoot = path.join(webRoot, "public")
const landingRoot = path.join(publicRoot, "landing")

const outputPath = path.join(landingRoot, "og-preview.png")
const heroImagePath = path.join(landingRoot, "editor-dark.webp")
const browserIconPaths = [
  ["Chrome", path.join(landingRoot, "browsers", "chrome.png")],
  ["Edge", path.join(landingRoot, "browsers", "edge.png")],
  ["Arc", path.join(landingRoot, "browsers", "arc.png")],
  ["Dia", path.join(landingRoot, "browsers", "dia.png")],
  ["Brave", path.join(landingRoot, "browsers", "brave.png")],
]

const width = 1800
const height = 945
const primary = "#00b0e5"
const foreground = "#171717"
const mutedForeground = "#737373"
const background = "#ffffff"
const card = "#ffffff"
const chipBackground = "rgba(246,246,246,0.75)"

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function dataUri(filePath, mimeType) {
  const data = await readFile(filePath)
  return `data:${mimeType};base64,${data.toString("base64")}`
}

function diamondPattern() {
  const pieces = []
  const centerX = 1010
  const centerY = 430

  for (let row = -9; row <= 10; row += 1) {
    for (let col = -13; col <= 15; col += 1) {
      const x = centerX + col * 34 + (row % 2) * 17
      const y = centerY + row * 34
      const distance = Math.hypot((x - centerX) / 620, (y - centerY) / 360)
      const opacity = Math.max(0, 0.26 - distance * 0.16)

      if (opacity <= 0.015) {
        continue
      }

      pieces.push(
        `<rect x="${x}" y="${y}" width="18" height="18" rx="2" transform="rotate(45 ${x + 9} ${y + 9})" fill="${primary}" opacity="${opacity.toFixed(3)}" />`
      )
    }
  }

  return pieces.join("")
}

function superellipsePoint(centerX, centerY, radius, angle, exponent) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return [
    centerX + radius * Math.sign(cos) * Math.abs(cos) ** (2 / exponent),
    centerY + radius * Math.sign(sin) * Math.abs(sin) ** (2 / exponent),
  ]
}

function appendCorner(points, centerX, centerY, radius, start, end, exponent) {
  const steps = 10

  for (let index = 1; index <= steps; index += 1) {
    const angle = start + ((end - start) * index) / steps
    const [x, y] = superellipsePoint(centerX, centerY, radius, angle, exponent)

    points.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
}

function roundedSquircleRectPath(width, height, radius = 24, exponent = 4) {
  const points = []

  points.push(`M ${radius} 0`)
  points.push(`L ${width - radius} 0`)
  appendCorner(points, width - radius, radius, radius, -Math.PI / 2, 0, exponent)
  points.push(`L ${width} ${height - radius}`)
  appendCorner(points, width - radius, height - radius, radius, 0, Math.PI / 2, exponent)
  points.push(`L ${radius} ${height}`)
  appendCorner(points, radius, height - radius, radius, Math.PI / 2, Math.PI, exponent)
  points.push(`L 0 ${radius}`)
  appendCorner(points, radius, radius, radius, Math.PI, (Math.PI * 3) / 2, exponent)

  return `${points.join(" ")} Z`
}

async function browserChips() {
  let cursorX = 92
  const chips = []

  for (const [name, iconPath] of browserIconPaths) {
    const icon = await dataUri(iconPath, "image/png")
    const chipWidth =
      name === "Chrome"
        ? 150
        : name === "Brave"
          ? 142
        : name === "Edge"
          ? 126
          : 112

    chips.push(`
      <g transform="translate(${cursorX} 722)">
        <path d="${roundedSquircleRectPath(chipWidth, 52)}" fill="${chipBackground}" />
        <image href="${icon}" x="12" y="9" width="34" height="34" preserveAspectRatio="xMidYMid meet" />
        <text x="56" y="33" font-family="Geist, Inter, Arial, sans-serif" font-size="21" font-weight="500" fill="${foreground}">${escapeXml(name)}</text>
      </g>
    `)
    cursorX += chipWidth + 12
  }

  return chips.join("")
}

async function createRoundedHeroImage() {
  const imageWidth = 1038
  const imageBuffer = await sharp(heroImagePath)
    .resize({ width: imageWidth, withoutEnlargement: true })
    .png()
    .toBuffer()
  const metadata = await sharp(imageBuffer).metadata()
  const imageHeight = metadata.height ?? 782
  const mask = Buffer.from(`
    <svg width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${imageWidth}" height="${imageHeight}" rx="18" ry="18" fill="white"/>
    </svg>
  `)

  return {
    buffer: await sharp(imageBuffer)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer(),
    height: imageHeight,
    width: imageWidth,
  }
}

async function main() {
  const browserChipMarkup = await browserChips()
  const heroImage = await createRoundedHeroImage()

  const baseSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="text-substrate" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="26" />
        </filter>
        <linearGradient id="right-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${background}" stop-opacity="0" />
          <stop offset="1" stop-color="${background}" stop-opacity="1" />
        </linearGradient>
      </defs>

      <rect width="${width}" height="${height}" fill="${background}" />
      <g opacity="0.88">${diamondPattern()}</g>
      <rect x="0" y="0" width="520" height="${height}" fill="${background}" opacity="0.38" />
      <ellipse cx="350" cy="430" rx="430" ry="310" fill="${card}" opacity="0.84" filter="url(#text-substrate)" />
      <rect x="0" y="0" width="190" height="${height}" fill="${background}" opacity="0.66" />
      <rect x="0" y="0" width="92" height="${height}" fill="${background}" />

      <g transform="translate(92 248)">
        <text font-family="Geist, Inter, Arial, sans-serif" font-size="64" font-weight="600" letter-spacing="-2.4" fill="${foreground}">
          <tspan x="0" y="0">Free online video</tspan>
          <tspan x="0" y="70">editor that keeps</tspan>
          <tspan x="0" y="140">files on your</tspan>
          <tspan x="0" y="210">computer.</tspan>
        </text>

        <text font-family="Geist, Inter, Arial, sans-serif" font-size="31" font-weight="400" letter-spacing="0" fill="${mutedForeground}">
          <tspan x="0" y="294">Cut, arrange, preview, and export</tspan>
          <tspan x="0" y="336">videos in your browser without</tspan>
          <tspan x="0" y="378">uploading your media.</tspan>
        </text>
      </g>

      <text x="92" y="698" font-family="Geist, Inter, Arial, sans-serif" font-size="22" font-weight="400" fill="${mutedForeground}">
        Works best on <tspan fill="${foreground}" font-weight="500">Chromium browsers</tspan>
      </text>
      ${browserChipMarkup}
    </svg>
  `

  await sharp(Buffer.from(baseSvg))
    .composite([
      {
        input: heroImage.buffer,
        left: 817,
        top: Math.round((height - heroImage.height) / 2),
      },
    ])
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath)

  console.log(`Generated ${path.relative(process.cwd(), outputPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

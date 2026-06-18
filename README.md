# PicstomeRater

Desktop app (macOS + Windows) that intercepts `picstome://rate?files=...&rating=1` links
from Picstome.com and automatically applies EXIF/XMP star ratings to your photos using exiftool.

Every time you click the link, the app opens a window showing the last used folder.
You can change it if needed, then confirm before rating starts.

## Requirements

- Node.js 18+
- npm

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add exiftool to `resources/`

**macOS:**
```bash
mkdir -p resources
cp $(which exiftool) resources/exiftool
chmod +x resources/exiftool
```

**Windows:**
Download from https://exiftool.org → rename `exiftool(-k).exe` to `exiftool.exe` → place in `resources/`

## Development

```bash
npm start
```

Test the URL scheme by pasting this in your browser while the app is running:
picstome://rate?files=1Z8A4331,1Z8A4373,1Z8A4378&rating=1

text

## Build

```bash
# macOS — outputs dist/PicstomeRater.dmg (universal: arm64 + x64)
npm run dist:mac

# Windows — outputs dist/PicstomeRater Setup.exe
npm run dist:win

# Both platforms at once
npm run dist:all
```

## Auto-update

Uses `electron-updater` with GitHub Releases.

1. Replace `YOUR_GITHUB_USER` in `package.json` → `build.publish.owner`
2. Create a GitHub repo named `picstome-rater`
3. Generate a GitHub token with `repo` scope
4. To publish a new release:

```bash
# Bump version in package.json first, then:
GH_TOKEN=your_token npx electron-builder --mac --publish always
```

Users will see an update banner in the app. When the download is ready,
a "Restart & Update" button appears.

## Localization

Detects OS language automatically:
- **Spanish** (any `es-*` locale) → Spanish UI
- **Everything else** → English

## URL scheme
picstome://rate?files=1Z8A4331,1Z8A4373&rating=1

text

| Parameter | Description                   | Default |
|-----------|-------------------------------|---------|
| `files`   | Base names separated by comma | —       |
| `rating`  | Value 1–5                     | `1`     |

## Supported formats

JPG, JPEG, DNG, CR3, CR2, ARW, NEF, RAF, ORF, RW2

## Project structure
picstome-rater/
├── main.js # Main process: protocol, exiftool, auto-updater, i18n
├── preload.js # Secure bridge between main and renderer
├── index.html # UI
├── package.json # Electron + electron-builder + electron-updater
├── README.md
└── resources/
├── exiftool # macOS binary (add manually)
└── exiftool.exe # Windows binary (add manually)

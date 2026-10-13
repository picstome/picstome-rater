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

You can also pass it directly for testing:
```bash
npm start -- "picstome://rate?files=1Z8A4331&rating=1"
```

## Build

```bash
# macOS — outputs two DMGs: Intel (Picstome Rater-<version>.dmg)
# and Apple Silicon (Picstome Rater-<version>-arm64.dmg)
npm run dist:mac

# Windows — outputs dist/Picstome Rater Setup <version>.exe
npm run dist:win

# Both platforms at once
npm run dist:all
```

Note: without an Apple Developer ID the macOS build is **unsigned**, so users
may need to right-click the app → **Open** the first time (Gatekeeper).

## Releasing

Releases are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`) whenever you push a tag:

```bash
# 1. Bump "version" in package.json, e.g. 1.2.0
git commit -am "1.2 ..."

# 2. Tag it (tag name is free-form, e.g. "1.2" or "v1.2.0")
git tag -a 1.2 -m "1.2"

# 3. Push both — the workflow builds, signs nothing, and publishes
git push && git push origin 1.2
```

The workflow builds macOS (Intel + Apple Silicon) and Windows with
`--publish always`, which uploads the installers **and** the `latest.yml` /
`latest-mac.yml` update manifests to the GitHub release. Don't rename the
assets afterwards — auto-updates match files by the names in those manifests.

Users then update from inside the app ("Restart & Update"), or download the
files from the release page.


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

| Parameter | Description                   | Default |
|-----------|-------------------------------|---------|
| `files`   | Base names separated by comma | —       |
| `rating`  | Value 1–5                     | `1`     |

A link may contain up to 5000 file names. Ratings are only ever written to the
folder you selected in the app (a folder path can't be set from a link or by
anything running inside the UI).

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

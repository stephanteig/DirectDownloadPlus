# Struktur og funksjonsbaseline

## Kopiert innhold

```text
DirectDownloadPlus/
├── manifest.xml, package.json, main.js, index.html
├── css/estilo.css
├── js/{app.js, idiomas.js, motor.js, ponte.js}
├── bin/mac/{yt-dlp.pyz, yt-dlp, ffmpeg, ffprobe, deno, python/...}
├── WorkflowIntegration.node
└── icon.png, icon.icns, icon.ico
```

Kopien inneholder også øvrige filer under `bin/`. Binærfiler skal ikke erstattes eller oppdateres globalt som del av MVP-arbeidet.

## Ansvarsdeling

- `index.html` og `css/estilo.css`: eksisterende panel, layout, startskjerm, waveform, preview, trim, formatvalg, status og språkmarkører.
- `js/app.js`: DOM-hendelser, analyse, preview, waveform, trim, formatvalg, fremdrift, nedlastingsstatus og Media Pool/timeline-flyt.
- `js/motor.js`: yt-dlp/FFmpeg, `spawn`, avhengighetsvalg, JSON-analyse, direkte lydnedlasting, waveform og prosesslokale preview/video-cacher.
- `js/providers.js`: providerresolver, normaliserte metadata/capabilities, formatvalg og feilklassifisering.
- `js/metadata-cache.js`, `js/process-runner.js`, `js/retry-policy.js`: sikre støttegrenser for metadata-cache, prosesser og retry.
- `js/ponte.js`: Resolve-tilkobling, prosjekt, Media Pool, bin/mappe, import og timeline.
- `js/idiomas.js`: eksisterende språkpakker; nye meldinger skal legges til uten å fjerne nøkler.
- `main.js`: Electron-vindu, IPC-logg, mapper, versjonskontroll, ekstern åpning og drag-out.

## Eksisterende flyt

URL → `motor.consulta()` → metadata/tittel/kanal/thumbnail → direkte FFmpeg-rute når trygg URL finnes, ellers yt-dlp → lokal lyd/waveform → preview/trim → nedlasting → Media Pool → eventuell bin og timeline.

## Viktige baseline-funn

- `spawn` brukes med eksplisitte argumenter.
- `yt-escolhido.json` og `ficha-binarios.json` cachet binærvalg/fakta med filsignatur.
- `PREVIA_CACHE` og `VIDEO_CACHE` er prosesslokale URL-cacher.
- Analyse og nedlasting bruker `--no-playlist`; dette bevarer dagens enkeltlenke-flyt, men samlinger må senere detekteres kontrollert.
- UI-et avviser i dag analyse uten positiv toppnivå-varighet. Dette må utvides med duration-fallback uten å tolke manglende toppnivå-duration som livestream.
- `js/providers.js` er den nye provider-/normaliseringsgrensen; den endrer ikke UI-kontrakten alene.

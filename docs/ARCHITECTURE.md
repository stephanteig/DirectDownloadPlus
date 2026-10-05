# Arkitekturvurdering

Direct Download Plus bør være en inkrementell provider-løsning inne i eksisterende Electron/JavaScript-arkitektur. WebDL gir gode grenser for provider, prosesskjøring, normalisering og tilstand, men UI, Resolve-bro, waveform, trim og eksisterende cache skal fortsatt være Direct Downloads mekanikk.

```text
UI (app.js/index.html)
        │ normalized MediaSource + capabilities
ProviderResolver
   ├── DirectFileProvider
   ├── ManifestProvider (senere)
   └── YTDLPProvider (generell fallback)
        │
ProcessRunner / DependencyManager → yt-dlp, ffmpeg, ffprobe
        │
DownloadCoordinator / DownloadTaskState
        │
Existing motor.js download/trim/cache → ponte.js → Resolve
```

## Felles modell

```js
{
  provider, kind, title, author, duration, thumbnail, sourceUrl,
  items, formats,
  capabilities: {
    supportsVideo, supportsAudio, supportsTrim, supportsThumbnail,
    supportsMetadata, supportsCollections, supportsItemSelection
  }
}
```

Duration normaliseres med toppnivå `duration`, `requested_formats[].duration`, `formats[].duration`, `duration_s`, deretter `ffprobe` når en kilde kan åpnes. Ukjent varighet skal ikke automatisk bety livestream; trim deaktiveres først når alle fallback-muligheter er brukt.

Providerrekkefølge: direkte fil → entydig HLS/DASH (senere) → yt-dlp → konkret lokalisert feil.

Direkte lyd bruker eksisterende FFmpeg-rute; direkte video bruker en egen
FFmpeg-rute med eksplisitt URL, valgfritt tidsintervall og MP4-output. Begge
returnerer tilbake til samme eksisterende import- og timeline-steg.

Eksisterende cache skal ikke erstattes: binærvalg/fakta og prosesslokale preview/video-URL-er beholdes. Eventuelt nytt metadata-cache må ta hensyn til provider, normalisert URL og format. Signerte Instagram/CDN-URL-er må ha TTL og hentes på nytt etter utløp.

Logging skal utvides med provider, URL-type, verktøyversjoner, cache hit/miss, metadataresultat, format, komplett backend-feil og Resolve-importstatus uten cookies/tokens eller hele signerte URL-er.

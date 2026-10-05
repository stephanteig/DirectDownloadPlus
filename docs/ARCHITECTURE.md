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

`js/download-coordinator.js` er en UI-agnostisk serialiseringsgrense med én
aktiv jobb, eksplisitt tilstand, kansellering og begrenset retry. Den brukes
først som testet byggestein; eksisterende panel fortsetter å styre én synlig
nedlasting om gangen inntil full kø-UI kan innføres uten arbeidsflytendring.

`js/process-runner.js` er den nye sikre prosessgrensen for videre providerarbeid:
den bruker `spawn` med eksplisitte argumenter, samler stdout/stderr, støtter
timeout og kan avslutte en aktiv prosess. Den eksisterende motorens prosesskode
er fortsatt urørt der den allerede er koblet til Direct Download-flyt.

Direkte FFmpeg-ruter aksepterer også en valgfri prosess-callback (`aoNascer`).
Det gjør at en fremtidig coordinator kan holde en aktiv child-prosess og
kansellere den, mens eksisterende kall uten callback fortsetter uendret.

Eksisterende cache skal ikke erstattes: binærvalg/fakta og prosesslokale preview/video-URL-er beholdes. Eventuelt nytt metadata-cache må ta hensyn til provider, normalisert URL og format. Signerte Instagram/CDN-URL-er må ha TTL og hentes på nytt etter utløp.

`providers.cachePolicy()` gjør dette eksplisitt: metadata kan caches, mens
signerte URL-er fra blant annet Instagram/CDN kun er refreshbare transportdata
og skal hentes på nytt.

Samlinger/spillelister oppdages og normaliseres til `items[]`, men avvises med
en kontrollert `collection-detected`-feil i dagens enkeltlenke-arbeidsflyt.
Dette hindrer utilsiktet masse-nedlasting før et eget collection-UI er klart.

Logging skal utvides med provider, URL-type, verktøyversjoner, cache hit/miss, metadataresultat, format, komplett backend-feil og Resolve-importstatus uten cookies/tokens eller hele signerte URL-er.

Feildiagnostikk klassifiserer utløpte/signerte URL-er før generell blokkering. En HTTP 403 fra en signert CDN-URL kan derfor vises som utløpt medielenke, mens eksplisitt blokkering uten utløps- eller signaturindikator fortsatt vises som kildeblokkering.

`js/metadata-cache.js` er en separat, testet utvidelse for metadata-cachebehov.
Den bruker SHA-256 av provider + kilde-URL + format, validerer TTL ved lesing,
rydder utløpte oppføringer og skriver atomisk. Metadata kan lagres, men signerte
medie-URL-er fjernes før lagring. Den erstatter ikke Direct Downloads eksisterende
binær-, preview- eller vide-cache.

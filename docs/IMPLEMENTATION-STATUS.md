# Implementasjonsstatus

## Ferdig og verifisert uten Resolve-omstart

- Komplett separat kopi og manifest for `Direct Download Plus`.
- Normalisert providerresultat med `provider`, `kind`, metadata, `items`, `formats` og capabilities.
- Providerrekkefølge for direkte fil først og yt-dlp som generell fallback.
- Direkte MP4/MOV/M4V/WebM og MP3/M4A/WAV/FLAC, inkludert MIME-basert gjenkjenning.
- yt-dlp-fallback for YouTube, Instagram/Reels, TikTok, Vimeo og andre yt-dlp-kilder.
- Duration-fallback fra flere yt-dlp-felter og ffprobe mot format-URL.
- Samlingsdeteksjon uten utilsiktet playlist-nedlasting.
- Capabilities-basert trim/formatkontrakt uten nytt UI.
- Konkrete providerfeil og logging av provider/cache-resultat.
- Eksisterende Direct Download-cache bevart, med separat TTL-basert metadata-cache.
- Signerte CDN-URL-er fjernes før metadata-cache skrives.
- Testet prosessrunner, kø, retry, kansellering og direkte FFmpeg-callback.
- JavaScript-syntaks, npm-tester og separat installasjon kontrollert.

## Testbevis

`docs/TEST-PLAN.md` inneholder smoke-testresultater for YouTube, Instagram Reel,
TikTok, Vimeo, direkte video, direkte lyd og duration-fallback. Enhetstestene
dekker providerresolver, capabilities, cache hit/miss/utløp/korrupt data,
prosesser, retry og kansellering.

## Gjenstående ekstern verifikasjon

Full praktisk verifikasjon av panelet, Media Pool og timeline krever at DaVinci
Resolve startes på nytt etter installasjon av den separate manifesten. Dette er
ikke gjort automatisk for å unngå å lukke et aktivt prosjekt med mulige ulagrede
endringer. Originalpluginen er ikke endret.

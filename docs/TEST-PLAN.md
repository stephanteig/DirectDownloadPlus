# Testplan

## Baseline

- `node --check` for `main.js` og `js/*.js`.
- Åpne kopien i Resolve uten å endre originalen.
- Kontroller startskjerm, analyse, waveform, preview, trim, formatvalg, nedlasting, Media Pool, timeline og språk.

## Provider og metadata

- YouTube-video: metadata, cache hit/miss og eksisterende valg.
- Instagram Reel: `https://www.instagram.com/reels/Dcvt0UJCCRt/`.
- TikTok, Vimeo, direkte MP4 og MP3.
- Manglende duration med metadata-/ffprobe-fallback.
- Aktiv livestream, privat video, innlogging/blokkering og utløpt URL.
- FFmpeg-feil, yt-dlp-feil, ugyldig cache og kansellering.

## Resolve

- Media Pool-import med aktivt prosjekt.
- Manglende aktivt Resolve-prosjekt.
- Bin-/mappehåndtering, timeline-import og Resolve-importstatus i loggen.

Ingen fase godkjennes før eksisterende UI og YouTube-cacheoppførsel er regresjonstestet.

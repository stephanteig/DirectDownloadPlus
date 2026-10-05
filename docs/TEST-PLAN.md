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

## Verifisert i utviklingsmiljø

Instagram Reel-testlenken returnerte en videokilde og formater, men ingen
toppnivå-`duration`. Dette bekrefter behovet for format-URL → ffprobe-fallback;
proben fullførte med yt-dlp exit 0. Full Resolve-import og faktisk Media Pool-
verifikasjon krever at pluginen lastes av en aktiv DaVinci Resolve-instans.

En lokal HTTP-smoketest har også verifisert direkte video: en kort MP4 ble
lastet gjennom `baixaVideoDireto`, trimmet til et kortere klipp og kontrollert
med ffprobe.

Pluginen er installert separat i:

`/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.stephanteig.directdownloadplus`

DaVinci Resolve kjørte allerede under installasjonen. Siden Resolve normalt
leser Workflow Integration-manifester ved oppstart, er faktisk panelåpning og
Media Pool-import utsatt til neste Resolve-omstart; aktiv Resolve ble ikke
avsluttet automatisk for å unngå risiko for usikret brukerarbeid.

Ikke-nedlastende yt-dlp-smoketester er kjørt med:

- YouTube `dQw4w9WgXcQ`: bestått, 213 sekunder og 49 formater.
- TikTok `6718335390845095173`: bestått, 10 sekunder og 11 formater.
- Vimeo `76979871`: tydelig innloggingsfeil fra kilden; dette validerer at
  providerlaget må vise authentication-required i stedet for en generisk feil.

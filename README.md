# Direct Download Plus

Direct Download Plus is a separate DaVinci Resolve Workflow Integration Plugin based on Direct Download. It keeps the existing Direct Download interface and workflow while adding broader provider compatibility.

## Features

- Direct MP4, MOV, M4V, WebM, MP3, M4A, WAV and FLAC detection.
- MIME-based direct-file detection for generic CDN/download URLs.
- yt-dlp fallback for YouTube, Instagram/Reels, TikTok, Vimeo and other supported sites.
- Instagram duration fallback through yt-dlp format metadata and ffprobe.
- Provider-normalized metadata and capabilities-aware format selection.
- Safer metadata cache with TTL and signed CDN URL protection.
- Explicit process cancellation, queue state and provider-aware retry policy.
- Existing waveform, preview, trim, Media Pool, timeline and Resolve workflow retained.

## macOS installation

1. Download the latest `DirectDownloadPlus-*-mac.zip` from [Releases](https://github.com/stephanteig/DirectDownloadPlus/releases).
2. Unzip it.
3. Double-click `install-mac.command`, or run `./install-mac.sh` from Terminal.
4. Restart DaVinci Resolve.

The installer installs only `com.stephanteig.directdownloadplus`.

It never overwrites or deletes the original plugin:

`/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.jhaimesfilmes.directdownload`

Resolve must be restarted after installation because Workflow Integration manifests are read at startup. The installer does not require sudo or install global dependencies.

## Development

```bash
npm run verify
```

The repository contains the complete plugin source, bundled binaries, architecture notes and test plan. See `docs/IMPLEMENTATION-STATUS.md` for current verification limits.

## License

MIT. The repository includes bundled third-party binaries; consult their respective licenses before redistribution.

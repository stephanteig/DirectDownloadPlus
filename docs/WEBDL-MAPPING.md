# WebDL-mapping

WebDL ble undersøkt lokalt i `/Users/stephanteig/Documents/Dev/WebDL` (`stephanteig/WebDL`). Konseptene mappes slik:

| WebDL | Direct Download Plus |
|---|---|
| `MediaSource` / `MediaMetadata` | normalisert providerresultat |
| `MediaItem` | `items[]` for samlinger |
| `ProviderCapabilities` | capabilities på metadata |
| `DownloadRequest` | eksisterende format/kvalitet/trim-state |
| `DownloadTaskState` | eksisterende paneltilstander, senere samlet task-state |
| `DownloadCoordinator` | ny koordinering over `motor.js` |
| `DownloadProvider` | provider-moduler med felles kontrakt |
| `DirectFileProvider` | ny første provider |
| `YTDLPProvider` | innkapsling av dagens yt-dlp-rute |
| `DependencyManager` | videreføring av binærvalg/versjonsfakta |
| `ProcessRunner` | videreføring av `roda`/`rodaComTeto` |
| progress/cancel | felles callbacks og child-process-referanser |

WebDLs eksplisitte argumentlister, fortløpende stdout/stderr-lesing og prosesskansellering samsvarer allerede med viktige deler av `motor.js`. Vi skal trekke grensene ut uten å flytte Resolve- eller UI-ansvar inn i providerne.

Providerlaget har nå konkrete `DirectFileProvider`, `YTDLPProvider` og
`ProviderResolver`-klasser. De deler fortsatt de eksisterende normaliserings-
og motorfunksjonene for å holde migreringen kompatibel med Direct Downloads UI.

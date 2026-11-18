# Video Watch Time Tracker

This Chrome extension tracks the time you spend watching videos across different websites. It records both the duration of the video content watched and the actual time spent watching, accounting for playback speed and pauses.

<img width="459" alt="image" src="https://github.com/user-attachments/assets/43922431-aac1-44c0-a392-bf8a936049e5" />


## Features

- Tracks video watch time across all websites
- Distinguishes between video content duration and actual time spent watching
- Stores daily statistics (with hourly breakdown since Jan 2026)
- Provides a popup interface to view total and daily statistics
- JSON export/import of the full watch history
- Optional sync to a local dashboard app (see below) with charts, a calendar
  heatmap and time-saved analytics

## Installation

To install this Chrome extension:

1. Clone this repository or download it as a ZIP file and extract it:
```git@github.com:rifatc/video-watchtime-analytics-chrome-extension.git```
2. Open Google Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" by toggling the switch in the top right corner

4. Click on "Load unpacked" button that appears after enabling developer mode

5. Select the directory containing the extension files (the folder where you cloned or extracted the repository)

6. The extension should now appear in your list of installed extensions and in the Chrome toolbar

## Usage

After installation:

1. The extension will automatically start tracking video watch time on any web page you visit

2. Click on the extension icon in the Chrome toolbar to view your watch statistics

3. The popup will show:
- Total duration watched
- Total actual time watched
- Percentage of actual time watched compared to content duration
- A table with daily statistics

4. Data Management:
- Export your watch history to a JSON file by clicking the "Export JSON" button
- Import previously exported data by clicking the "Import JSON" button
- Dashboard sync status shows the last successful push; "Sync now" forces one

## Dashboard

The `watchtime-dashboard/` directory contains a small web app that mirrors your
watch history into SQLite and visualizes it: summary cards (watch duration,
actual time watched after savings, time saved with % and effective speed
factor), a daily chart, a GitHub-style activity heatmap, an hour-of-day chart
and a paginated history table.

It runs in Docker (via whatever docker context your machine uses — e.g. Kiri)
with zero dependencies installed on the host:

```bash
cd watchtime-dashboard
docker compose up -d --build   # serves http://127.0.0.1:8420 (localhost only)
```

The container uses `restart: unless-stopped`, so it starts with your machine
and stays down only if you stop it explicitly (`docker compose down`).

Once running, the extension pushes your history to it every 15 minutes and on
browser start (or use "Sync now" in the popup). If the app isn't running,
nothing is lost: the browser keeps everything and the next successful push
delivers the full backlog. The server merges per-day upserts — it never wipes.

Run the dashboard test suite (unit + integration) inside the container:

```bash
cd dashboard
docker run --rm -v "$PWD:/app" oven/bun:1-slim bun test
```

## Files

- `manifest.json`: Extension configuration file
- `content.js`: Content script that runs on web pages to track video watching
- `background.js`: Service worker for tab monitoring
- `sync.js`: Periodic history sync to the local dashboard
- `popup.html` / `popup.js`: Statistics popup
- `watchtime-dashboard/`: Local dashboard app (Bun + SQLite, Dockerized)

## Privacy

This extension only tracks video watch time and does not collect any personal information or video content. All data is stored locally in your browser using Chrome's storage API. The optional dashboard sync talks only to an app you host yourself on this machine (127.0.0.1 by default) — nothing ever leaves your computer.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.



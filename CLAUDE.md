# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension called "Video Analytics" that tracks video watch time across all websites. It distinguishes between video content duration and actual time spent watching (accounting for playback speed and pauses), stores daily statistics, and provides a popup interface to view and export data.

## Architecture

### Core Components

1. **manifest.json**: Chrome Extension Manifest v3 configuration
   - Defines permissions: activeTab, storage, tabs, alarms (+ host_permissions for http://127.0.0.1:8420, the dashboard sync endpoint)
   - Registers service worker (background.js) and content script (content.js)
   - Sets up popup.html as default action

2. **background.js**: Service worker that monitors tab activity
   - Loads sync.js via importScripts()
   - Listens for tab updates and activation events
   - Detects when tabs become audible to trigger video tracking
   - Periodically polls all tabs every 10 seconds for video detection

3. **content.js**: Content script injected into web pages
   - Tracks video element playback using timeupdate events
   - Distinguishes between video duration and actual time watched
   - Ignores large time skips (>4.5s) to prevent counting seeking
   - Uses MutationObserver to detect dynamically added video elements
   - Stores data in Chrome's local storage API

4. **popup.html/popup.js**: Extension popup interface
   - Displays total and daily statistics with pagination (7 days per page)
   - Provides JSON export/import functionality
   - Shows time saved percentages based on playback speed
   - Shows dashboard sync status with a manual "Sync now" button

5. **sync.js**: History sync to the local dashboard (loaded by background.js)
   - Every 15 minutes (chrome.alarms) and on startup, POSTs the FULL history
     to the dashboard's /api/sync endpoint
   - On failure nothing is cleared; the next successful push delivers the
     whole backlog (the server upserts per date, never deletes)
   - Records attempts in chrome.storage.local's "syncState" key

### Data Storage

The extension stores data in Chrome's local storage using this structure:
```javascript
{
  "videoWatchHistory": {
    "YYYY-MM-DD": {
      "durationWatched": 0,    // Video content duration watched
      "actualTimeWatched": 0   // Real time spent watching
    }
  }
}
```

## Development

### Installation
Since this is a Chrome extension, there's no traditional build process. To develop:

1. Load the extension in Chrome via `chrome://extensions/` → "Load unpacked"
2. Select the project directory
3. After making changes, click the "Reload" button in chrome://extensions/

### File Locations
- Extension icon assets: `/icons/` directory (16, 32, 48, 128px sizes)
- Main popup interface: `popup.html` and `popup.js`
- Core functionality: `content.js` and `background.js`

### Key Features
- Tracks video watch time across all websites automatically
- Distinguishes between content duration and actual time spent
- Stores data locally with no external dependencies
- Provides data export/import via JSON format
- Dark theme UI with neumorphic design
- Optional sync to a local, self-hosted dashboard (see below)

### Testing
Extension unit tests (no browser needed, zero npm dependencies):
```
node --test tests/
```
Manual smoke test:
1. Load it in Chrome developer mode
2. Visit any website with video content (YouTube, Vimeo, etc.)
3. The content script will automatically detect and track video playback
4. Click the extension icon to view statistics

## Dashboard (watchtime-dashboard/)

A Bun + SQLite web app that mirrors the browser history and renders analytics
(summary cards with time-saved stats, daily chart, calendar heatmap, hour-of-day
chart, history table). Zero npm dependencies; runs entirely in Docker.

```
cd watchtime-dashboard
docker compose up -d --build          # serve at http://127.0.0.1:8420 (restart: unless-stopped)
docker run --rm -v "$PWD:/app" oven/bun:1-slim bun test   # unit + integration tests
docker compose down                   # stop
```

Sync protocol: POST /api/sync with the same JSON envelope as the popup export
({exportDate, version: "2.0", data: {date: {durationWatched, actualTimeWatched, byHour?}}}).
The extension sends the full history each time, so a dashboard that was down
for any period catches up on the next successful push. SQLite data persists in
watchtime-dashboard/data/ (gitignored).

## Important Notes

- Extension uses Manifest v3 with service worker architecture
- Content script only activates when tabs become audible to optimize performance
- All data remains local: browser storage plus, if enabled, the user-hosted
  local dashboard on the same machine — no external servers
- Video detection works on any website with `<video>` elements
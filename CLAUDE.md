# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension called "Video Analytics" that tracks video watch time across all websites. It distinguishes between video content duration and actual time spent watching (accounting for playback speed and pauses), stores daily statistics, and provides a popup interface to view and export data.

## Architecture

### Core Components

1. **manifest.json**: Chrome Extension Manifest v3 configuration
   - Defines permissions: activeTab, storage, tabs
   - Registers service worker (background.js) and content script (content.js)
   - Sets up popup.html as default action

2. **background.js**: Service worker that monitors tab activity
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
   - Provides CSV export/import functionality
   - Shows time saved percentages based on playback speed

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
- Provides data export/import via CSV format
- Dark theme UI with neumorphic design

### Testing
To test the extension:
1. Load it in Chrome developer mode
2. Visit any website with video content (YouTube, Vimeo, etc.)
3. The content script will automatically detect and track video playback
4. Click the extension icon to view statistics

### CSV Format
Exported CSV contains:
- Date (YYYY-MM-DD)
- Duration Watched (seconds)
- Actual Time Watched (seconds)
- Time Saved (seconds)
- Time Saved Percentage

## Important Notes

- Extension uses Manifest v3 with service worker architecture
- Content script only activates when tabs become audible to optimize performance
- All data remains local to the user's browser - no external servers
- Video detection works on any website with `<video>` elements
# Video Watch Time Tracker

This Chrome extension tracks the time you spend watching videos across different websites. It records both the duration of the video content watched and the actual time spent watching, accounting for playback speed and pauses.
<img width="459" alt="image" src="https://github.com/user-attachments/assets/43922431-aac1-44c0-a392-bf8a936049e5" />


## Features

- Tracks video watch time across all websites
- Distinguishes between video content duration and actual time spent watching
- Stores daily statistics
- Provides a popup interface to view total and daily statistics

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
- Export your watch history to a CSV file by clicking the "Export to CSV" button
- Import previously exported data by clicking the "Import from CSV" button
- The CSV file contains daily statistics including dates, time watched, actual time watched, and time saved

## Files

- `manifest.json`: Extension configuration file
- `content.js`: Content script that runs on web pages to track video watching
- `popup.html`: HTML structure for the statistics popup
- `popup.js`: JavaScript code to populate the popup with data

## Privacy

This extension only tracks video watch time and does not collect any personal information or video content. All data is stored locally in your browser using Chrome's storage API.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.



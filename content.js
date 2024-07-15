// This script is designed to track and store the amount of time a user spends watching videos on a webpage. 
// It uses Chrome's local storage to keep a record of the total duration watched and the actual time spent watching videos for each day.

// Returns today's date in YYYY-MM-DD format.
function getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Initializes or updates the local storage with an entry for today if it doesn't exist.
function initializeStorage() {
    chrome.storage.local.get(['videoWatchHistory'], function (result) {
        let videoWatchHistory = result.videoWatchHistory || {};
        const today = getTodayDate();
        if (!videoWatchHistory[today]) {
            videoWatchHistory[today] = {
                durationWatched: 0,
                actualTimeWatched: 0
            };
            chrome.storage.local.set({videoWatchHistory: videoWatchHistory});
        }
    });
}

// Variables to keep track of video playback times and intervals.
let lastUpdateTime = 0;
let accumulatedTime = 0;
let lastStorageUpdateTime = 0;
let actualTimeWatched = 0;
let lastActualTimeUpdate = 0;

// Updates the local storage with the accumulated time watched and resets the counters.
function updateStorage() {
    chrome.storage.local.get(['videoWatchHistory'], function (result) {
        let videoWatchHistory = result.videoWatchHistory || {};
        const today = getTodayDate();

        if (!videoWatchHistory[today]) {
            videoWatchHistory[today] = {
                durationWatched: 0,
                actualTimeWatched: 0
            };
        }

        videoWatchHistory[today].durationWatched += accumulatedTime;
        videoWatchHistory[today].actualTimeWatched += actualTimeWatched;

        chrome.storage.local.set({videoWatchHistory: videoWatchHistory});
        accumulatedTime = 0;
        actualTimeWatched = 0;

        console.log('Watchtime history updated', videoWatchHistory[today]);
    });
}

// Handles the 'timeupdate' event for videos, updating the watched time.
function handleTimeUpdate(event) {
    const video = event.target;
    const currentTime = video.currentTime;
    const currentActualTime = Date.now() / 1000; // Convert to seconds

    if (lastUpdateTime > 0) {
        const timeDiff = currentTime - lastUpdateTime;

        // Only count time increments smaller than 4.5 seconds to ignore large skips.
        if (timeDiff > 0 && timeDiff < 4.5) {
            accumulatedTime += timeDiff;
        }

        // Update actual time watched if the video is playing.
        if (!video.paused) {
            const actualTimeDiff = currentActualTime - lastActualTimeUpdate;
            actualTimeWatched += actualTimeDiff;
        }
    }

    lastUpdateTime = currentTime;
    lastActualTimeUpdate = currentActualTime;

    // Periodically update the storage every 30 seconds.
    if (Date.now() - lastStorageUpdateTime >= 30000) {
        updateStorage();
        lastStorageUpdateTime = Date.now();
    }
}

// Attaches necessary event listeners to a video element.
function attachListenersToVideo(video) {
    if (!video.hasAttribute('data-tracked')) {
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('play', function () {
            lastActualTimeUpdate = Date.now() / 1000; // Update the last actual time on play.
        });
        video.addEventListener('pause', function () {
            const currentActualTime = Date.now() / 1000;
            actualTimeWatched += currentActualTime - lastActualTimeUpdate; // Update watched time on pause.
        });
        video.setAttribute('data-tracked', 'true');
    }
}

// Initializes video tracking by setting up storage and attaching event listeners to all video elements.
function initializeTracking() {
    initializeStorage();

    // Attach listeners to any existing video elements.
    const videos = document.getElementsByTagName('video');
    for (let video of videos) {
        attachListenersToVideo(video);
    }

    // Monitor the document for newly added video elements and attach listeners to them.
    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeName === 'VIDEO') {
                        attachListenersToVideo(node);
                    }
                });
            }
        });
    });

    observer.observe(document.body, {childList: true, subtree: true});

    // Add event listener to save data before tab is closed
    window.addEventListener('beforeunload', function() {
        updateStorage();
    });
}

// Checks for video elements on the page and initializes tracking if found. If not, retries after a delay.
function checkForVideos() {
    const videos = document.getElementsByTagName('video');
    if (videos.length > 0) {
        initializeTracking();
    } else {
        setTimeout(checkForVideos, 10000); // Retry after 10 second if no videos are found.
    }
}

function startTracking() {
    checkForVideos();
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkForVideo') {
        startTracking();
    }
});

// We don't automatically start tracking anymore.
// Instead, we wait for a signal from the background script.
console.log('Content script loaded, waiting for background script signal');

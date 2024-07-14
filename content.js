// This script is designed to track and store the amount of time a user spends watching videos on a webpage. 
// It uses Chrome's local storage to keep a record of the total duration watched and the actual time spent watching videos for each day.

// Returns today's date in YYYY-MM-DD format.
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
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

        console.log('Storage updated', videoWatchHistory);
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

    // Periodically update the storage every 5 seconds.
    if (Date.now() - lastStorageUpdateTime >= 5000) {
        updateStorage();
        lastStorageUpdateTime = Date.now();
    }
}

// Attaches necessary event listeners to a video element.
function attachListenersToVideo(video) {
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', function () {
        lastActualTimeUpdate = Date.now() / 1000; // Update the last actual time on play.
    });
    video.addEventListener('pause', function () {
        const currentActualTime = Date.now() / 1000;
        actualTimeWatched += currentActualTime - lastActualTimeUpdate; // Update watched time on pause.
    });
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
                        console.log('New video element found', node);
                        attachListenersToVideo(node);
                    }
                });
            }
        });
    });

    observer.observe(document.body, {childList: true, subtree: true});
}

// Checks for video elements on the page and initializes tracking if found. If not, retries after a delay.
function checkForVideos() {
    if (document.getElementsByTagName('video').length > 0) {
        initializeTracking();
    } else {
        setTimeout(checkForVideos, 1000); // Retry after 1 second if no videos are found initially.
    }
}

// Start the video tracking process once the page has loaded or immediately if the page is already loaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForVideos);
} else {
    checkForVideos();
}

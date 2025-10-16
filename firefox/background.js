function checkTabForVideo(tabId) {
    browser.tabs.get(tabId, (tab) => {
        if (tab.audible) {
            browser.tabs.sendMessage(tabId, { action: 'checkForVideo' });
        }
    });
}

// Check when a tab is updated
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) {
        checkTabForVideo(tabId);
    }
});

// Check when a tab is activated (user switches to the tab)
browser.tabs.onActivated.addListener(({ tabId }) => {
    checkTabForVideo(tabId);
});

// Periodically check all tabs (in case we missed any events)
setInterval(() => {
    browser.tabs.query({}, (tabs) => {
        tabs.forEach(tab => checkTabForVideo(tab.id));
    });
}, 10000);  // Check every 10 seconds

// Message handlers for import functionality
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getVideoHistory') {
        browser.storage.local.get(['videoWatchHistory'], function(result) {
            sendResponse({ videoWatchHistory: result.videoWatchHistory || {} });
        });
        return true; // Keep the message channel open for async response
    }
    
    if (request.action === 'setVideoHistory') {
        browser.storage.local.set({ videoWatchHistory: request.data }, function() {
            if (browser.runtime.lastError) {
                sendResponse({ success: false, error: browser.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true; // Keep the message channel open for async response
    }
});
async function checkTabForVideo(tabId) {
    try {
        const tab = await browser.tabs.get(tabId);
        if (tab.audible) {
            browser.tabs.sendMessage(tabId, { action: 'checkForVideo' });
        }
    } catch (error) {
        console.log('Error checking tab:', error);
    }
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
    browser.tabs.query({}).then(tabs => {
        tabs.forEach(tab => checkTabForVideo(tab.id));
    }).catch(error => {
        console.log('Error querying tabs:', error);
    });
}, 10000);  // Check every 10 seconds

// Message handlers for import functionality
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getVideoHistory') {
        browser.storage.local.get(['videoWatchHistory']).then(result => {
            sendResponse({ videoWatchHistory: result.videoWatchHistory || {} });
        }).catch(error => {
            sendResponse({ videoWatchHistory: {}, error: error.message });
        });
        return true; // Keep the message channel open for async response
    }
    
    if (request.action === 'setVideoHistory') {
        browser.storage.local.set({ videoWatchHistory: request.data }).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep the message channel open for async response
    }
});
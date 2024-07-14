function checkTabForVideo(tabId) {
    chrome.tabs.get(tabId, (tab) => {
        if (tab.audible) {
            chrome.tabs.sendMessage(tabId, { action: 'checkForVideo' });
        }
    });
}

// Check when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) {
        checkTabForVideo(tabId);
    }
});

// Check when a tab is activated (user switches to the tab)
chrome.tabs.onActivated.addListener(({ tabId }) => {
    checkTabForVideo(tabId);
});

// Periodically check all tabs (in case we missed any events)
setInterval(() => {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => checkTabForVideo(tab.id));
    });
}, 5000);  // Check every 5 seconds

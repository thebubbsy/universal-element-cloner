/**
 * Universal Element Cloner: background.js
 * Handles Side Panel orchestration and global state persistence.
 */

console.log('Universal Element Cloner: Background Service Worker Loaded');

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        scraping: false,
        captureCount: 0,
        scrollSpeed: 500
    });
});

// Sync data between sidepanel and background if needed
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'UPDATE_STATE') {
        chrome.storage.local.set(msg.state);
    }
});

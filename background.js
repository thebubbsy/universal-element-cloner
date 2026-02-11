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
        sendResponse({ success: true }); // Always respond
    } else if (msg.action === 'FETCH_IMAGE_BASE64') {
        fetch(msg.url)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.blob();
            })
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    try {
                        sendResponse({ success: true, data: reader.result });
                    } catch (e) {
                        console.error('Failed to send response (channel closed?):', e);
                    }
                };
                reader.onerror = () => {
                    try {
                        sendResponse({ success: false, error: 'Reader error' });
                    } catch (e) { console.error('Failed to send response:', e); }
                };
                reader.readAsDataURL(blob);
            })
            .catch(error => {
                console.error('Fetch error in background:', error);
                try {
                    sendResponse({ success: false, error: error.message });
                } catch (e) { console.error('Failed to send response:', e); }
            });
        return true; // Keep channel open for async response
    } else {
        // Unknown message
        sendResponse({ success: false, error: 'Unknown action' });
    }
    // Return true only if we are handling asynchronously (already returned true above for FETCH_IMAGE_BASE64)
    // But since we have if/else branches and we want to be safe, returning true at end is often safest if any path is async
    // However, for synchronous paths we should have called sendResponse already.
});

/**
 * Universal Element Cloner: popup.js
 * Implementation by Matthew Bubb's trusty screwdriver.
 */

console.log('Universal Element Cloner: Popup Script Loaded');

document.addEventListener('DOMContentLoaded', () => {
    // Theme toggle functionality
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;
    
    // Load saved theme preference
    chrome.storage.local.get(['theme'], (data) => {
        if (data.theme === 'light') {
            body.classList.add('light-mode');
        }
    });
    
    // Toggle theme on button click
    if (themeToggle) {
        themeToggle.onclick = () => {
            body.classList.toggle('light-mode');
            const isLight = body.classList.contains('light-mode');
            chrome.storage.local.set({ theme: isLight ? 'light' : 'dark' });
        };
    }
    
    // Rest of the code
    const btnPick = document.getElementById('btn-element-capture');
    const btnExportElement = document.getElementById('btn-export-element');
    const cardSelection = document.getElementById('card-selection');
    const cardPickingControls = document.getElementById('card-picking-controls');
    const btnFinishSelection = document.getElementById('btn-finish-selection');
    const btnCancelSelection = document.getElementById('btn-cancel-selection');
    const btnFullPage = document.getElementById('btn-full-page');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnOpenEditor = document.getElementById('btn-open-editor');
    const cardGuidedCapture = document.getElementById('card-guided-capture');
    const btnCancelGuided = document.getElementById('btn-cancel-guided');
    const progressBar = document.getElementById('capture-progress');
    const scrollerList = document.getElementById('detected-scrollers');
    const statusText = document.getElementById('status-text');
    const indicator = document.getElementById('status-indicator');

    // View switching elements
    const mainView = document.getElementById('main-view');
    const filterView = document.getElementById('filter-view');
    
    // Filter mode elements
    const btnDeleteMode = document.getElementById('btn-delete-mode');
    const btnMoveMode = document.getElementById('btn-move-mode');
    const btnResizeMode = document.getElementById('btn-resize-mode');
    const btnAddElement = document.getElementById('btn-add-element');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnSaveFinal = document.getElementById('btn-save-final');
    const btnExitFilter = document.getElementById('btn-exit-filter');

    let currentEditMode = 'none';

    // Message passing to content script with injection fallback
    const sendMessage = async (action, data = {}) => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
                console.warn('No active tab found');
                if (statusText) statusText.innerText = 'Error: No active tab';
                return;
            }
            
            // Try to send message
            try {
                return await chrome.tabs.sendMessage(tab.id, { action, ...data });
            } catch (connectionError) {
                // Content script not loaded yet - inject it
                console.log('Content script not loaded, attempting injection...');
                
                try {
                    await chrome.scripting.insertCSS({
                        target: { tabId: tab.id },
                        files: ['content.css']
                    });
                    
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                    
                    // Wait a moment for script to initialize
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Retry sending message
                    return await chrome.tabs.sendMessage(tab.id, { action, ...data });
                } catch (injectError) {
                    console.error('Failed to inject content script:', injectError);
                    if (statusText) statusText.innerText = 'Error: Cannot access page. Try reloading.';
                }
            }
        } catch (error) {
            console.error('Connection error:', action, error.message);
            if (statusText) statusText.innerText = `Error: ${error.message}`;
        }
    };

    const showView = (view) => {
        const views = [mainView, filterView];
        views.forEach(v => {
            if (v === view) v.classList.remove('hidden');
            else v.classList.add('hidden');
        });
    };

    const updateFilterButtons = (state) => {
        if (!state) return;
        
        btnDeleteMode.classList.toggle('btn-active', state.mode === 'delete');
        btnMoveMode.classList.toggle('btn-active', state.mode === 'move');
        btnResizeMode.classList.toggle('btn-active', state.mode === 'resize');
        
        btnUndo.disabled = !state.canUndo;
        btnRedo.disabled = !state.canRedo;
    };

    // Main View Handlers
    if (btnPick) {
        btnPick.onclick = async () => {
            statusText.innerText = 'Picking...';
            indicator.classList.add('active');
            cardSelection.classList.add('hidden');
            cardPickingControls.classList.remove('hidden');
            await sendMessage('START_MULTI_CAPTURE');
        };
    }

    if (btnExportElement) {
        btnExportElement.onclick = async () => {
            statusText.innerText = 'Export Selection Mode...';
            indicator.classList.add('active');
            cardSelection.classList.add('hidden');
            cardPickingControls.classList.remove('hidden');
            await sendMessage('EXPORT_ELEMENTS_START');
        };
    }

    if (btnFinishSelection) {
        btnFinishSelection.onclick = async () => {
            cardPickingControls.classList.add('hidden');
            cardSelection.classList.remove('hidden');
            statusText.innerText = 'Elements Selected';
            await sendMessage('FINISH_PICKING');
        };
    }

    if (btnCancelSelection) {
        btnCancelSelection.onclick = async () => {
            cardPickingControls.classList.add('hidden');
            cardSelection.classList.remove('hidden');
            statusText.innerText = 'Ready';
            indicator.classList.remove('active');
            await sendMessage('CANCEL_CAPTURE');
        };
    }

    if (btnFullPage) {
        btnFullPage.onclick = async () => {
            statusText.innerText = 'Initializing Guided Capture...';
            indicator.classList.add('active');
            cardSelection.classList.add('hidden');
            cardGuidedCapture.classList.remove('hidden');
            await sendMessage('FULL_PAGE_FILTER');
        };
    }

    if (btnCancelGuided) {
        btnCancelGuided.onclick = async () => {
            cardGuidedCapture.classList.add('hidden');
            cardSelection.classList.remove('hidden');
            statusText.innerText = 'Ready';
            indicator.classList.remove('active');
            await sendMessage('CANCEL_GUIDED');
        };
    }

    if (btnStart) {
        btnStart.onclick = async () => {
            const speed = document.getElementById('scroll-speed').value;
            const direction = document.getElementById('scroll-direction').value;
            statusText.innerText = 'Scraping...';
            indicator.classList.add('active');
            btnStart.disabled = true;
            btnStop.disabled = false;
            await sendMessage('START_SCRAPE', { speed: parseInt(speed), direction });
        };
    }

    if (btnStop) {
        btnStop.onclick = async () => {
            statusText.innerText = 'Stopping...';
            indicator.classList.remove('active');
            btnStart.disabled = false;
            btnStop.disabled = true;
            await sendMessage('STOP_SCRAPE');
        };
    }

    // Filter View Handlers
    if (btnDeleteMode) btnDeleteMode.onclick = () => sendMessage('TOGGLE_EDIT_MODE', { mode: 'delete' });
    if (btnMoveMode) btnMoveMode.onclick = () => sendMessage('TOGGLE_EDIT_MODE', { mode: 'move' });
    if (btnResizeMode) btnResizeMode.onclick = () => sendMessage('TOGGLE_EDIT_MODE', { mode: 'resize' });
    if (btnAddElement) btnAddElement.onclick = () => sendMessage('PICK_ADDITIONAL_ELEMENT');
    if (btnUndo) btnUndo.onclick = () => sendMessage('UNDO_ACTION');
    if (btnRedo) btnRedo.onclick = () => sendMessage('REDO_ACTION');
    if (btnSaveFinal) btnSaveFinal.onclick = () => sendMessage('SAVE_FINAL');
    if (btnExitFilter) btnExitFilter.onclick = () => {
        showView(mainView);
        chrome.storage.local.set({ isFiltering: false });
        sendMessage('EXIT_FILTER_MODE');
    };

    // Load persisted state
    chrome.storage.local.get(['scraping', 'scrollSpeed', 'captureCount', 'isFiltering'], (data) => {
        if (data.isFiltering) showView(filterView);
        else showView(mainView);

        if (data.scraping) {
            statusText.innerText = 'Scraping...';
            indicator.classList.add('active');
            if (btnStart) btnStart.disabled = true;
            if (btnStop) btnStop.disabled = false;
        }
        
        const scrollSpeedSelect = document.getElementById('scroll-speed');
        if (scrollSpeedSelect) {
            scrollSpeedSelect.value = (data.scrollSpeed && data.scrollSpeed != 5) ? data.scrollSpeed : "500";
        }

        const captureCountEl = document.getElementById('capture-count');
        if (captureCountEl && data.captureCount !== undefined) {
            captureCountEl.innerText = `Captured: ${data.captureCount}`;
        }
    });

    // Listen for status updates from content script
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'STATUS_UPDATE') {
            statusText.innerText = msg.text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            if (msg.active) indicator.classList.add('active');
            else indicator.classList.remove('active');
            chrome.storage.local.set({ scraping: msg.active });
        } else if (msg.action === 'COUNT_UPDATE') {
            document.getElementById('capture-count').innerText = `Captured: ${msg.count}`;
            chrome.storage.local.set({ captureCount: msg.count });
        } else if (msg.action === 'GUIDED_PROGRESS') {
            if (progressBar) progressBar.style.width = `${msg.progress}%`;
            if (scrollerList && msg.scrollers) {
                scrollerList.innerHTML = msg.scrollers.map(s => `
                    <div class="scroller-item">
                        <span>${s.name}</span>
                        <span class="scroller-status">${s.progress}%</span>
                    </div>
                `).join('');
            }
            statusText.innerText = `Preparing: ${msg.progress}%`;
        } else if (msg.action === 'OPEN_SIDE_EDITOR_REPLY') {
            showView(filterView);
            chrome.storage.local.set({ isFiltering: true });
        } else if (msg.action === 'UPDATE_FILTER_STATE') {
            updateFilterButtons(msg.state);
        }
    });

    if (btnOpenEditor) {
        btnOpenEditor.onclick = async () => {
            statusText.innerText = 'Freezing Workspace...';
            indicator.classList.add('active');
            await sendMessage('OPEN_SIDE_EDITOR');
        };
    }
});

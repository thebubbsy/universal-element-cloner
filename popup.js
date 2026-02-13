/**
 * Universal Element Cloner: popup.js
 * Implementation by Matthew Bubb's trusty screwdriver.
 */

console.log('Universal Element Cloner: Popup Script Loaded');

// UI Elements cache
const ui = {
    // Top-level elements
    themeToggle: null,
    body: null,
    mainView: null,
    filterView: null,
    statusText: null,
    indicator: null,

    // Main View
    btnPick: null,
    btnExportElement: null,
    cardSelection: null,
    cardPickingControls: null,
    btnFinishSelection: null,
    btnCancelSelection: null,
    btnFullPage: null,
    cardGuidedCapture: null,
    btnCancelGuided: null,
    progressBar: null,
    scrollerList: null,
    scrollSpeed: null,
    scrollDirection: null,
    btnStart: null,
    btnStop: null,
    btnOpenEditor: null,
    captureCount: null,

    // Filter View
    btnDeleteMode: null,
    btnMoveMode: null,
    btnResizeMode: null,
    btnAddElement: null,
    btnUndo: null,
    btnRedo: null,
    btnSaveFinal: null,
    btnExitFilter: null
};

// Message passing to content script with injection fallback
const sendMessage = async (action, data = {}) => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            console.warn('No active tab found');
            if (ui.statusText) ui.statusText.innerText = 'Error: No active tab';
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
                if (ui.statusText) ui.statusText.innerText = 'Error: Cannot access page. Try reloading.';
            }
        }
    } catch (error) {
        console.error('Connection error:', action, error.message);
        if (ui.statusText) ui.statusText.innerText = `Error: ${error.message}`;
    }
};

const showView = (view) => {
    const views = [ui.mainView, ui.filterView];
    views.forEach(v => {
        if (v === view) v.classList.remove('hidden');
        else v.classList.add('hidden');
    });
};

const updateFilterButtons = (state) => {
    if (!state) return;

    if (ui.btnDeleteMode) ui.btnDeleteMode.classList.toggle('btn-active', state.mode === 'delete');
    if (ui.btnMoveMode) ui.btnMoveMode.classList.toggle('btn-active', state.mode === 'move');
    if (ui.btnResizeMode) ui.btnResizeMode.classList.toggle('btn-active', state.mode === 'resize');

    if (ui.btnUndo) ui.btnUndo.disabled = !state.canUndo;
    if (ui.btnRedo) ui.btnRedo.disabled = !state.canRedo;
};

const initUI = () => {
    // Top-level elements
    ui.themeToggle = document.getElementById('theme-toggle');
    ui.body = document.body;
    ui.mainView = document.getElementById('main-view');
    ui.filterView = document.getElementById('filter-view');
    ui.statusText = document.getElementById('status-text');
    ui.indicator = document.getElementById('status-indicator');

    // Main View
    ui.btnPick = document.getElementById('btn-element-capture');
    ui.btnExportElement = document.getElementById('btn-export-element');
    ui.cardSelection = document.getElementById('card-selection');
    ui.cardPickingControls = document.getElementById('card-picking-controls');
    ui.btnFinishSelection = document.getElementById('btn-finish-selection');
    ui.btnCancelSelection = document.getElementById('btn-cancel-selection');
    ui.btnFullPage = document.getElementById('btn-full-page');
    ui.cardGuidedCapture = document.getElementById('card-guided-capture');
    ui.btnCancelGuided = document.getElementById('btn-cancel-guided');
    ui.progressBar = document.getElementById('capture-progress');
    ui.scrollerList = document.getElementById('detected-scrollers');
    ui.scrollSpeed = document.getElementById('scroll-speed');
    ui.scrollDirection = document.getElementById('scroll-direction');
    ui.btnStart = document.getElementById('btn-start');
    ui.btnStop = document.getElementById('btn-stop');
    ui.btnOpenEditor = document.getElementById('btn-open-editor');
    ui.captureCount = document.getElementById('capture-count');

    // Filter View
    ui.btnDeleteMode = document.getElementById('btn-delete-mode');
    ui.btnMoveMode = document.getElementById('btn-move-mode');
    ui.btnResizeMode = document.getElementById('btn-resize-mode');
    ui.btnAddElement = document.getElementById('btn-add-element');
    ui.btnUndo = document.getElementById('btn-undo');
    ui.btnRedo = document.getElementById('btn-redo');
    ui.btnSaveFinal = document.getElementById('btn-save-final');
    ui.btnExitFilter = document.getElementById('btn-exit-filter');
};

const initTheme = () => {
    // Load saved theme preference
    chrome.storage.local.get(['theme'], (data) => {
        if (data.theme === 'light') {
            ui.body.classList.add('light-mode');
        }
    });

    // Toggle theme on button click
    if (ui.themeToggle) {
        ui.themeToggle.onclick = () => {
            ui.body.classList.toggle('light-mode');
            const isLight = ui.body.classList.contains('light-mode');
            chrome.storage.local.set({ theme: isLight ? 'light' : 'dark' });
        };
    }
};

const initButtons = () => {
    // Main View Handlers
    if (ui.btnPick) {
        ui.btnPick.onclick = async () => {
            ui.statusText.innerText = 'Picking...';
            ui.indicator.classList.add('active');
            ui.cardSelection.classList.add('hidden');
            ui.cardPickingControls.classList.remove('hidden');
            await sendMessage('START_MULTI_CAPTURE');
        };
    }

    if (ui.btnExportElement) {
        ui.btnExportElement.onclick = async () => {
            ui.statusText.innerText = 'Export Selection Mode...';
            ui.indicator.classList.add('active');
            ui.cardSelection.classList.add('hidden');
            ui.cardPickingControls.classList.remove('hidden');
            await sendMessage('EXPORT_ELEMENTS_START');
        };
    }

    if (ui.btnFinishSelection) {
        ui.btnFinishSelection.onclick = async () => {
            ui.cardPickingControls.classList.add('hidden');
            ui.cardSelection.classList.remove('hidden');
            ui.statusText.innerText = 'Elements Selected';
            await sendMessage('FINISH_PICKING');
        };
    }

    if (ui.btnCancelSelection) {
        ui.btnCancelSelection.onclick = async () => {
            ui.cardPickingControls.classList.add('hidden');
            ui.cardSelection.classList.remove('hidden');
            ui.statusText.innerText = 'Ready';
            ui.indicator.classList.remove('active');
            await sendMessage('CANCEL_CAPTURE');
        };
    }

    if (ui.btnFullPage) {
        ui.btnFullPage.onclick = async () => {
            ui.statusText.innerText = 'Initializing Guided Capture...';
            ui.indicator.classList.add('active');
            ui.cardSelection.classList.add('hidden');
            ui.cardGuidedCapture.classList.remove('hidden');
            await sendMessage('FULL_PAGE_FILTER');
        };
    }

    if (ui.btnCancelGuided) {
        ui.btnCancelGuided.onclick = async () => {
            ui.cardGuidedCapture.classList.add('hidden');
            ui.cardSelection.classList.remove('hidden');
            ui.statusText.innerText = 'Ready';
            ui.indicator.classList.remove('active');
            await sendMessage('CANCEL_GUIDED');
        };
    }

    if (ui.btnStart) {
        ui.btnStart.onclick = async () => {
            const speed = ui.scrollSpeed.value;
            const direction = ui.scrollDirection.value;
            ui.statusText.innerText = 'Scraping...';
            ui.indicator.classList.add('active');
            ui.btnStart.disabled = true;
            ui.btnStop.disabled = false;
            await sendMessage('START_SCRAPE', { speed: parseInt(speed), direction });
        };
    }

    if (ui.btnStop) {
        ui.btnStop.onclick = async () => {
            ui.statusText.innerText = 'Stopping...';
            ui.indicator.classList.remove('active');
            ui.btnStart.disabled = false;
            ui.btnStop.disabled = true;
            await sendMessage('STOP_SCRAPE');
        };
    }

    // Filter View Handlers
    if (ui.btnDeleteMode) ui.btnDeleteMode.onclick = () => sendMessage('TOGGLE_EDIT_MODE', { mode: 'delete' });
    if (ui.btnMoveMode) ui.btnMoveMode.onclick = () => sendMessage('TOGGLE_EDIT_MODE', { mode: 'move' });
    if (ui.btnResizeMode) ui.btnResizeMode.onclick = () => sendMessage('TOGGLE_EDIT_MODE', { mode: 'resize' });
    if (ui.btnAddElement) ui.btnAddElement.onclick = () => sendMessage('PICK_ADDITIONAL_ELEMENT');
    if (ui.btnUndo) ui.btnUndo.onclick = () => sendMessage('UNDO_ACTION');
    if (ui.btnRedo) ui.btnRedo.onclick = () => sendMessage('REDO_ACTION');
    if (ui.btnSaveFinal) ui.btnSaveFinal.onclick = () => sendMessage('SAVE_FINAL');
    if (ui.btnExitFilter) ui.btnExitFilter.onclick = () => {
        showView(ui.mainView);
        chrome.storage.local.set({ isFiltering: false });
        sendMessage('EXIT_FILTER_MODE');
    };

    if (ui.btnOpenEditor) {
        ui.btnOpenEditor.onclick = async () => {
            ui.statusText.innerText = 'Freezing Workspace...';
            ui.indicator.classList.add('active');
            await sendMessage('OPEN_SIDE_EDITOR');
        };
    }
};

const initMessageListeners = () => {
    // Listen for status updates from content script
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'STATUS_UPDATE') {
            ui.statusText.innerText = msg.text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            if (msg.active) ui.indicator.classList.add('active');
            else ui.indicator.classList.remove('active');
            chrome.storage.local.set({ scraping: msg.active });
        } else if (msg.action === 'COUNT_UPDATE') {
            ui.captureCount.innerText = `Captured: ${msg.count}`;
            chrome.storage.local.set({ captureCount: msg.count });
        } else if (msg.action === 'GUIDED_PROGRESS') {
            if (ui.progressBar) ui.progressBar.style.width = `${msg.progress}%`;
            if (ui.scrollerList && msg.scrollers) {
                ui.scrollerList.innerHTML = "";
                msg.scrollers.forEach(s => {
                    const item = document.createElement("div");
                    item.className = "scroller-item";

                    const nameSpan = document.createElement("span");
                    nameSpan.textContent = s.name;

                    const statusSpan = document.createElement("span");
                    statusSpan.className = "scroller-status";
                    statusSpan.textContent = `${s.progress}%`;

                    item.appendChild(nameSpan);
                    item.appendChild(statusSpan);
                    ui.scrollerList.appendChild(item);
                });
            }
            ui.statusText.innerText = `Preparing: ${msg.progress}%`;
        } else if (msg.action === 'OPEN_SIDE_EDITOR_REPLY') {
            showView(ui.filterView);
            chrome.storage.local.set({ isFiltering: true });
        } else if (msg.action === 'UPDATE_FILTER_STATE') {
            updateFilterButtons(msg.state);
        }
    });
};

const restoreState = () => {
    // Load persisted state
    chrome.storage.local.get(['scraping', 'scrollSpeed', 'captureCount', 'isFiltering'], (data) => {
        if (data.isFiltering) showView(ui.filterView);
        else showView(ui.mainView);

        if (data.scraping) {
            ui.statusText.innerText = 'Scraping...';
            ui.indicator.classList.add('active');
            if (ui.btnStart) ui.btnStart.disabled = true;
            if (ui.btnStop) ui.btnStop.disabled = false;
        }

        if (ui.scrollSpeed) {
            ui.scrollSpeed.value = (data.scrollSpeed && data.scrollSpeed != 5) ? data.scrollSpeed : "500";
        }

        if (ui.captureCount && data.captureCount !== undefined) {
            ui.captureCount.innerText = `Captured: ${data.captureCount}`;
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initTheme();
    initButtons();
    initMessageListeners();
    restoreState();
});

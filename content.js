class UniversalScraper {
    constructor() {
        this.assetCache = new Map();

        this.picker = new ElementPicker();
        this.scraper = new DomScraper(this.assetCache);
        this.exporter = new ContentExporter();

        this.editor = new EditorUI({
            onSave: this.handleSave.bind(this),
            onPickMore: this.handlePickMore.bind(this),
            onExit: this.handleEditorExit.bind(this)
        });

        this.initUniversalHandlers();
    }

    initUniversalHandlers() {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            let isAsync = false;
            switch (msg.action) {
                case 'START_SCRAPE':
                    // Need target element. If picker has target, use it.
                    const target = this.picker.targetElement;
                    this.scraper.start(target, msg.speed, msg.direction);
                    break;
                case 'STOP_SCRAPE':
                    this.scraper.stop();
                    break;
                case 'START_MULTI_CAPTURE':
                    this.picker.enable('multi');
                    break;
                case 'FINISH_PICKING':
                    this.picker.disable(false); // Don't clean queue
                    break;
                case 'CANCEL_CAPTURE':
                    this.picker.disable(true);
                    break;
                case 'FULL_PAGE_FILTER':
                    this.exporter.prepareFullPageCapture();
                    break;
                case 'CANCEL_GUIDED':
                    this.exporter.cancelGuidedCapture();
                    break;
                case 'OPEN_SIDE_EDITOR':
                    this.openSideEditor();
                    break;
                case 'TOGGLE_EDIT_MODE':
                     // Editor logic
                    break;
                case 'UNDO_ACTION':
                     // Editor logic
                    break;
                case 'REDO_ACTION':
                     // Editor logic
                    break;
                case 'SAVE_FINAL':
                    this.handleSave(msg.onlySelection);
                    break;
                case 'EXIT_FILTER_MODE':
                    this.editor.exitFilterMode();
                    break;
                case 'EXPORT_ELEMENTS_START':
                    this.picker.enable('multi');
                    ScraperUtils.updateStatus('Click elements to export (Shift+Scroll to cycle depth)', true);
                    break;
                 case 'PICK_ADDITIONAL_ELEMENT':
                    this.handlePickMore();
                    break;
            }
            if (!isAsync) {
                sendResponse({ success: true });
                return false;
            }
            return true;
        });
    }

    openSideEditor() {
        const fragments = [];

        // Process picker queue
        if (this.picker.multiCaptureQueue.length > 0) {
            this.picker.multiCaptureQueue.forEach(el => {
                fragments.push(ScraperUtils.freezeElement(el, this.assetCache));
            });
        }

        // Process scraper captured items
        if (this.scraper.capturedItems.length > 0) {
            this.scraper.capturedItems.forEach(item => {
                const temp = document.createElement('div');
                temp.innerHTML = item.html;
                fragments.push(temp.firstElementChild);
            });
        }

        // Full page mode fallback
        if (fragments.length === 0 && this.exporter.isGuidedMode) {
             fragments.push(ScraperUtils.freezeElement(document.body, this.assetCache));
        }

        if (fragments.length === 0) return ScraperUtils.updateStatus("Nothing to edit. Pick elements first.", false);

        this.picker.disable(true);
        this.exporter.cancelGuidedCapture();

        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '20px';
        container.style.padding = '40px';
        container.classList.add('mb-multi-container');

        fragments.forEach(f => container.appendChild(f));

        this.editor.open(container);

        // Reset buffers
        this.picker.multiCaptureQueue = [];
        this.scraper.capturedItems = [];
        this.picker.targetElement = null;
    }

    async handleSave(onlySelection) {
        if (!this.editor.isFiltering) return;

        const html = await this.editor.prepareExport(onlySelection);
        const finalHtml = this.exporter.assembleExport(html);

        ScraperUtils.downloadFile(finalHtml, `universal-export-${Date.now()}.html`);
        ScraperUtils.updateStatus('Export complete!', false);
    }

    handlePickMore() {
        if (!this.editor.isFiltering) return;

        this.editor.filterContainer.style.display = 'none';
        if (this.editor.originalBody) this.editor.originalBody.style.display = 'block';

        this.picker.enable('multi');
        ScraperUtils.updateStatus('Click elements to add to your export. Click "Done" when finished.', true);

        const doneBtn = document.createElement('button');
        doneBtn.id = 'mb-picker-done';
        doneBtn.innerText = 'Finish Selection';
        doneBtn.style = `
            position: fixed; top: 20px; right: 50%; transform: translateX(-50%);
            background: #10b981; color: white; padding: 10px 20px;
            border: none; border-radius: 6px; font-size: 16px; font-weight: bold;
            cursor: pointer; z-index: 2000002; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            font-family: system-ui, sans-serif;
        `;
        document.body.appendChild(doneBtn);

        const finishSelection = () => {
            doneBtn.remove();
            this.picker.disable(false);

            const newFragments = this.picker.multiCaptureQueue.map(el => ScraperUtils.freezeElement(el, this.assetCache));

            const container = this.editor.canvasWorld.querySelector('.mb-multi-container');
            if (container) {
                newFragments.forEach(f => container.appendChild(f));
            } else {
                newFragments.forEach(f => this.editor.canvasWorld.appendChild(f));
            }

            this.picker.multiCaptureQueue = [];

            this.editor.filterContainer.style.display = 'block';
            if (this.editor.originalBody) this.editor.originalBody.style.display = 'none';

            this.editor.calculateWorldBounds();

            ScraperUtils.updateStatus('Added elements to editor.', true);
        };

        doneBtn.addEventListener('click', finishSelection);
    }

    handleEditorExit() {
        // Cleanup if needed
    }
}

// Initialize
const scraper = new UniversalScraper();

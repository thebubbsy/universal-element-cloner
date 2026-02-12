/**
 * Universal Element Cloner: content.js
 * Implementation by Matthew Bubb's trusty screwdriver.
 */

console.log('Universal Element Cloner: Content Script Loaded (v2.1 Fix Applied)');

class UniversalScraper {
    constructor() {
        this.pickerActive = false;
        this.scraping = false;
        this.targetElement = null;
        this.highlightedElement = null;
        this.capturedItems = [];
        this.seenHashes = new Set();
        this.assetCache = new Map(); // Global cache for base64 -> ObjectURL
        this.observer = null;
        this.direction = 'down'; // 'down' or 'up'

        // Filter Mode State
        this.isFiltering = false;
        this.editMode = 'none'; // 'delete', 'move', 'resize', 'none'
        this.undoStack = [];
        this.redoStack = [];
        this.filterContainer = null;
        this.originalBody = null;
        this.dragElement = null;
        this.dragOffset = { x: 0, y: 0 };
        this.depthStack = [];
        this.depthIndex = 0;
        this.highlightedDepthElement = null;
        this.multiCaptureQueue = [];
        this.pickerMode = 'single'; // 'single' or 'multi'
        this.isGuidedMode = false;
        this.scrollables = [];
        this.scrollListeners = [];

        // --- ANIMATION / FEEDBACK STATE ---
        this.lastScrollY = window.scrollY;
        this.lastScrollTime = Date.now();
        this.scrollVelocity = 0; // px/ms
        this.revealLineY = window.scrollY + window.innerHeight; // Absolute Y
        this.pendingElements = []; // {el, rect}
        this.scanOverlay = null; // Changed from scanLine
        this.isScanning = false;
        this.scrapingSpeed = 0;
        this._scrapeStartTime = 0;

        this.cropState = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            rect: null // {x, y, w, h} in world coordinates
        };
        this.cropBox = null; // {x, y, w, h} relative to world
        this.isCropping = false;

        // Export Selection State
        this.exportSelection = new Set();
        this.isExportSelectMode = false;

        // Delete Selection State
        this.deleteSelection = new Set();

        this.initUniversalHandlers();
        this.bindEvents();
    }

    initUniversalHandlers() {
        this._universalWheelHandler = (e) => {
            if (e.shiftKey) {
                // UNIVERSAL DEPTH CYCLING
                e.preventDefault();
                e.stopPropagation();

                if (this.depthStack && this.depthStack.length > 1) {
                    if (e.deltaY > 0) this.depthIndex = (this.depthIndex + 1) % this.depthStack.length;
                    else this.depthIndex = (this.depthIndex - 1 + this.depthStack.length) % this.depthStack.length;

                    const highlightClass = this.isFiltering
                        ? (this.editMode === 'delete' ? 'mb-hover-delete' : (this.editMode === 'none' ? 'mb-highlight' : `mb-hover-${this.editMode}`))
                        : 'mb-highlight';

                    this.updateDepthHighlight(highlightClass);
                }
                return;
            }

            // REGULAR SCROLL / ZOOM
            if (this.isFiltering && this.editMode === 'none') {
                e.preventDefault();
                e.stopPropagation();
                const zoomIntensity = 0.001;
                const newScale = this.canvasState.scale + (-e.deltaY * zoomIntensity);
                this.setZoom(newScale);
            }
        };

        this.updateDepthHighlight = (cls = 'mb-hover-delete') => {
            // Remove previous highlights
            if (this.highlightedElement) this.highlightedElement.classList.remove('mb-highlight', 'mb-hover-delete', 'mb-hover-move', 'mb-hover-resize');
            if (this.highlightedDepthElement) this.highlightedDepthElement.classList.remove('mb-highlight', 'mb-hover-delete', 'mb-hover-move', 'mb-hover-resize');

            this.highlightedDepthElement = this.depthStack[this.depthIndex];
            if (this.highlightedDepthElement) {
                this.highlightedDepthElement.classList.add(cls);
                this.updateStatus(`Depth: ${this.depthIndex + 1}/${this.depthStack.length} (<${this.highlightedDepthElement.tagName.toLowerCase()}>) - Shift+Scroll to cycle`, true);
            }
        };
    }

    bindEvents() {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            let isAsync = false;
            switch (msg.action) {
                case 'START_SCRAPE':
                    this.startScraping(msg.speed, msg.direction);
                    break;
                case 'STOP_SCRAPE':
                    this.stopScraping();
                    break;
                case 'START_MULTI_CAPTURE':
                    this.startMultiCapture();
                    break;
                case 'FINISH_PICKING':
                    this.disablePicker(false);
                    break;
                case 'CANCEL_CAPTURE':
                    this.disablePicker(true);
                    break;
                case 'FULL_PAGE_FILTER':
                    this.prepareFullPageCapture();
                    break;
                case 'CANCEL_GUIDED':
                    this.cancelGuidedCapture();
                    break;
                case 'OPEN_SIDE_EDITOR':
                    this.openSideEditor();
                    break;
                case 'TOGGLE_EDIT_MODE':
                    this.toggleEditMode(msg.mode);
                    break;
                case 'UNDO_ACTION':
                    this.undoAction();
                    break;
                case 'REDO_ACTION':
                    this.redoAction();
                    break;
                case 'SAVE_FINAL':
                    this.saveFinal();
                    break;
                case 'EXIT_FILTER_MODE':
                    this.exitFilterMode();
                    break;
                case 'EXPORT_ELEMENTS_START':
                    this.enablePicker('multi');
                    this.updateStatus('Click elements to export (Shift+Scroll to cycle depth)', true);
                    break;
                case 'PICK_ADDITIONAL_ELEMENT':
                    this.pickAdditionalElement();
                    break;
                // Add any async cases here and set isAsync = true
            }
            if (!isAsync) {
                sendResponse({ success: true }); // Acknowledge receipt
                return false; // Close channel immediately for sync actions
            }
            return true; // Keep open for async
        });
    }

    // --- PICKER ENGINE ---
    enablePicker(mode = 'single') {
        this.pickerMode = mode;
        this.pickerActive = true;
        this._hoverHandler = (e) => {
            // IGNORE OWN UI
            if (e.target.id === 'mb-picker-done' || e.target.closest('#mb-canvas-toolbar') || e.target.closest('#mb-canvas-minimap')) return;

            e.stopPropagation();

            // Populate depth stack for the current point
            this.depthStack = document.elementsFromPoint(e.clientX, e.clientY)
                .filter(node => node.nodeType === 1 && !node.id?.startsWith('mb-') && !node.closest('[id^="mb-"]'));

            this.depthIndex = 0;
            const el = this.depthStack[this.depthIndex] || e.target;

            if (this.highlightedElement === el) return;
            if (this.highlightedElement) this.highlightedElement.classList.remove('mb-highlight');
            this.highlightedElement = el;
            el.classList.add('mb-highlight');
        };

        this._clickHandler = (e) => {
             // IGNORE OWN UI (Let default click happen)
            if (e.target.id === 'mb-picker-done' || e.target.closest('#mb-canvas-toolbar') || e.target.closest('#mb-canvas-minimap')) return;

            e.preventDefault();
            e.stopPropagation();

            // Use current cycled element if shift-scrolled
            const target = (this.highlightedDepthElement && this.pickerActive) ? this.highlightedDepthElement : e.target;

            // Toggle highlight on live element
            if (target.classList.contains('mb-selected')) {
                target.classList.remove('mb-selected');
                this.multiCaptureQueue = this.multiCaptureQueue.filter(entry => entry !== target);
                if (this.targetElement === target) this.targetElement = this.multiCaptureQueue[this.multiCaptureQueue.length - 1] || null;
            } else {
                target.classList.add('mb-selected');
                this.multiCaptureQueue.push(target);
                this.targetElement = target; // Set as scraper target
            }

            this.updateStatus(`Selected ${this.multiCaptureQueue.length} elements. Ready to Scrape or Finish.`, true);
        };

        this._wheelHandler = (e) => this._universalWheelHandler(e);

        document.addEventListener('mouseover', this._hoverHandler, true);
        document.addEventListener('click', this._clickHandler, true);
        document.addEventListener('wheel', this._wheelHandler, { passive: false });
        this.updateStatus(this.pickerMode === 'multi' ? "Click elements to add to Multi-Capture (Shift+Scroll to cycle depth)" : "Click to select and Edit (Shift+Scroll to cycle depth)", true);
    }

    startMultiCapture() {
        this.pickerMode = 'multi';
        this.multiCaptureQueue = [];
        this.enablePicker('multi');

        // Inject Selection Styles if they don't exist
        if (!document.getElementById('mb-selection-styles')) {
            const style = document.createElement('style');
            style.id = 'mb-selection-styles';
            style.innerHTML = `
                .mb-highlight {
                    outline: 2px solid #0051C3 !important;
                    outline-offset: -2px !important;
                    background: rgba(0, 81, 195, 0.1) !important;
                    cursor: pointer !important;
                }
                .mb-highlight-active {
                    background: rgba(34, 197, 94, 0.4) !important;
                    box-shadow: 0 0 15px rgba(34, 197, 94, 0.6) !important;
                    outline: 2px solid #22c55e !important;
                }
                .mb-selected {
                    outline: 3px solid #22c55e !important;
                    outline-offset: -3px !important;
                    box-shadow: 0 0 15px rgba(34, 197, 94, 0.6) !important;
                    background: rgba(34, 197, 94, 0.05) !important;
                }
            `;
            document.head.appendChild(style);
        }
    }

    disablePicker(clean = true) {
        this.pickerActive = false;
        document.removeEventListener('mouseover', this._hoverHandler, true);
        document.removeEventListener('click', this._clickHandler, true);
        if (this._wheelHandler) document.removeEventListener('wheel', this._wheelHandler, { passive: false });

        if (this.highlightedDepthElement) {
            this.highlightedDepthElement.classList.remove('mb-highlight');
            this.highlightedDepthElement = null;
        }

        if (clean) {
            document.querySelectorAll('.mb-highlight, .mb-selected').forEach(el => {
                el.classList.remove('mb-highlight', 'mb-selected');
            });
            this.multiCaptureQueue = [];
        }
    }

    openSideEditor() {
        // CONSOLIDATE ALL PENDING: multiCaptureQueue (Live Picked) + capturedItems (Scraped Clones)
        const fragments = [];

        // 1. Process Live Picked elements (Deferred Cloning) - SEQUENTIAL (Selection Order)
        if (this.multiCaptureQueue.length > 0) {
            this.multiCaptureQueue.forEach(el => {
                fragments.push(this.freezeStyles(el));
            });
        }

        // 2. Process Scraped Clones
        if (this.capturedItems.length > 0) {
            this.capturedItems.forEach(item => {
                const temp = document.createElement('div');
                temp.innerHTML = item.html;
                fragments.push(temp.firstElementChild);
            });
        }

        // If nothing picked/scraped but we are in full page mode, capture body
        if (fragments.length === 0 && this.isGuidedMode) {
            fragments.push(this.freezeStyles(document.body));
        }

        if (fragments.length === 0) return this.updateStatus("Nothing to edit. Pick elements first.", false);

        // Cleanup original page highlights
        this.disablePicker(true);
        this.cancelGuidedCapture();

        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '20px';
        container.style.padding = '40px';
        container.classList.add('mb-multi-container');

        fragments.forEach(f => container.appendChild(f));
        this.setupFilterContainer(container);

        // Reset buffers
        this.multiCaptureQueue = [];
        this.capturedItems = [];
        this.targetElement = null;
    }

    // --- SCRAPING ENGINE ---
    async startScraping(speed, direction) {
        if (!this.targetElement) {
            this.targetElement = document.body;
            this.updateStatus("No target picked. Auto-scrolling full page.", false);
        }
        this.scraping = true;
        this.direction = direction || 'down';
        this.scrapingSpeed = speed;
        this.capturedItems = [];
        this.seenHashes.clear();

        // Dynamic Content Detection
        this.observer = new MutationObserver((mutations) => {
            if (!this.scraping) return;
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === 1) this.processElement(node);
                });
            });
        });
        this.observer.observe(this.targetElement, { childList: true, subtree: true });

        this.updateStatus("Scraping started...", true);
        this.startScanning();
        this.startAnimationLoop(); // Ensure feedback starts
        this.captureLoop(speed);
    }

    stopScraping() {
        this.scraping = false;
        if (this.observer) this.observer.disconnect();
        this.stopScanning();
        this.updateStatus(`Collected ${this.capturedItems.length} items. Open Editor to proceed.`, false);
        // NO AUTO EXPORT
    }

    async captureLoop(speed) {
        if (!this.scraping) return;
        this.captureSnapshot();

        if (speed > 0) {
            const scrollAmt = this.direction === 'up' ? -300 : 300;

            // ROBUST SCROLL: Find the true scrollable container
            const scroller = this.findScrollableAncestor(this.targetElement);

            if (scroller) {
                scroller.scrollBy({ top: scrollAmt, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: scrollAmt, behavior: 'smooth' });
            }

            await new Promise(r => setTimeout(r, 1000)); // Wait for render or lazy-load
            this.captureLoop(speed);
        }
    }

    startAnimationLoop() {
        if (!this.scraping) return;

        if (this.scanOverlay) {
            const rect = this.targetElement.getBoundingClientRect();
            if (this.scrapingSpeed === 0) {
                // Sweep animation for static capture (1.5s sweep for more energy)
                const elapsed = (Date.now() - this._scrapeStartTime) % 1500;
                const percent = elapsed / 1500;
                const sweepY = rect.top + (rect.height * percent);
                this.scanOverlay.style.top = `${sweepY}px`;
                this.scanOverlay.style.height = '4px';
            } else {
                // Follow the scroll lag zone (25% behind the leading edge)
                const lagZoneThreshold = window.innerHeight * 0.25;
                // If scrolling UP, leading edge is TOP (0), lag zone is at 25% from TOP
                // If scrolling DOWN, leading edge is BOTTOM (100%), lag zone is at 25% from BOTTOM
                const lineY = this.direction === 'up' ? lagZoneThreshold : (window.innerHeight - lagZoneThreshold);
                this.scanOverlay.style.top = `${lineY}px`;
                this.scanOverlay.style.height = '8px'; // Thicker scanning zone when moving
            }
        }

        requestAnimationFrame(() => this.startAnimationLoop());
    }

    findScrollableAncestor(el) {
        if (!el) return null;
        let parent = el;
        while (parent) {
            if (parent.scrollHeight > parent.clientHeight) {
                const style = window.getComputedStyle(parent);
                const isScrollable = /(auto|scroll)/.test(style.overflow + style.overflowY);
                if (isScrollable) return parent;
            }
            parent = parent.parentElement;
        }
        return null;
    }

    captureSnapshot() {
        // Find children that look like items
        // Heuristic: Direct children or children with specific roles/classes
        if (!this.targetElement) {
            console.warn('FullPageScraper: No target element defined for captureSnapshot');
            this.targetElement = document.body;
        }

        if (!this.targetElement.children || this.targetElement.children.length === 0) {
            console.warn(`FullPageScraper: Target <${this.targetElement.tagName}> has no children to capture.`);
            // If it's the body and empty (unlikely but possible during transitions), or if it's a specific element we picked
            if (this.targetElement !== document.body) {
                this.processElement(this.targetElement);
            }
            return;
        }

        const items = this.targetElement.children;
        for (const item of items) {
            this.processElement(item);
        }
    }

    processElement(el) {
        // Skip hidden or non-content elements
        if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return;

        // STRICT SKIP: If it has been captured or is inside a captured parent, skip it.
        if (el !== this.targetElement && (el.classList.contains('mb-captured') || el.closest('.mb-captured'))) return;

        // Fingerprint to avoid duplicates
        const hash = this.generateHash(el);
        if (this.seenHashes.has(hash)) return;
        this.seenHashes.add(hash);

        // High Fidelity Clone
        const clone = this.freezeStyles(el);

        // Final Clean
        clone.classList.remove('mb-captured', 'mb-highlight');
        Array.from(clone.querySelectorAll('.mb-captured, .mb-highlight')).forEach(c => {
            c.classList.remove('mb-captured', 'mb-highlight');
        });

        const itemObj = { html: clone.outerHTML, hash: hash };

        if (this.direction === 'up') {
            this.capturedItems.unshift(itemObj);
        } else {
            this.capturedItems.push(itemObj);
        }

        // VISUAL STATE TRACKING: Add to pending reveal queue
        const rect = el.getBoundingClientRect();
        this.pendingElements.push({
            el: el,
            absY: rect.top + window.scrollY,
            height: rect.height,
            captured: false
        });

        this.updateCount();
    }

    updateCount() {
        chrome.runtime.sendMessage({ action: 'COUNT_UPDATE', count: this.capturedItems.length });
    }

    // --- HIGH PERFORMANCE FEEDBACK SYSTEM ---
    startScanning() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.pendingElements = [];

        // Setup Scan Overlay
        if (!this.scanOverlay) {
            this.scanOverlay = document.createElement('div');
            this.scanOverlay.className = 'mb-scan-line'; // Re-use class for styles
            document.body.appendChild(this.scanOverlay);
        }
        this.scanOverlay.style.display = 'block';

        // Initial Reveal Line Position
        const viewportBottom = window.scrollY + window.innerHeight;
        const viewportTop = window.scrollY;

        this.revealLineY = this.direction === 'up' ? viewportBottom : viewportTop;
        this.lastScrollY = window.scrollY;
        this.lastScrollTime = Date.now();

        const loop = () => {
            if (!this.isScanning) return;
            this.updateScanning();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stopScanning() {
        this.isScanning = false;
        if (this.scanOverlay) this.scanOverlay.style.display = 'none';
        // Reveal all remaining pending elements instantly
        this.pendingElements.forEach(item => {
            if (!item.captured) {
                item.el.classList.add('mb-captured');
                item.captured = true;
            }
        });
    }

    updateScanning() {
        const now = Date.now();
        const currentY = window.scrollY;
        const dt = now - this.lastScrollTime;
        const dy = currentY - this.lastScrollY;

        // Update velocity (px/ms)
        if (dt > 0) {
            const instantVelocity = dy / dt;
            this.scrollVelocity = (this.scrollVelocity * 0.8) + (instantVelocity * 0.2); // Smoothed
        }

        this.lastScrollY = currentY;
        this.lastScrollTime = now;

        const viewportTop = currentY;
        const viewportBottom = currentY + window.innerHeight;

        if (this.direction === 'up') {
            let targetY = viewportBottom;
            if (this.scrollVelocity < -0.2) { // Scrolling UP quickly
                const lag = window.innerHeight * 0.25;
                targetY = viewportBottom + lag;
            }
            this.revealLineY = Math.min(this.revealLineY, targetY);
            this.revealLineY -= 8; // Crawl up speed
        } else {
            let targetY = viewportTop;
            if (this.scrollVelocity > 0.2) { // Scrolling DOWN quickly
                const lag = window.innerHeight * 0.25;
                targetY = viewportTop - lag;
            }
            this.revealLineY = Math.max(this.revealLineY, targetY);
            this.revealLineY += 8; // Crawl down speed
        }

        // Apply Reveal
        this.pendingElements.forEach(item => {
            if (item.captured) return;

            let shouldReveal = false;
            if (this.direction === 'up') {
                if (this.revealLineY <= (item.absY + item.height)) shouldReveal = true;
            } else {
                if (this.revealLineY >= item.absY) shouldReveal = true;
            }

            if (shouldReveal) {
                item.el.classList.add('mb-captured');
                item.captured = true;
                // Faster recursive reveal
                item.el.querySelectorAll('*').forEach((c, i) => {
                    setTimeout(() => c.classList.add('mb-captured'), i * 20);
                });
            }
        });

        // Update Scan Overlay Position
        if (this.scanOverlay) {
            const relY = this.revealLineY - currentY;
            this.scanOverlay.style.top = relY + 'px';
            if (relY < -50 || relY > window.innerHeight + 50) {
                this.scanOverlay.style.opacity = '0';
            } else {
                this.scanOverlay.style.opacity = '1';
            }
        }
    }

    generateHash(el) {
        // Precise fingerprint: Text content + ID + ClassName + Attributes + Child Tags
        const text = el.innerText?.substring(0, 200) || "";
        const id = el.id || "";
        // Ignore mb-captured class to avoid duplicate capture when color changes
        const cls = Array.from(el.classList)
            .filter(c => c !== 'mb-captured' && c !== 'mb-highlight')
            .join(".");
        const attrs = Array.from(el.attributes).map(a => `${a.name}:${a.value}`).join("|");
        const structure = Array.from(el.children).map(c => c.tagName).join("-");

        const raw = `${text}_${id}_${cls}_${attrs}_${structure}`;
        // Basic Djb2 hash replacement for simplicity in content script
        let hash = 5381;
        for (let i = 0; i < raw.length; i++) {
            hash = (hash * 33) ^ raw.charCodeAt(i);
        }
        return hash.toString(16);
    }

    // --- STYLE FREEZING (MASTER CLONE) ---
    freezeStyles(el) {
        // Detect state before cleanup
        const hadCaptured = el.classList.contains('mb-captured');
        const hadHighlight = el.classList.contains('mb-highlight');

        // Temporary removal of highlight classes from SOURCE for clean computed style capture
        const cleanup = (node) => {
            if (node.nodeType !== 1) return;
            node.classList.remove('mb-captured', 'mb-highlight', 'mb-selected');
            for (let child of node.children) cleanup(child);
        };

        // We need to restore them after cloning, so we'll just remove them from the clone afterwards if we want
        // But better is to remove from source, clone, then restore source.
        const selectedElements = Array.from(el.querySelectorAll('.mb-selected')).concat(el.classList.contains('mb-selected') ? [el] : []);
        const highlightedElements = Array.from(el.querySelectorAll('.mb-highlight')).concat(el.classList.contains('mb-highlight') ? [el] : []);

        el.classList.remove('mb-captured', 'mb-highlight', 'mb-selected');
        el.querySelectorAll('.mb-captured, .mb-highlight, .mb-selected').forEach(node => {
            node.classList.remove('mb-captured', 'mb-highlight', 'mb-selected');
        });

        const clone = el.cloneNode(true);

        // Restore highlights to live source
        selectedElements.forEach(node => node.classList.add('mb-selected'));
        highlightedElements.forEach(node => node.classList.add('mb-highlight'));

        const assetMap = new Map(); // Local deduping for this element tree

        const processImage = (target, source) => {
            const handleBase64 = (value) => {
                // If it's already a Data URL, we good.
                // We could cache it here if we want to accept existing base64
                return value;
            };

            const ensureAbsolute = (url) => {
                if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
                try {
                    return new URL(url, window.location.href).href;
                } catch (e) {
                    return url;
                }
            };

            // IMMEDIATE CAPTURE & EMBED
            const embedImage = async (url, setter) => {
                if (!url || url.startsWith('data:')) return;
                try {
                    // Cache check
                    if (this.assetCache.has(url)) {
                        setter(this.assetCache.get(url));
                        return;
                    }

                    const b64 = await this.urlToBase64(url);
                    if (b64) {
                        this.assetCache.set(url, b64);
                        setter(b64);
                    }
                } catch (e) {
                    console.warn('Capture failed for:', url);
                }
            };

            if (target.tagName === 'IMG') {
                const absSrc = ensureAbsolute(source.currentSrc || source.src); // Use currentSrc if available (responsive images)
                target.src = absSrc; // Set initial absolute URL
                target.dataset.originalSrc = absSrc; // Cache location

                // FORCE EAGER LOADING for clone
                target.loading = 'eager';
                target.removeAttribute('loading'); // Some browsers prefer removal

                // If it was lazy loaded and hasn't loaded yet, it might be a placeholder.
                // We try to grab the real src from data attributes if common patterns exist
                if (source.dataset.src) target.src = ensureAbsolute(source.dataset.src);
                if (source.dataset.srcset) target.srcset = source.dataset.srcset; // We should probably sanitize this too but it's complex

                // Fire and forget conversion
                embedImage(absSrc, (b64) => { target.src = b64; target.srcset = ''; });
            }

            const bg = window.getComputedStyle(source).backgroundImage;
            if (bg && bg !== 'none') {
                const urlMatch = bg.match(/url\(["']?([^"']+)["']?\)/);
                if (urlMatch) {
                    const absBg = ensureAbsolute(urlMatch[1]);
                    target.style.backgroundImage = `url("${absBg}")`;
                    target.dataset.originalBg = absBg;

                    embedImage(absBg, (b64) => { target.style.backgroundImage = `url("${b64}")`; });
                }
            }
        };

        const applyComputed = (source, target) => {
            if (source.nodeType !== 1) return;
            const comp = window.getComputedStyle(source);

            // Comprehensive properties for pixel-perfect fidelity
            const props = [
                'display', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
                'margin', 'padding', 'border', 'borderWidth', 'borderColor', 'borderStyle', 'borderRadius',
                'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
                'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
                'textAlign', 'textTransform', 'textDecoration',
                'overflow', 'visibility', 'opacity', 'boxShadow', 'zIndex',
                'display', 'flex', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis',
                'gridTemplateColumns', 'gridTemplateRows', 'gridGap', 'gap',
                'transform', 'transition', 'cursor', 'pointerEvents',
                'boxSizing', 'backdropFilter', 'filter', 'mixBlendMode', 'objectFit'
            ];

            props.forEach(p => {
                let val = comp[p];
                // CRITICAL: Filter out our own selection indicators from computed values
                if (p === 'backgroundColor' && (val.includes('rgba(0, 255, 136') || val.includes('0, 255, 136'))) {
                    return; // Don't clone the green background
                }
                if (p === 'outline' && val.includes('rgb(98, 100, 167)')) {
                    return; // Don't clone the picker outline
                }

                // SCROLLBAR FIX: Normalize overflow to prevent redundant scrollbars
                if (p === 'overflow' || p === 'overflowX' || p === 'overflowY') {
                    if (val === 'auto' || val === 'scroll') {
                        // If it's the main target, keep it if it's the root container, otherwise make it visible
                        val = 'visible';
                    }
                }

                if (val && val !== 'initial' && val !== 'none') {
                    target.style[p] = val;
                }
            });

            target.style.boxSizing = 'border-box';
            processImage(target, source);

            // Mirror Pseudo-Elements (Experimental but Powerful)
            ['::before', '::after'].forEach(type => {
                const pComp = window.getComputedStyle(source, type);
                if (pComp.content && pComp.content !== 'none' && pComp.content !== '""') {
                    const span = document.createElement('span');
                    span.innerText = pComp.content.replace(/^"|"$/g, '');

                    // Copy prominent pseudo-styles
                    ['position', 'display', 'color', 'background', 'width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'border', 'borderRadius', 'fontSize', 'fontWeight'].forEach(k => {
                        const v = pComp[k];
                        if (k === 'background' && (v.includes('rgba(0, 255, 136') || v.includes('0, 255, 136'))) return;
                        span.style[k] = v;
                    });

                    span.style.pointerEvents = 'none';
                    if (type === '::before') target.prepend(span);
                    else target.append(span);
                }
            });

            // Recurse
            for (let i = 0; i < source.children.length; i++) {
                if (target.children[i]) applyComputed(source.children[i], target.children[i]);
            }
        };

        applyComputed(el, clone);

        // Restore classes to source
        if (hadCaptured) el.classList.add('mb-captured');
        if (hadHighlight) el.classList.add('mb-highlight');

        return clone;
    }

    updateStatus(text, active) {
        chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', text, active });
    }

    exportResults() {
        const uniqueItems = [];
        const seen = new Set();

        this.capturedItems.forEach(item => {
            if (!seen.has(item.hash)) {
                seen.add(item.hash);
                uniqueItems.push(item.html);
            }
        });

        const html = this.assembleExport(uniqueItems.join('\n'));
        this.downloadFile(html, `universal-export-${Date.now()}.html`);
    }

    assembleExport(content) {
        // Create a temporary container to process the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        // Sanitize all iframes in the content
        tempDiv.querySelectorAll('iframe').forEach(iframe => {
            this.sanitizeIframe(iframe);
        });

        // Assemble the final HTML document
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Universal Element Export</title>
    <style>
        body { margin: 0; padding: 40px; background: #f8f9fa; min-height: 100vh; font-family: -apple-system, system-ui, sans-serif; }
        .export-container { max-width: 1200px; margin: 0 auto; }
        .branding { margin-top: 60px; padding-top: 30px; border-top: 1px solid #eee; text-align: center; color: #888; font-weight: 600; letter-spacing: 0.5px; }
    </style>
</head>
<body>
    <div class="export-container">
        ${tempDiv.innerHTML}
    </div>
    <div class="branding">This is the Universal Element Cloner by Matthew Bubb</div>
</body>
</html>`;
    }

    prepareFullPageCapture() {
        if (this.isGuidedMode) return;
        this.isGuidedMode = true;

        // Full page is always top-to-bottom standard
        this.direction = 'down';

        // Detect scrollable containers - ROBUST DETECTION
        this.scrollables = [window, ...Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.id?.startsWith('mb-')) return false; // Ignore own UI
            const style = window.getComputedStyle(el);
            const isScrollable = (style.overflow === 'auto' || style.overflow === 'scroll' ||
                                 style.overflowY === 'auto' || style.overflowY === 'scroll');
            const hasScrollContent = el.scrollHeight > el.clientHeight + 10;
            return isScrollable && hasScrollContent;
        })];

        this.scrollListeners = [];

        const reportProgress = () => {
            let totalProgress = 0;
            const scrollersInfo = this.scrollables.map((s, idx) => {
                let progress = 0;
                let name = s === window ? "Main Window" : `${s.tagName.toLowerCase()}#${s.id || idx}`;

                if (s === window) {
                    const scrollPos = window.scrollY + window.innerHeight;
                    const totalHeight = document.documentElement.scrollHeight;
                    progress = Math.min((scrollPos / totalHeight) * 100, 100);
                } else {
                    const scrollPos = s.scrollTop + s.clientHeight;
                    const totalHeight = s.scrollHeight;
                    progress = Math.min((scrollPos / totalHeight) * 100, 100);
                }
                totalProgress += progress;
                return { name, progress: Math.round(progress) };
            });

            const avgProgress = Math.round(totalProgress / this.scrollables.length);

            chrome.runtime.sendMessage({
                action: 'GUIDED_PROGRESS',
                progress: avgProgress,
                scrollers: scrollersInfo
            });
        };

        // Attach listeners
        this.scrollables.forEach(s => {
            const listener = () => reportProgress();
            s.addEventListener('scroll', listener, { passive: true });
            this.scrollListeners.push({ target: s, listener });
        });

        reportProgress();
    }

    cancelGuidedCapture() {
        this.isGuidedMode = false;
        this.scrollListeners.forEach(item => {
            item.target.removeEventListener('scroll', item.listener);
        });
        this.scrollListeners = [];
        this.scrollables = [];
    }

    setupFilterContainer(clone) {
        if (this.filterContainer) return;

        this.isFiltering = true;
        this.originalBody = document.body;

        // Save current scroll position
        this._savedScroll = { x: window.scrollX, y: window.scrollY };

        // Hide original page content
        this.originalBody.style.display = 'none';

        // --- INFINITE CANVAS SETUP ---
        // Viewport: Fixed window into the world
        this.filterContainer = document.createElement('div');
        this.filterContainer.id = 'mb-canvas-viewport';

        // World: The surface
        this.canvasWorld = document.createElement('div');
        this.canvasWorld.id = 'mb-canvas-world';

        // Canvas Paper area (Visual helper)
        this.canvasPaper = document.createElement('div');
        this.canvasPaper.id = 'mb-canvas-paper';
        this.canvasPaper.style = `
            position: absolute; background: white;
            box-shadow: 0 0 100px rgba(0,0,0,0.5);
            pointer-events: none;
        `;
        this.canvasWorld.appendChild(this.canvasPaper);

        // Initial State
        this.canvasState = {
            x: 0,
            y: 0,
            scale: 1,
            isPanning: false,
            startX: 0,
            startY: 0
        };

        this.canvasWorld.appendChild(clone);
        this.filterContainer.appendChild(this.canvasWorld);

        // --- TOOLBAR UI ---
        this.toolbar = document.createElement('div');
        this.toolbar.id = 'mb-canvas-toolbar';
        this.toolbar.innerHTML = `
            <div class="mb-tool-group">
                <button id="mb-tool-pan" class="mb-tool-btn active" title="Pan Tool (Space)">✋</button>
                <button id="mb-tool-select" class="mb-tool-btn" title="Select/Edit Tool (V)">Select</button>
                <button id="mb-tool-crop" class="mb-tool-btn" title="Crop Selection Tool (C)">Crop</button>
            </div>
            <div class="mb-toolbox-divider"></div>
            <div class="mb-tool-group">
                <button id="mb-btn-zoom-out" class="mb-tool-btn" title="Zoom Out (-)">−</button>
                <span id="mb-zoom-level">100%</span>
                <button id="mb-btn-zoom-in" class="mb-tool-btn" title="Zoom In (+)">+</button>
                <button id="mb-btn-fit" class="mb-tool-btn" title="Fit to Screen (0)">Fit</button>
            </div>
            <div class="mb-toolbox-divider"></div>
            <div class="mb-tool-group">
                 <button id="mb-tool-export-pick" class="mb-tool-btn" title="Select Specific Elements for Export">🎯</button>
                 <button id="mb-btn-add" class="mb-tool-btn primary" title="Add Element from Page">+ Element</button>
                 <button id="mb-btn-execute-delete" class="mb-tool-btn danger" style="display:none;" title="Delete Selected Elements">🗑️ Delete Selected</button>
                 <button id="mb-btn-export-selection" class="mb-tool-btn success" style="display:none;" title="Export Selected Elements">Export Selected</button>
                 <button id="mb-btn-export" class="mb-tool-btn success" title="Export Final HTML (Respects Crop)">Export</button>
                 <button id="mb-btn-close" class="mb-tool-btn danger" title="Close">Exit</button>
            </div>
        `;
        this.toolbar.style = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #1e1e1e; border: 1px solid #333; border-radius: 8px;
            padding: 8px 12px; display: flex; gap: 12px; align-items: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 2000001;
            font-family: system-ui, sans-serif; color: #fff;
        `;
        this.filterContainer.appendChild(this.toolbar);

        // --- MINIMAP UI ---
        this.minimap = document.createElement('div');
        this.minimap.id = 'mb-canvas-minimap';
        this.minimap.style = `
            position: fixed; bottom: 20px; right: 20px;
            width: 200px; height: 150px; background: rgba(30,30,30,0.9);
            border: 1px solid #444; border-radius: 6px; overflow: hidden;
            z-index: 2000001; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        `;
        // Minimap content (simplified view)
        this.minimapView = document.createElement('div');
        this.minimapView.style = `
            position: absolute; border: 1px solid #0051C3; background: rgba(0, 81, 195, 0.2);
            cursor: grab;
        `;
        this.minimap.appendChild(this.minimapView);
        this.filterContainer.appendChild(this.minimap);

        document.documentElement.appendChild(this.filterContainer);

        // Inject Canvas Styles
        const style = document.createElement('style');
        style.id = 'mb-filter-styles';
        style.innerHTML = `
            .mb-hover-delete { outline: 2px solid #ef4444 !important; cursor: crosshair !important; background: rgba(239, 68, 68, 0.05) !important; }
            .mb-hover-move { outline: 2px solid #f59e0b !important; cursor: move !important; background: rgba(245, 158, 11, 0.05) !important; }
            .mb-hover-resize { outline: 2px solid #0051C3 !important; cursor: nwse-resize !important; background: rgba(0, 81, 195, 0.05) !important; }
            .mb-hover-export { outline: 2px solid #10b981 !important; cursor: pointer !important; background: rgba(16, 185, 129, 0.1) !important; }
            .mb-selected-export { outline: 3px solid #10b981 !important; outline-offset: 2px !important; box-shadow: 0 0 20px rgba(16, 185, 129, 0.3) !important; }
            .mb-resizable { resize: both !important; overflow: auto !important; min-width: 20px; min-height: 20px; pointer-events: auto !important; }
            .mb-dragging { opacity: 0.5 !important; pointer-events: none !important; }
            #mb-canvas-viewport:active { cursor: grabbing; }

            #mb-canvas-world {
                transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1);
                will-change: transform;
            }

            .mb-canvas-viewport.cropping #mb-canvas-world {
                opacity: 0.6;
                filter: grayscale(0.5);
                transform: scale(0.95);
            }

            /* Toolbar Styles */
            .mb-tool-group { display: flex; gap: 4px; align-items: center; }
            .mb-toolbox-divider { width: 1px; height: 24px; background: #444; }
            .mb-tool-btn {
                background: transparent; border: 1px solid transparent; color: #ccc;
                width: 32px; height: 32px; border-radius: 4px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                font-size: 16px; transition: all 0.2s;
            }
            .mb-tool-btn:hover { background: #333; color: #fff; }
            .mb-tool-btn.active { background: #0051C3; color: #fff; border-color: #003d99; }
            .mb-tool-btn.primary { width: auto; padding: 0 12px; background: #0051C3; color: white; font-size: 13px; font-weight: 500; }
            .mb-tool-btn.primary:hover { background: #003d99; }
            .mb-tool-btn.success { width: auto; padding: 0 12px; background: #10b981; color: white; font-size: 13px; font-weight: 500; }
            .mb-tool-btn.success:hover { background: #059669; }
            .mb-tool-btn.danger { width: auto; padding: 0 12px; background: #ef4444; color: white; font-size: 13px; font-weight: 500; }
            .mb-tool-btn.danger:hover { background: #dc2626; }
            #mb-zoom-level { min-width: 45px; text-align: center; font-size: 12px; color: #888; }

            /* Crop Tool Styles */
            .mb-crop-overlay {
                position: absolute;
                border: 2px dashed #0051C3;
                background: rgba(0, 81, 195, 0.1);
                pointer-events: none;
                z-index: 2000002;
            }
            #mb-canvas-viewport.fall-away { background-image: none !important; }
            .mb-canvas-viewport.cropping { cursor: crosshair !important; }

            .mb-export-selected { outline: 3px solid #10b981 !important; outline-offset: 4px; border-radius: 4px; }
        `;
        document.head.appendChild(style);
        this.initEventListeners();
    }

    initEventListeners() {
        // --- PANNING LOGIC ---
        this.filterContainer.addEventListener('mousedown', (e) => {
            if (this.editMode !== 'none' && e.target !== this.filterContainer && e.target !== this.canvasWorld) return;
            // Start Panning
            this.canvasState.isPanning = true;
            this.canvasState.startX = e.clientX - this.canvasState.x;
            this.canvasState.startY = e.clientY - this.canvasState.y;
            this.filterContainer.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (this.canvasState.isPanning) {
                e.preventDefault();
                this.canvasState.x = e.clientX - this.canvasState.startX;
                this.canvasState.y = e.clientY - this.canvasState.startY;
                this.updateCanvasTransform();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.canvasState.isPanning) {
                this.canvasState.isPanning = false;
                this.filterContainer.style.cursor = this.editMode === 'none' ? 'grab' : 'default';
            }
        });

        // --- CROP TOOL LOGIC ---
        // Remove local redundant crop definitions (using Class methods below)
        // The _startCropping, _updateCrop, _finishCropping methods are now class methods defined below.
        // The event listeners for them are also defined below.

        // --- EDIT MODE LOGIC ---
        this._filterHover = (e) => {
            if (this.editMode === 'none' || this.canvasState.isPanning) return;
            const el = e.target;
            if (el === this.filterContainer || el === this.canvasWorld) return;

            // Highlight based on mode
            const cls = (this.editMode === 'delete') ? 'mb-hover-delete' :
                        (this.editMode === 'move') ? 'mb-hover-move' :
                        (this.editMode === 'resize') ? 'mb-hover-resize' :
                        (this.editMode === 'export-pick') ? 'mb-hover-export' : '';

            if (cls) el.classList.add(cls);

            // Always build depth stack in edit mode
            this.depthStack = document.elementsFromPoint(e.clientX, e.clientY)
                .filter(node => this.canvasWorld.contains(node) && node !== this.canvasWorld);
            this.depthIndex = 0;

            // If in move mode, we might want depth highlight, but for now just basic hover
            // this.updateDepthHighlight();
        };

        this._filterOut = (e) => {
            e.target.classList.remove('mb-hover-delete', 'mb-hover-move', 'mb-hover-resize', 'mb-hover-export');
            if (this.highlightedDepthElement) {
                this.highlightedDepthElement.classList.remove('mb-hover-delete', 'mb-hover-move', 'mb-hover-resize', 'mb-hover-export');
                this.highlightedDepthElement = null;
            }
        };

        this._filterWheel = (e) => this._universalWheelHandler(e);

        this._filterClick = (e) => {
            if (this.editMode === 'none' || this.canvasState.isPanning) return;
            const el = this.highlightedDepthElement || e.target;
            if (el === this.filterContainer || el === this.canvasWorld) return;

            e.preventDefault();
            e.stopPropagation();

            if (this.editMode === 'delete') {
                // Toggle selection instead of instant delete
                if (this.deleteSelection.has(el)) {
                    this.deleteSelection.delete(el);
                    el.classList.remove('mb-delete-selected');
                } else {
                    this.deleteSelection.add(el);
                    el.classList.add('mb-delete-selected');
                }

                // Show/hide delete button based on selection
                const deleteBtn = document.getElementById('mb-btn-execute-delete');
                if (deleteBtn) {
                    deleteBtn.style.display = this.deleteSelection.size > 0 ? 'block' : 'none';
                }
            } else if (this.editMode === 'resize') {
                const wasResizable = el.classList.contains('mb-resizable');
                this.pushToUndo({ type: 'resize', element: el, wasResizable });
                el.classList.add('mb-resizable');
            } else if (this.editMode === 'export-pick') {
                if (this.exportSelection.has(el)) {
                    this.exportSelection.delete(el);
                    el.classList.remove('mb-export-selected');
                } else {
                    this.exportSelection.add(el);
                    el.classList.add('mb-export-selected');
                }
            }
            this.syncFilterState();
        };

        this._filterDown = (e) => {
            if (this.editMode !== 'move') return;
            const el = e.target;
            if (el === this.filterContainer || el === this.canvasWorld) return;

            this.dragElement = el;

            // Calculate offset relative to the element's top-left
            const rect = el.getBoundingClientRect();
            // We need to account for scale if we add zoom later, but for now scale is 1
            this.dragOffset = {
                x: (e.clientX - rect.left),
                y: (e.clientY - rect.top)
            };

            // Store original position for undo
            this._dragStartPos = {
                top: el.style.top,
                left: el.style.left,
                position: el.style.position
            };

            el.classList.add('mb-dragging');
            document.addEventListener('mousemove', this._filterMove, true);
            document.addEventListener('mouseup', this._filterUp, true);
        };

        this._filterMove = (e) => {
            if (!this.dragElement) return;

            // Calculate new position relative to WORLD origin
            // World coordinate = (Client Coordinate - World Translation) / Scale
            const worldX = (e.clientX - this.canvasState.x) / this.canvasState.scale;
            const worldY = (e.clientY - this.canvasState.y) / this.canvasState.scale;

            this.dragElement.style.position = 'absolute';
            this.dragElement.style.left = (worldX - this.dragOffset.x) + 'px';
            this.dragElement.style.top = (worldY - this.dragOffset.y) + 'px';
        };

        this._filterUp = (e) => {
            if (this.dragElement) {
                // Find drop target structurally
                this.dragElement.style.display = 'none';
                const target = document.elementFromPoint(e.clientX, e.clientY);
                this.dragElement.style.display = '';

                let dropParent = target ? target.closest('*') : null;
                // Stay within the workspace bounds
                if (!dropParent || !this.canvasWorld.contains(dropParent) || dropParent === this.canvasWorld) {
                    dropParent = this.canvasWorld; // Drop into World root
                }

                const oldParent = this.dragElement.parentElement;
                const oldNextSibling = this.dragElement.nextElementSibling;
                const oldStyle = {
                    top: this._dragStartPos.top,
                    left: this._dragStartPos.left,
                    position: this._dragStartPos.position
                };

                // Move structurally and keeping the absolute position
                dropParent.appendChild(this.dragElement);

                // Note: We keep the absolute position set in _filterMove

                this.pushToUndo({
                    type: 'move',
                    element: this.dragElement,
                    oldParent,
                    oldNextSibling,
                    newParent: dropParent,
                    oldStyle,
                    newStyle: {
                        top: this.dragElement.style.top,
                        left: this.dragElement.style.left,
                        position: 'absolute'
                    }
                });

                this.dragElement.classList.remove('mb-dragging');
                this.dragElement = null;
                this.syncFilterState();
            }
            document.removeEventListener('mousemove', this._filterMove, true);
            document.removeEventListener('mouseup', this._filterUp, true);
        };

        this.canvasWorld.addEventListener('mouseover', this._filterHover, true);
        this.canvasWorld.addEventListener('mouseout', this._filterOut, true);
        this.canvasWorld.addEventListener('click', this._filterClick, true);
        this.canvasWorld.addEventListener('mousedown', (e) => {
            if (this.editMode === 'crop') this._startCropping(e);
            else this._filterDown(e);
        });
        window.addEventListener('mousemove', (e) => {
            if (this.editMode === 'crop') this._updateCrop(e);
        });
        window.addEventListener('mouseup', (e) => {
            if (this.editMode === 'crop') this._endCropping(e);
        });
        this.canvasWorld.addEventListener('wheel', this._filterWheel, { passive: false });

        // --- TOOLBAR EVENTS ---
        document.getElementById('mb-tool-pan').addEventListener('click', () => {
            this.editMode = 'none';
            this._updateToolState();
        });
        document.getElementById('mb-tool-select').addEventListener('click', () => {
            this.editMode = 'move';
            this._updateToolState();
        });
        document.getElementById('mb-tool-crop').addEventListener('click', () => {
            this.editMode = 'crop';
            this.fitToScreen(); // Fit to screen before cropping
            this._updateToolState();
            this.updateStatus("Click and drag on the canvas to define your export area.", true);
        });
        document.getElementById('mb-tool-export-pick').addEventListener('click', () => {
            this.editMode = 'export-pick';
            this._updateToolState();
            this.updateStatus("Select elements one by one to export them together.", true);
        });
        document.getElementById('mb-btn-zoom-in').addEventListener('click', () => this.setZoom(this.canvasState.scale + 0.1));
        document.getElementById('mb-btn-zoom-out').addEventListener('click', () => this.setZoom(this.canvasState.scale - 0.1));
        document.getElementById('mb-btn-fit').addEventListener('click', () => this.fitToScreen());
        document.getElementById('mb-btn-add').addEventListener('click', () => this.pickAdditionalElement());
        document.getElementById('mb-btn-execute-delete').addEventListener('click', () => this.executeDelete());
        document.getElementById('mb-btn-export-selection').addEventListener('click', () => this.saveFinal(true));
        document.getElementById('mb-btn-export').addEventListener('click', () => this.saveFinal(false));
        document.getElementById('mb-btn-close').addEventListener('click', () => this.exitFilterMode());

        // --- MINIMAP EVENTS ---
        this.minimap.addEventListener('mousedown', (e) => {
            const rect = this.minimap.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            // Center viewport on click
            // World Width approx 4000px? dynamic?
            // Better: Minimap represents the bounding box of the world content + padding
        });

        // Initial Tool State
        this._updateToolState();
        this.updateMinimap();
    }


    setZoom(newScale) {
        this.canvasState.scale = Math.max(0.1, Math.min(5, newScale));
        document.getElementById('mb-zoom-level').innerText = Math.round(this.canvasState.scale * 100) + '%';
        this.updateCanvasTransform();
    }

    fitToScreen() {
        const bounds = this.calculateWorldBounds();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Target 90% of screen size
        const scale = Math.min(
            (vw * 0.9) / bounds.width,
            (vh * 0.9) / bounds.height,
            1.5 // Don't zoom in too much
        );

        this.setZoom(scale);

        // Center it
        this.canvasState.x = (vw / 2) - (bounds.left + bounds.width / 2) * scale;
        this.canvasState.y = (vh / 2) - (bounds.top + bounds.height / 2) * scale;
        this.updateCanvasTransform();
    }

    _updateToolState() {
        document.querySelectorAll('.mb-tool-btn').forEach(b => b.classList.remove('active'));
        if (this.editMode === 'none') document.getElementById('mb-tool-pan').classList.add('active');
        else if (this.editMode === 'move') document.getElementById('mb-tool-select').classList.add('active');
        else if (this.editMode === 'crop') document.getElementById('mb-tool-crop').classList.add('active');
        else if (this.editMode === 'export-pick') document.getElementById('mb-tool-export-pick').classList.add('active');

        this.filterContainer.style.cursor = this.editMode === 'none' ? 'grab' : (this.editMode === 'crop' ? 'crosshair' : 'default');
        this.filterContainer.classList.toggle('cropping', this.editMode === 'crop');

        // Cleanup selection highlights if switching away from export-pick
        if (this.editMode !== 'export-pick') {
            this.canvasWorld.querySelectorAll('.mb-export-selected').forEach(el => el.classList.remove('mb-export-selected'));
            this.exportSelection.clear();
            const selBtn = document.getElementById('mb-btn-export-selection');
            if (selBtn) selBtn.style.display = 'none';
        }

        // Cleanup delete selections if switching away from delete mode
        if (this.editMode !== 'delete') {
            this.canvasWorld.querySelectorAll('.mb-delete-selected').forEach(el => el.classList.remove('mb-delete-selected'));
            this.deleteSelection.clear();
            const deleteBtn = document.getElementById('mb-btn-execute-delete');
            if (deleteBtn) deleteBtn.style.display = 'none';
        }

        // Cleanup crop overlay if switching tools and no area set
        if (this.editMode !== 'crop' && !this.cropState.rect && this.cropOverlay) {
            this.cropOverlay.remove();
            this.cropOverlay = null;
        }

        this.syncFilterState();
    }

    updateCanvasTransform() {
        // --- ENFORCE BOUNDARIES ---
        const bounds = this.calculateWorldBounds();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Pad bounds slightly
        const padding = 100;
        const minX = viewportWidth - (bounds.right + padding) * this.canvasState.scale;
        const maxX = padding * this.canvasState.scale - bounds.left * this.canvasState.scale;
        const minY = viewportHeight - (bounds.bottom + padding) * this.canvasState.scale;
        const maxY = padding * this.canvasState.scale - bounds.top * this.canvasState.scale;

        // Apply clamping (if content is smaller than viewport, allow more freedom or center it)
        // For simplicity, we just ensure content is at least partially visible
        this.canvasState.x = Math.max(minX, Math.min(maxX, this.canvasState.x));
        this.canvasState.y = Math.max(minY, Math.min(maxY, this.canvasState.y));

        this.canvasWorld.style.transform = `translate(${this.canvasState.x}px, ${this.canvasState.y}px) scale(${this.canvasState.scale})`;
        this.updateMinimap();
    }

    calculateWorldBounds() {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        let hasContent = false;

        Array.from(this.canvasWorld.children).forEach(el => {
            if (el === this.cropOverlay || el.classList.contains('mb-crop-overlay') || el.id === 'mb-canvas-paper') return;
            hasContent = true;
            left = Math.min(left, el.offsetLeft);
            top = Math.min(top, el.offsetTop);
            right = Math.max(right, el.offsetLeft + el.offsetWidth);
            bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
        });

        if (!hasContent) return { left: 0, top: 0, right: 1000, bottom: 1000 };
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    updateMinimap() {
        if (!this.minimapView) return;

        const bounds = this.calculateWorldBounds();
        // Visual Paper Feedback
        if (this.canvasPaper) {
            this.canvasPaper.style.left = bounds.left + 'px';
            this.canvasPaper.style.top = bounds.top + 'px';
            this.canvasPaper.style.width = bounds.width + 'px';
            this.canvasPaper.style.height = bounds.height + 'px';
        }

        // Minimap Scaling
        const miniWidth = 200;
        const miniHeight = 150;

        // We show a 3x larger area than content in the minimap for context
        const viewW = bounds.width * 2;
        const viewH = bounds.height * 2;
        const worldBounds = {
            left: bounds.left - bounds.width * 0.5,
            top: bounds.top - bounds.height * 0.5,
            width: viewW,
            height: viewH
        };

        const scale = Math.min(miniWidth / viewW, miniHeight / viewH);

        const vpW = window.innerWidth / this.canvasState.scale;
        const vpH = window.innerHeight / this.canvasState.scale;
        const vpX = -this.canvasState.x / this.canvasState.scale;
        const vpY = -this.canvasState.y / this.canvasState.scale;

        const miniVpW = vpW * scale;
        const miniVpH = vpH * scale;
        const miniVpX = (vpX - worldBounds.left) * scale;
        const miniVpY = (vpY - worldBounds.top) * scale;

        this.minimapView.style.width = Math.max(2, miniVpW) + 'px';
        this.minimapView.style.height = Math.max(2, miniVpH) + 'px';
        this.minimapView.style.left = miniVpX + 'px';
        this.minimapView.style.top = miniVpY + 'px';
    }

    pushToUndo(action) {
        this.undoStack.push(action);
        this.redoStack = [];
    }

    toggleEditMode(mode) {
        this.editMode = (this.editMode === mode) ? 'none' : mode;
        this.syncFilterState();
    }

    undoAction() {
        const action = this.undoStack.pop();
        if (!action) return;

        this.redoStack.push(action);
        if (action.type === 'delete') {
            if (action.nextSibling) action.parent.insertBefore(action.element, action.nextSibling);
            else action.parent.appendChild(action.element);
        } else if (action.type === 'batch-delete') {
            // Restore all deleted elements
            action.deletions.forEach(({ element, parent, nextSibling }) => {
                if (nextSibling) parent.insertBefore(element, nextSibling);
                else parent.appendChild(element);
            });
        } else if (action.type === 'resize') {
            if (!action.wasResizable) action.element.classList.remove('mb-resizable');
        } else if (action.type === 'move') {
            if (action.oldNextSibling) action.oldParent.insertBefore(action.element, action.oldNextSibling);
            else action.oldParent.appendChild(action.element);

            action.element.style.top = action.oldStyle.top;
            action.element.style.left = action.oldStyle.left;
            action.element.style.position = action.oldStyle.position;
        } else if (action.type === 'add') {
            action.element.remove();
        }
        this.syncFilterState();
    }

    redoAction() {
        const action = this.redoStack.pop();
        if (!action) return;

        this.undoStack.push(action);
        if (action.type === 'delete') {
            action.element.remove();
        } else if (action.type === 'batch-delete') {
            // Re-delete all elements
            action.deletions.forEach(({ element }) => {
                element.remove();
            });
        } else if (action.type === 'resize') {
            action.element.classList.add('mb-resizable');
        } else if (action.type === 'move') {
            action.newParent.appendChild(action.element);

            action.element.style.top = action.newStyle.top;
            action.element.style.left = action.newStyle.left;
            action.element.style.position = action.newStyle.position;
        } else if (action.type === 'add') {
            action.parent.appendChild(action.element);
        }
        this.syncFilterState();
    }

    executeDelete() {
        if (this.deleteSelection.size === 0) return;

        // Create batch undo action for all deletions
        const deletions = [];
        this.deleteSelection.forEach(el => {
            const parent = el.parentElement;
            const nextSibling = el.nextElementSibling;
            deletions.push({ element: el, parent, nextSibling });
        });

        // Push batch to undo stack
        this.pushToUndo({ type: 'batch-delete', deletions });

        // Remove all selected elements
        this.deleteSelection.forEach(el => {
            el.classList.remove('mb-delete-selected');
            el.remove();
        });

        // Clear selection
        this.deleteSelection.clear();

        // Hide delete button
        const deleteBtn = document.getElementById('mb-btn-execute-delete');
        if (deleteBtn) deleteBtn.style.display = 'none';

        this.updateStatus(`Deleted ${deletions.length} element(s)`, true);
        this.syncFilterState();
    }

    pickAdditionalElement() {
        // Temporarily show original body to pick from it
        this.originalBody.style.display = 'block';
        this.filterContainer.style.display = 'none';

        this.enablePicker();

        // Inject Floating "Done" Button
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
             // Only add if we have a target
            if (this.targetElement) {
                const clone = this.freezeStyles(this.targetElement);

                // Position in center of canvas view
                // Viewport Center X = -CanvasX + (ScreenWidth / 2)
                const centerX = (-this.canvasState.x + window.innerWidth / 2) / this.canvasState.scale;
                const centerY = (-this.canvasState.y + window.innerHeight / 2) / this.canvasState.scale;

                clone.style.position = 'absolute';
                clone.style.left = centerX + 'px';
                clone.style.top = centerY + 'px';

                this.canvasWorld.appendChild(clone);
                this.pushToUndo({ type: 'add', element: clone, parent: this.canvasWorld });
            }

            // Cleanup
            this.disablePicker(true);
            if (this.originalBody) this.originalBody.style.display = 'none';
            if (this.filterContainer) this.filterContainer.style.display = 'block';
            this.syncFilterState();
        };

        doneBtn.addEventListener('click', finishSelection);
    }

    syncFilterState() {
        chrome.runtime.sendMessage({
            action: 'UPDATE_FILTER_STATE',
            state: {
                mode: this.editMode,
                canUndo: this.undoStack.length > 0,
                canRedo: this.redoStack.length > 0
            }
        });
    }

    async saveFinal(onlySelection = false) {
        this.updateStatus('Preparing export... Embedding images...', true);

        let exportArea;

        // If selection mode, override bounds to only cover selected elements
        if (onlySelection && this.exportSelection.size > 0) {
            let sL = Infinity, sT = Infinity, sR = -Infinity, sB = -Infinity;
            this.exportSelection.forEach(el => {
                const r = { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
                sL = Math.min(sL, r.l);
                sT = Math.min(sT, r.t);
                sR = Math.max(sR, r.l + r.w);
                sB = Math.max(sB, r.t + r.h);
            });
            exportArea = { left: sL, top: sT, width: sR - sL, height: sB - sT };
        } else {
           exportArea = this.cropState.rect || this.calculateWorldBounds();
        }

        // Deep Clone the World
        const finalWorld = this.canvasWorld.cloneNode(true);

        // Cleanup UI markers from clone
        finalWorld.querySelectorAll('.mb-hover-delete, .mb-hover-move, .mb-hover-resize, .mb-dragging, .mb-resizable, .mb-crop-overlay, .mb-export-selected').forEach(el => {
            el.remove();
        });

        // Filter elements in clone if onlySelection is true
        if (onlySelection) {
            const originalSelection = Array.from(this.exportSelection);
            originalSelection.forEach(el => el.setAttribute('data-mb-export', 'true'));

            const selectionWorld = this.canvasWorld.cloneNode(true);
            originalSelection.forEach(el => el.removeAttribute('data-mb-export'));

            const keepNodes = [];
            const collect = (node) => {
                if (node.nodeType === 1 && node.getAttribute('data-mb-export')) {
                    keepNodes.push(node);
                }
                Array.from(node.children || []).forEach(collect);
            };
            collect(selectionWorld);

            finalWorld.innerHTML = '';
            keepNodes.forEach(node => {
                node.removeAttribute('data-mb-export');
                finalWorld.appendChild(node);
            });
        }

        // Remove selection highlights from any remaining elements (not strictly needed if we cleared finalWorld but good for safety)
        finalWorld.querySelectorAll('.mb-selected-export').forEach(el => el.classList.remove('mb-selected-export'));

        // Wrapper for absolute positioning
        const wrapper = document.createElement('div');
        wrapper.style = `
            position: relative;
            width: ${exportArea.width}px;
            height: ${exportArea.height}px;
            background: white;
            overflow: hidden;
            margin: 0 auto;
            box-shadow: 0 0 50px rgba(0,0,0,0.1);
        `;

        // Adjust for crop offset
        const content = document.createElement('div');
        content.style = `position: absolute; left: ${-exportArea.left}px; top: ${-exportArea.top}px; width: 100%; height: 100%;`;

        // Append elements
        Array.from(finalWorld.children).forEach(child => {
            content.appendChild(child);
        });
        wrapper.appendChild(content);

        // --- IMAGE EMBEDDING (Base64) ---
        const processNode = async (node) => {
            if (node.nodeType === 1) { // Element
                // Handle IFRAME Security - Prevent sandbox escape vulnerability
                if (node.tagName === 'IFRAME') {
                    this.sanitizeIframe(node);
                }

                // Handle images
                if (node.tagName === 'IMG' && (node.src.startsWith('blob:') || node.src.startsWith('http'))) {
                    try {
                        const b64 = await this.urlToBase64(node.src);
                        if (b64) node.src = b64;
                    } catch (e) {}
                }

                // Handle backgrounds
                const bg = node.style?.backgroundImage;
                if (bg && (bg.includes('blob:') || bg.includes('http'))) {
                    const urlMatch = bg.match(/url\(["']?([^"']+)["']?\)/);
                    if (urlMatch) {
                        try {
                            const b64 = await this.urlToBase64(urlMatch[1]);
                            if (b64) node.style.backgroundImage = `url("${b64}")`;
                        } catch (e) {}
                    }
                }
            }
            if (node.children) {
                await Promise.all(Array.from(node.children).map(child => processNode(child)));
            }
        };

        await processNode(wrapper);

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Universal Element Export</title>
    <style>
        body { margin: 0; padding: 40px; background: #f0f0f0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; font-family: system-ui, sans-serif; }
    </style>
</head>
<body>
    ${wrapper.outerHTML}
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; width: 100%; max-width: 600px; text-align: center; color: #666; font-weight: bold;">
        This is the Universal Element Cloner by Matthew Bubb
    </div>
</body>
</html>`;

        this.downloadFile(html, `universal-export-${Date.now()}.html`);
        this.updateStatus('Export complete!', false);
    }

    // --- CROPPING METHODS ---
    _startCropping(e) {
        if (e.target !== this.canvasWorld && e.target !== this.filterContainer) return;

        this.cropState.active = true;
        const worldX = (e.clientX - this.canvasState.x) / this.canvasState.scale;
        const worldY = (e.clientY - this.canvasState.y) / this.canvasState.scale;

        this.cropState.startX = worldX;
        this.cropState.startY = worldY;

        if (!this.cropOverlay) {
            this.cropOverlay = document.createElement('div');
            this.cropOverlay.className = 'mb-crop-overlay';
            this.cropOverlay.style = 'position: absolute; border: 2px dashed #ff00ff; background: rgba(255, 0, 255, 0.1); pointer-events: none; z-index: 10000;';
            this.canvasWorld.appendChild(this.cropOverlay);
        }
    }

    _updateCrop(e) {
        if (!this.cropState.active) return;
        const worldX = (e.clientX - this.canvasState.x) / this.canvasState.scale;
        const worldY = (e.clientY - this.canvasState.y) / this.canvasState.scale;
        const x = Math.min(worldX, this.cropState.startX);
        const y = Math.min(worldY, this.cropState.startY);
        const w = Math.abs(worldX - this.cropState.startX);
        const h = Math.abs(worldY - this.cropState.startY);
        this.cropOverlay.style.left = x + 'px';
        this.cropOverlay.style.top = y + 'px';
        this.cropOverlay.style.width = w + 'px';
        this.cropOverlay.style.height = h + 'px';
        this.cropState.rect = { left: x, top: y, width: w, height: h };
    }

    _endCropping() {
        if (this.cropState.active) {
            this.cropState.active = false;
            if (this.cropState.rect && this.cropState.rect.width > 20 && this.cropState.rect.height > 20) {
                this.zoomToRect(this.cropState.rect);
                this.updateStatus(`Zoomed to crop. The background has fallen away. Ready to export.`, true);
            }
        }
    }

    zoomToRect(rect) {
        if (!rect) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scale = Math.min((vw * 0.95) / rect.width, (vh * 0.95) / rect.height, 2);

        this.filterContainer.classList.add('fall-away');
        this.canvasWorld.style.transition = 'transform 0.6s cubic-bezier(0.19, 1, 0.22, 1)';
        this.canvasState.scale = scale;
        this.canvasState.x = (vw / 2) - (rect.left + rect.width / 2) * scale;
        this.canvasState.y = (vh / 2) - (rect.top + rect.height / 2) * scale;
        this.updateCanvasTransform();

        setTimeout(() => {
            this.canvasWorld.style.transition = '';
        }, 600);
    }

    async exportSelectedElements() {
        if (this.multiCaptureQueue.length === 0) {
            this.updateStatus("No elements selected for export.", false);
            return;
        }

        this.updateStatus("Preparing direct element export...", true);

        const fragments = this.multiCaptureQueue.map(el => this.freezeStyles(el));
        const wrapper = document.createElement('div');
        wrapper.style = "display: flex; flex-direction: column; gap: 40px; padding: 60px; background: white; max-width: 1200px; margin: 0 auto; box-shadow: 0 10px 40px rgba(0,0,0,0.1); border-radius: 12px;";

        fragments.forEach(f => {
            // Sanitize any iframes in this fragment
            f.querySelectorAll('iframe').forEach(iframe => {
                this.sanitizeIframe(iframe);
            });
            wrapper.appendChild(f);
        });

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Universal Element Export</title>
    <style>
        body { margin: 0; padding: 40px; background: #f8f9fa; min-height: 100vh; font-family: -apple-system, system-ui, sans-serif; }
        .branding { margin-top: 60px; padding-top: 30px; border-top: 1px solid #eee; text-align: center; color: #888; font-weight: 600; letter-spacing: 0.5px; }
    </style>
</head>
<body>
    ${wrapper.outerHTML}
    <div class="branding">This is the Universal Element Cloner by Matthew Bubb</div>
</body>
</html>`;

        this.downloadFile(html, `element-export-${Date.now()}.html`);
        this.updateStatus("Export complete!", false);

        // Reset and return
        this.multiCaptureQueue = [];
        this.disablePicker(true);
    }

    // --- IFRAME SANITIZATION (SECURITY) ---
    sanitizeIframe(node) {
        if (!node || node.tagName !== 'IFRAME') return;

        if (node.hasAttribute('sandbox')) {
            let sandbox = node.getAttribute('sandbox');
            // If both allow-scripts and allow-same-origin are present, remove allow-scripts
            // This combination allows the iframe to remove its own sandbox via JS
            if (sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin')) {
                // Remove allow-scripts and clean up extra whitespace
                sandbox = sandbox.split(/\s+/)
                    .filter(val => val !== 'allow-scripts')
                    .join(' ')
                    .trim();
                node.setAttribute('sandbox', sandbox);
                console.log('Sanitized iframe sandbox to prevent security error: removed allow-scripts.');
            }
        } else {
            // If no sandbox attribute, add a restrictive one
            node.setAttribute('sandbox', 'allow-same-origin');
            console.log('Sanitized iframe: added allow-same-origin sandbox attribute.');
        }
    }

    async urlToBase64(url) {
        if (url.startsWith('data:')) return url;
        try {
            const response = await chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url });
            if (chrome.runtime.lastError) {
                // Suppress error
                return null;
            }
            if (response && response.success) {
                return response.data;
            }
            return null;
        } catch (e) { return null; }
    }

    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }

    exitFilterMode() {
        if (this.filterContainer) this.filterContainer.remove();
        if (this.originalBody) this.originalBody.style.display = 'block';
        const styles = document.getElementById('mb-filter-styles');
        if (styles) styles.remove();
        this.isFiltering = false;
        this.filterContainer = null;
        this.undoStack = [];
        this.redoStack = [];
    }
}

// Initialize
const scraper = new UniversalScraper();

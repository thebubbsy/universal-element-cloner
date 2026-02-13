class DomScraper {
    constructor(assetCache) {
        this.scraping = false;
        this.targetElement = null;
        this.capturedItems = [];
        this.pendingElements = [];
        this.seenHashes = new Set();
        this.assetCache = assetCache;
        this.direction = 'down';
        this.scrapingSpeed = 0;
        this.observer = null;

        this.isScanning = false;
        this.scanOverlay = null;
        this._scrapeStartTime = 0;

        this.scrollVelocity = 0;
        this.lastScrollY = 0;
        this.lastScrollTime = 0;
        this.revealLineY = 0;
    }

    async start(targetElement, speed, direction) {
        this.targetElement = targetElement || document.body;
        if (!this.targetElement) {
             ScraperUtils.updateStatus("No target picked. Auto-scrolling full page.", false);
        }

        this.scraping = true;
        this.direction = direction || 'down';
        this.scrapingSpeed = speed;
        this.capturedItems = [];
        this.seenHashes.clear();
        this._scrapeStartTime = Date.now();

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

        ScraperUtils.updateStatus("Scraping started...", true);
        this.startScanning();
        this.startAnimationLoop();
        this.captureLoop(speed);
    }

    stop() {
        this.scraping = false;
        if (this.observer) this.observer.disconnect();
        this.stopScanning();
        ScraperUtils.updateStatus(`Collected ${this.capturedItems.length} items. Open Editor to proceed.`, false);
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
        const hash = ScraperUtils.generateHash(el);
        if (this.seenHashes.has(hash)) return;
        this.seenHashes.add(hash);

        // High Fidelity Clone
        const clone = ScraperUtils.freezeElement(el, this.assetCache);

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

        let targetY;
        if (this.direction === 'up') {
            targetY = viewportBottom;
            if (this.scrollVelocity < -0.2) { // Scrolling UP quickly
                const lag = window.innerHeight * 0.25;
                targetY = viewportBottom + lag;
            }
            this.revealLineY = Math.min(this.revealLineY, targetY);
            this.revealLineY -= 8; // Crawl up speed
        } else {
            targetY = viewportTop;
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
}
window.DomScraper = DomScraper;

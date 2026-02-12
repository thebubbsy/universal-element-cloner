class ElementPicker {
    constructor() {
        this.active = false;
        this.mode = 'single'; // 'single' or 'multi'
        this.multiCaptureQueue = [];
        this.targetElement = null;
        this.highlightedElement = null;
        this.highlightedDepthElement = null;
        this.depthStack = [];
        this.depthIndex = 0;

        // Bind handlers
        this._hoverHandler = this._handleHover.bind(this);
        this._clickHandler = this._handleClick.bind(this);
        this._wheelHandler = this._handleWheel.bind(this);
    }

    enable(mode = 'single') {
        this.mode = mode;
        this.active = true;
        // Note: multiCaptureQueue is not cleared here to allow picking additional elements

        document.addEventListener('mouseover', this._hoverHandler, true);
        document.addEventListener('click', this._clickHandler, true);
        document.addEventListener('wheel', this._wheelHandler, { passive: false });

        this._injectStyles();

        const statusMsg = mode === 'multi'
            ? "Click elements to add to Multi-Capture (Shift+Scroll to cycle depth)"
            : "Click to select and Edit (Shift+Scroll to cycle depth)";
        ScraperUtils.updateStatus(statusMsg, true);
    }

    disable(clean = true) {
        this.active = false;
        document.removeEventListener('mouseover', this._hoverHandler, true);
        document.removeEventListener('click', this._clickHandler, true);
        document.removeEventListener('wheel', this._wheelHandler, { passive: false });

        if (this.highlightedDepthElement) {
            this.highlightedDepthElement.classList.remove('mb-highlight');
            this.highlightedDepthElement = null;
        }

        if (clean) {
            document.querySelectorAll('.mb-highlight, .mb-selected').forEach(el => {
                el.classList.remove('mb-highlight', 'mb-selected');
            });
            this.multiCaptureQueue = [];
            this.targetElement = null;
        }
    }

    _injectStyles() {
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

    _handleHover(e) {
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
        this.highlightedDepthElement = el; // Ensure consistency
    }

    _handleClick(e) {
        // IGNORE OWN UI (Let default click happen)
        if (e.target.id === 'mb-picker-done' || e.target.closest('#mb-canvas-toolbar') || e.target.closest('#mb-canvas-minimap')) return;

        e.preventDefault();
        e.stopPropagation();

        // Use current cycled element if shift-scrolled
        const target = (this.highlightedDepthElement && this.active) ? this.highlightedDepthElement : e.target;

        // Toggle highlight on live element
        if (target.classList.contains('mb-selected')) {
            target.classList.remove('mb-selected');
            this.multiCaptureQueue = this.multiCaptureQueue.filter(entry => entry !== target);
            if (this.targetElement === target) this.targetElement = this.multiCaptureQueue[this.multiCaptureQueue.length - 1] || null;
        } else {
            target.classList.add('mb-selected');
            this.multiCaptureQueue.push(target);
            this.targetElement = target;
        }

        ScraperUtils.updateStatus(`Selected ${this.multiCaptureQueue.length} elements. Ready to Scrape or Finish.`, true);
    }

    _handleWheel(e) {
        if (!e.shiftKey) return; // Only handle Shift+Scroll for depth cycling

        e.preventDefault();
        e.stopPropagation();

        if (this.depthStack && this.depthStack.length > 1) {
            if (e.deltaY > 0) this.depthIndex = (this.depthIndex + 1) % this.depthStack.length;
            else this.depthIndex = (this.depthIndex - 1 + this.depthStack.length) % this.depthStack.length;

            // Remove previous
             if (this.highlightedDepthElement) this.highlightedDepthElement.classList.remove('mb-highlight');

            this.highlightedDepthElement = this.depthStack[this.depthIndex];
             if (this.highlightedDepthElement) {
                this.highlightedDepthElement.classList.add('mb-highlight');
                ScraperUtils.updateStatus(`Depth: ${this.depthIndex + 1}/${this.depthStack.length} (<${this.highlightedDepthElement.tagName.toLowerCase()}>) - Shift+Scroll to cycle`, true);
            }
        }
    }
}
window.ElementPicker = ElementPicker;

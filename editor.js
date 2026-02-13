class EditorUI {
    constructor(callbacks) {
        this.callbacks = callbacks || {}; // { onSave, onPickMore, onExit }
        this.isFiltering = false;
        this.filterContainer = null;
        this.canvasWorld = null;
        this.canvasPaper = null;
        this.toolbar = null;
        this.minimap = null;
        this.minimapView = null;

        this.canvasState = {
            x: 0, y: 0, scale: 1, isPanning: false, startX: 0, startY: 0
        };
        this.cropState = {
            active: false, startX: 0, startY: 0, rect: null
        };
        this.editMode = 'none'; // 'none', 'move', 'crop', 'export-pick', 'delete'
        this.undoStack = [];
        this.redoStack = [];
        this.exportSelection = new Set();
        this.deleteSelection = new Set();

        this._savedScroll = { x: 0, y: 0 };
        this.originalBody = null;

        // Bindings
        this._filterHover = this._handleFilterHover.bind(this);
        this._filterOut = this._handleFilterOut.bind(this);
        this._filterClick = this._handleFilterClick.bind(this);
        this._filterDown = this._handleFilterDown.bind(this);
        this._filterMove = this._handleFilterMove.bind(this);
        this._filterUp = this._handleFilterUp.bind(this);
        this._filterWheel = this._handleFilterWheel.bind(this);
    }

    open(clone) {
        if (this.filterContainer) return;

        this.isFiltering = true;
        this.originalBody = document.body;

        this._savedScroll = { x: window.scrollX, y: window.scrollY };

        if (this.originalBody) {
             this.originalBody.style.display = 'none';
        }

        this.filterContainer = document.createElement('div');
        this.filterContainer.id = 'mb-canvas-viewport';
        this.filterContainer.style = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: #121212; z-index: 2000000; overflow: hidden;
            font-family: inherit; cursor: grab; user-select: none;
            background-image: radial-gradient(#333 1px, transparent 1px);
            background-size: 30px 30px;
        `;

        this.canvasWorld = document.createElement('div');
        this.canvasWorld.id = 'mb-canvas-world';
        this.canvasWorld.style = `
            position: absolute; top: 0; left: 0;
            width: 10000px; height: 10000px;
            transform-origin: 0 0;
            will-change: transform;
        `;

        this.canvasPaper = document.createElement('div');
        this.canvasPaper.id = 'mb-canvas-paper';
        this.canvasPaper.style = `
            position: absolute; background: white;
            box-shadow: 0 0 100px rgba(0,0,0,0.5);
            pointer-events: none;
        `;
        this.canvasWorld.appendChild(this.canvasPaper);

        this.canvasWorld.appendChild(clone);
        this.filterContainer.appendChild(this.canvasWorld);

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
        this.filterContainer.appendChild(this.toolbar);

        this.minimap = document.createElement('div');
        this.minimap.id = 'mb-canvas-minimap';
        this.minimap.style = `
            position: absolute; bottom: 20px; right: 20px;
            width: 200px; height: 150px; background: rgba(0,0,0,0.5);
            border: 1px solid #444; border-radius: 4px; overflow: hidden;
            pointer-events: auto; z-index: 2000001;
        `;
        this.minimapView = document.createElement('div');
        this.minimapView.id = 'mb-minimap-view';
        this.minimapView.style = `
            position: absolute; border: 1px solid cyan; background: rgba(0, 255, 255, 0.1);
            pointer-events: none;
        `;
        this.minimap.appendChild(this.minimapView);
        this.filterContainer.appendChild(this.minimap);

        

        document.body.appendChild(this.filterContainer);

        this.calculateWorldBounds();
        this.fitToScreen();
        this.initEventListeners();

        ScraperUtils.updateStatus('Editor Opened. Use toolbar to Refine, Crop, or Export.', true);
    }

    initEventListeners() {
        this.canvasWorld.addEventListener('mouseover', this._filterHover, true);
        this.canvasWorld.addEventListener('mouseout', this._filterOut, true);
        this.canvasWorld.addEventListener('click', this._filterClick, true);
        this.canvasWorld.addEventListener('mousedown', (e) => {
            if (this.editMode === 'crop') this._startCropping(e);
            else this._filterDown(e);
        });
        window.addEventListener('mousemove', (e) => {
            if (this.editMode === 'crop') this._updateCrop(e);
            else if (this.canvasState.isPanning) this._filterMove(e);
        });
        window.addEventListener('mouseup', (e) => {
            if (this.editMode === 'crop') this._endCropping(e);
            else if (this.canvasState.isPanning) this._filterUp(e);
        });
        this.canvasWorld.addEventListener('wheel', this._filterWheel, { passive: false });

        document.getElementById('mb-tool-pan').addEventListener('click', () => { this.editMode = 'none'; this._updateToolState(); });
        document.getElementById('mb-tool-select').addEventListener('click', () => { this.editMode = 'move'; this._updateToolState(); });
        document.getElementById('mb-tool-crop').addEventListener('click', () => {
            this.editMode = 'crop';
            this.fitToScreen();
            this._updateToolState();
            ScraperUtils.updateStatus("Click and drag on the canvas to define your export area.", true);
        });
        document.getElementById('mb-tool-export-pick').addEventListener('click', () => {
            this.editMode = 'export-pick';
            this._updateToolState();
            ScraperUtils.updateStatus("Select elements one by one to export them together.", true);
        });
        document.getElementById('mb-btn-zoom-in').addEventListener('click', () => this.setZoom(this.canvasState.scale + 0.1));
        document.getElementById('mb-btn-zoom-out').addEventListener('click', () => this.setZoom(this.canvasState.scale - 0.1));
        document.getElementById('mb-btn-fit').addEventListener('click', () => this.fitToScreen());
        document.getElementById('mb-btn-add').addEventListener('click', () => {
             if (this.callbacks.onPickMore) this.callbacks.onPickMore();
        });
        document.getElementById('mb-btn-execute-delete').addEventListener('click', () => this.executeDelete());
        document.getElementById('mb-btn-export-selection').addEventListener('click', () => {
             if (this.callbacks.onSave) this.callbacks.onSave(true);
        });
        document.getElementById('mb-btn-export').addEventListener('click', () => {
             if (this.callbacks.onSave) this.callbacks.onSave(false);
        });
        document.getElementById('mb-btn-close').addEventListener('click', () => this.exitFilterMode());
    }

    setZoom(newScale) {
        newScale = Math.max(0.1, Math.min(5, newScale));
        this.canvasState.scale = newScale;
        this.updateCanvasTransform();
        document.getElementById('mb-zoom-level').innerText = Math.round(newScale * 100) + '%';
    }

    fitToScreen() {
        const bounds = this.calculateWorldBounds();
        if (!bounds || bounds.width === 0) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const padding = 100;

        const scale = Math.min((vw - padding) / bounds.width, (vh - padding) / bounds.height, 1);
        this.canvasState.scale = scale;
        this.canvasState.x = (vw / 2) - (bounds.width / 2) * scale;
        this.canvasState.y = (vh / 2) - (bounds.height / 2) * scale;

        this.updateCanvasTransform();
    }

    _updateToolState() {
        document.querySelectorAll('.mb-tool-btn').forEach(b => b.classList.remove('active'));
        if (this.editMode === 'none') document.getElementById('mb-tool-pan').classList.add('active');
        if (this.editMode === 'move') document.getElementById('mb-tool-select').classList.add('active');
        if (this.editMode === 'crop') document.getElementById('mb-tool-crop').classList.add('active');
        if (this.editMode === 'export-pick') document.getElementById('mb-tool-export-pick').classList.add('active');

        this.filterContainer.style.cursor = this.editMode === 'none' ? 'grab' : 'default';

        const delBtn = document.getElementById('mb-btn-execute-delete');
        if (delBtn) delBtn.style.display = this.deleteSelection.size > 0 ? 'flex' : 'none';

        const expSelBtn = document.getElementById('mb-btn-export-selection');
        if (expSelBtn) expSelBtn.style.display = 'none';

        if (this.editMode === 'export-pick' && this.exportSelection.size > 0) {
            if (expSelBtn) expSelBtn.style.display = 'flex';
        }
    }

    updateCanvasTransform() {
        if (!this.canvasWorld) return;
        this.canvasWorld.style.transform = `translate3d(${this.canvasState.x}px, ${this.canvasState.y}px, 0) scale(${this.canvasState.scale})`;
        this.updateMinimap();
    }

    calculateWorldBounds() {
        if (!this.canvasWorld) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasChildren = false;

        Array.from(this.canvasWorld.children).forEach(child => {
            if (child.id === 'mb-canvas-paper' || child.classList.contains('mb-crop-overlay')) return;
            hasChildren = true;
            const r = { left: child.offsetLeft, top: child.offsetTop, width: child.offsetWidth, height: child.offsetHeight };
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.left + r.width);
            maxY = Math.max(maxY, r.top + r.height);
        });

        if (!hasChildren) return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };

        const width = maxX - minX;
        const height = maxY - minY;

        if (this.canvasPaper) {
            this.canvasPaper.style.left = (minX - 50) + 'px';
            this.canvasPaper.style.top = (minY - 50) + 'px';
            this.canvasPaper.style.width = (width + 100) + 'px';
            this.canvasPaper.style.height = (height + 100) + 'px';
        }

        return { width: width + 100, height: height + 100, left: minX - 50, top: minY - 50, right: maxX + 50, bottom: maxY + 50 };
    }

    updateMinimap() {
        // Implementation omitted for brevity but placeholder here
    }

    _handleFilterHover(e) {
        if (this.editMode === 'none' || this.editMode === 'crop') return;
        const el = e.target;
        if (el === this.canvasWorld || el === this.canvasPaper || el.closest('#mb-canvas-toolbar')) return;

        let cls = 'mb-hover-move';
        if (this.editMode === 'export-pick') cls = 'mb-selected-export';
        else if (this.editMode === 'move') cls = 'mb-hover-move';
        // Logic for highlighting...
        el.classList.add(cls);
    }

    _handleFilterOut(e) {
         if (e.target) {
             e.target.classList.remove('mb-hover-move', 'mb-hover-delete', 'mb-hover-resize', 'mb-selected-export');
             if (this.editMode === 'export-pick' && this.exportSelection.has(e.target)) {
                 e.target.classList.add('mb-selected-export');
             }
         }
    }

    _handleFilterClick(e) {
        const el = e.target;
        if (this.editMode === 'export-pick') {
            e.stopPropagation();
            e.preventDefault();
            if (this.exportSelection.has(el)) {
                this.exportSelection.delete(el);
                el.classList.remove('mb-selected-export');
            } else {
                this.exportSelection.add(el);
                el.classList.add('mb-selected-export');
            }
            this._updateToolState();
        } else if (this.editMode === 'move') {
            // Select for delete/move?
             e.stopPropagation();
             e.preventDefault();
             if (this.deleteSelection.has(el)) {
                 this.deleteSelection.delete(el);
                 el.classList.remove('mb-delete-selected');
             } else {
                 this.deleteSelection.add(el);
                 el.classList.add('mb-delete-selected');
             }
             this._updateToolState();
        }
    }

    _handleFilterDown(e) {
         if (this.editMode === 'none') {
             this.canvasState.isPanning = true;
             this.canvasState.startX = e.clientX - this.canvasState.x;
             this.canvasState.startY = e.clientY - this.canvasState.y;
             this.filterContainer.style.cursor = 'grabbing';
         }
    }

    _handleFilterMove(e) {
        if (this.canvasState.isPanning) {
            this.canvasState.x = e.clientX - this.canvasState.startX;
            this.canvasState.y = e.clientY - this.canvasState.startY;
            this.updateCanvasTransform();
        }
    }

    _handleFilterUp(e) {
        this.canvasState.isPanning = false;
        this.filterContainer.style.cursor = 'grab';
    }

    _handleFilterWheel(e) {
        e.preventDefault();
        const zoomIntensity = 0.001;
        const newScale = this.canvasState.scale + (-e.deltaY * zoomIntensity);
        this.setZoom(newScale);
    }

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
                ScraperUtils.updateStatus('Zoomed to crop. The background has fallen away. Ready to export.', true);
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

    executeDelete() {
        if (this.deleteSelection.size === 0) return;

        this.deleteSelection.forEach(el => {
            el.classList.remove('mb-delete-selected');
            el.remove();
        });

        this.deleteSelection.clear();
        this._updateToolState();
        ScraperUtils.updateStatus('Deleted elements', true);
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

        window.scrollTo(this._savedScroll.x, this._savedScroll.y);

        if (this.callbacks.onExit) this.callbacks.onExit();
    }

    async prepareExport(onlySelection = false) {
        ScraperUtils.updateStatus('Preparing export... Embedding images...', true);

        let exportArea;

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

        const finalWorldClone = this.canvasWorld.cloneNode(true);

        // Mark selection in clone (via attribute since it's a clone of canvasWorld where selection is marked via sets)
        // Wait, I can't map Set elements to Clone elements easily.
        // I need to mark them BEFORE cloning.
        // BUT I cannot modify canvasWorld state permanently.
        // So:
        if (onlySelection) {
             this.exportSelection.forEach(el => el.setAttribute('data-mb-export', 'true'));
        }

        const cloneWithMarks = this.canvasWorld.cloneNode(true);

        if (onlySelection) {
             this.exportSelection.forEach(el => el.removeAttribute('data-mb-export'));
        }

        // Clean clone
        cloneWithMarks.querySelectorAll('.mb-crop-overlay').forEach(el => el.remove());
        const classesToRemove = ['mb-hover-delete', 'mb-hover-move', 'mb-hover-resize', 'mb-dragging', 'mb-resizable', 'mb-export-selected', 'mb-delete-selected'];
        classesToRemove.forEach(cls => {
            cloneWithMarks.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
        });

        // Filter
        const finalContent = document.createDocumentFragment();

        if (onlySelection) {
             const keepNodes = [];
             const collect = (node) => {
                if (node.nodeType === 1 && node.getAttribute('data-mb-export')) {
                    keepNodes.push(node);
                }
                Array.from(node.children || []).forEach(collect);
            };
            collect(cloneWithMarks);

            keepNodes.forEach(node => {
                node.removeAttribute('data-mb-export');
                finalContent.appendChild(node);
            });
        } else {
            Array.from(cloneWithMarks.children).forEach(child => {
                 if (child.id !== 'mb-canvas-paper') finalContent.appendChild(child);
            });
        }

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

        const content = document.createElement('div');
        content.style = `position: absolute; left: ${-exportArea.left}px; top: ${-exportArea.top}px; width: 100%; height: 100%;`;
        content.appendChild(finalContent);
        wrapper.appendChild(content);

        const processNode = async (node) => {
            if (node.nodeType === 1) {
                if (node.tagName === 'IFRAME') {
                    ScraperUtils.sanitizeIframe(node);
                }
                if (node.tagName === 'IMG' && (node.src.startsWith('blob:') || node.src.startsWith('http'))) {
                    try {
                        const b64 = await ScraperUtils.urlToBase64(node.src);
                        if (b64) node.src = b64;
                    } catch (e) {}
                }
                const bg = node.style?.backgroundImage;
                if (bg && (bg.includes('blob:') || bg.includes('http'))) {
                    const urlMatch = bg.match(/url\(["']?([^"']+)["']?\)/);
                    if (urlMatch) {
                        try {
                            const b64 = await ScraperUtils.urlToBase64(urlMatch[1]);
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
        return wrapper.outerHTML;
    }
}
window.EditorUI = EditorUI;

class ScraperUtils {
    static generateHash(el) {
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

    static sanitizeIframe(node) {
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

    static async urlToBase64(url) {
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

    static downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }

    static updateStatus(text, active) {
        chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', text, active });
    }

    static freezeElement(el, assetCache) {
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

        const processImage = (target, source) => {
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
                    if (assetCache && assetCache.has(url)) {
                        setter(assetCache.get(url));
                        return;
                    }

                    const b64 = await ScraperUtils.urlToBase64(url);
                    if (b64) {
                        if (assetCache) assetCache.set(url, b64);
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
}
window.ScraperUtils = ScraperUtils;

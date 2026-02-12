class ContentExporter {
    constructor() {
        this.isGuidedMode = false;
        this.scrollables = [];
        this.scrollListeners = [];
        this.direction = 'down';
    }

    exportResults(capturedItems) {
        const uniqueItems = [];
        const seen = new Set();

        capturedItems.forEach(item => {
            if (!seen.has(item.hash)) {
                seen.add(item.hash);
                uniqueItems.push(item.html);
            }
        });

        const html = this.assembleExport(uniqueItems.join('\n'));
        ScraperUtils.downloadFile(html, `universal-export-${Date.now()}.html`);
    }

    assembleExport(content) {
        // Create a temporary container to process the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        // Sanitize all iframes in the content
        tempDiv.querySelectorAll('iframe').forEach(iframe => {
            ScraperUtils.sanitizeIframe(iframe);
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
}
window.ContentExporter = ContentExporter;

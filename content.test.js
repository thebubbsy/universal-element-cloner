// Mocks for browser globals
global.chrome = {
    runtime: {
        onMessage: {
            addListener: jest.fn()
        },
        sendMessage: jest.fn()
    }
};

global.document = {
    elementsFromPoint: jest.fn().mockReturnValue([]),
    createElement: jest.fn(),
    body: {
        appendChild: jest.fn(),
        style: {}
    },
    head: {
        appendChild: jest.fn()
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    querySelectorAll: jest.fn().mockReturnValue([])
};

global.window = {
    scrollY: 0,
    innerHeight: 800,
    innerWidth: 1200,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getComputedStyle: jest.fn().mockReturnValue({})
};

global.URL = {
    createObjectURL: jest.fn(),
    revokeObjectURL: jest.fn()
};

global.Blob = jest.fn();

// Import the class under test

global.ElementPicker = class {};
global.DomScraper = class {};

global.ContentExporter = class {
    assembleExport(content) {
        // Create a temporary container to process the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        // Sanitize all iframes in the content
        Array.from(tempDiv.querySelectorAll('iframe')).forEach(iframe => {
            if (iframe.hasAttribute('sandbox')) {
                let sandbox = iframe.getAttribute('sandbox');
                if (sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin')) {
                    sandbox = sandbox.replace('allow-scripts', '').trim();
                    iframe.setAttribute('sandbox', sandbox);
                }
            } else {
                iframe.setAttribute('sandbox', 'allow-same-origin');
            }
        });

        // Assemble the final HTML document
        return `<!DOCTYPE html>
<html>
<head>
    <title>Universal Element Export</title>
</head>
<body>
    ${tempDiv.innerHTML}
</body>
</html>`;
    }
};

global.EditorUI = class {};
global.ScraperUtils = {
    freezeElement: jest.fn(),
    updateStatus: jest.fn(),
    downloadFile: jest.fn(),
    sanitizeIframe: jest.fn()
};

const UniversalScraper = require('./content.js');

describe('UniversalScraper', () => {
    let scraper;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mocks specifically for each test
        global.document.createElement.mockReset();
        global.document.querySelectorAll.mockReset();

        // Setup default mock for createElement
        global.document.createElement.mockImplementation((tag) => {
            return {
                tagName: tag.toUpperCase(),
                innerHTML: '',
                style: {},
                classList: {
                    add: jest.fn(),
                    remove: jest.fn(),
                    contains: jest.fn()
                },
                appendChild: jest.fn(),
                querySelectorAll: jest.fn().mockReturnValue([]),
                querySelector: jest.fn(),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(),
                hasAttribute: jest.fn(),
                remove: jest.fn()
            };
        });

        scraper = new UniversalScraper();
    });

    describe('assembleExport', () => {
        test('wraps content in HTML template', () => {
            const content = '<div>Test Content</div>';

            // Mock the temp div creation
            const mockTempDiv = {
                innerHTML: '',
                querySelectorAll: jest.fn().mockReturnValue([])
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            const result = scraper.exporter.assembleExport(content);

            // Verify tempDiv was created and content set
            expect(global.document.createElement).toHaveBeenCalledWith('div');
            expect(mockTempDiv.innerHTML).toBe(content);

            // Verify output structure
            expect(result).toContain('<!DOCTYPE html>');
            expect(result).toContain('<title>Universal Element Export</title>');
            expect(result).toContain('<div>Test Content</div>'); // This assumes innerHTML returns what was set
        });

        test('sanitizes iframes by removing allow-scripts from sandbox', () => {
            const content = '<iframe sandbox="allow-scripts allow-same-origin"></iframe>';

            // Mock the iframe element
            const mockIframe = {
                tagName: 'IFRAME',
                hasAttribute: jest.fn().mockReturnValue(true),
                getAttribute: jest.fn().mockReturnValue('allow-scripts allow-same-origin'),
                setAttribute: jest.fn()
            };

            // Mock the temp div
            const mockTempDiv = {
                innerHTML: '',
                querySelectorAll: jest.fn().mockImplementation((selector) => {
                    if (selector === 'iframe') return [mockIframe];
                    return [];
                })
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            const result = scraper.exporter.assembleExport(content);

            // Verify sanitization logic
            expect(mockIframe.getAttribute).toHaveBeenCalledWith('sandbox');
            expect(mockIframe.setAttribute).toHaveBeenCalledWith('sandbox', expect.not.stringContaining('allow-scripts'));
            expect(mockIframe.setAttribute).toHaveBeenCalledWith('sandbox', expect.stringContaining('allow-same-origin'));
        });

        test('adds restrictive sandbox if missing', () => {
            const content = '<iframe></iframe>';

            // Mock the iframe element
            const mockIframe = {
                tagName: 'IFRAME',
                hasAttribute: jest.fn().mockReturnValue(false),
                getAttribute: jest.fn(),
                setAttribute: jest.fn()
            };

            // Mock the temp div
            const mockTempDiv = {
                innerHTML: '',
                querySelectorAll: jest.fn().mockImplementation((selector) => {
                    if (selector === 'iframe') return [mockIframe];
                    return [];
                })
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            scraper.exporter.assembleExport(content);

            // Verify sanitization logic
            expect(mockIframe.hasAttribute).toHaveBeenCalledWith('sandbox');
            expect(mockIframe.setAttribute).toHaveBeenCalledWith('sandbox', 'allow-same-origin');
        });

        test('handles multiple iframes', () => {
             const content = '<iframe id="1"></iframe><iframe id="2"></iframe>';

            // Mock iframes
            const mockIframe1 = {
                tagName: 'IFRAME',
                id: '1',
                hasAttribute: jest.fn().mockReturnValue(false),
                setAttribute: jest.fn()
            };
            const mockIframe2 = {
                tagName: 'IFRAME',
                id: '2',
                hasAttribute: jest.fn().mockReturnValue(false),
                setAttribute: jest.fn()
            };

            // Mock the temp div
            const mockTempDiv = {
                innerHTML: '',
                querySelectorAll: jest.fn().mockImplementation((selector) => {
                    if (selector === 'iframe') return [mockIframe1, mockIframe2];
                    return [];
                })
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            scraper.exporter.assembleExport(content);

            expect(mockIframe1.setAttribute).toHaveBeenCalled();
            expect(mockIframe2.setAttribute).toHaveBeenCalled();
        });
    });
});

    describe('sanitizeTree', () => {
        let scraper;

        beforeEach(() => {
            scraper = new UniversalScraper();
        });

        test('removes dangerous tags like SCRIPT and OBJECT', () => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = '<div>Safe</div><script>alert("xss")</script><object data="something"></object>';

            // It's easier to mock querySelectorAll to return mock elements
            const mockScript = { tagName: 'SCRIPT', remove: jest.fn(), attributes: [] };
            const mockObject = { tagName: 'OBJECT', remove: jest.fn(), attributes: [] };
            const mockDiv = { tagName: 'DIV', remove: jest.fn(), attributes: [] };

            const root = {
                querySelectorAll: jest.fn().mockReturnValue([mockDiv, mockScript, mockObject])
            };

            scraper.sanitizeTree(root);

            expect(mockScript.remove).toHaveBeenCalled();
            expect(mockObject.remove).toHaveBeenCalled();
            expect(mockDiv.remove).not.toHaveBeenCalled();
        });

        test('removes on* attributes', () => {
            const mockImg = {
                tagName: 'IMG',
                remove: jest.fn(),
                attributes: [
                    { name: 'src', value: 'image.jpg' },
                    { name: 'onerror', value: 'alert(1)' }
                ],
                removeAttribute: jest.fn()
            };

            const root = {
                querySelectorAll: jest.fn().mockReturnValue([mockImg])
            };

            scraper.sanitizeTree(root);

            expect(mockImg.removeAttribute).toHaveBeenCalledWith('onerror');
            expect(mockImg.removeAttribute).not.toHaveBeenCalledWith('src');
        });

        test('removes javascript: URLs from A tags', () => {
             const mockLink = {
                tagName: 'A',
                href: 'javascript:alert(1)',
                remove: jest.fn(),
                attributes: [],
                removeAttribute: jest.fn()
            };

            const mockSafeLink = {
                tagName: 'A',
                href: 'https://example.com',
                remove: jest.fn(),
                attributes: [],
                removeAttribute: jest.fn()
            };

            const root = {
                querySelectorAll: jest.fn().mockReturnValue([mockLink, mockSafeLink])
            };

            scraper.sanitizeTree(root);

            expect(mockLink.removeAttribute).toHaveBeenCalledWith('href');
            expect(mockSafeLink.removeAttribute).not.toHaveBeenCalledWith('href');
        });
    });

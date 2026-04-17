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


global.DOMParser = class {
    parseFromString(str, type) {
        const mockDoc = global.document.createElement('div');
        mockDoc.innerHTML = str;
        // In our tests, tempDiv.querySelectorAll is mocked per test.
        // We should instead pass the innerHTML correctly to mockTempDiv.
        return {
            body: {
                childNodes: [mockDoc]
            }
        };
    }
};

global.ScraperUtils = {
    sanitizeIframe: function(node) {
        if (!node || node.tagName !== 'IFRAME') return;
        if (node.hasAttribute('sandbox')) {
            let sandbox = node.getAttribute('sandbox');
            if (sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin')) {
                sandbox = sandbox.split(/\s+/).filter(val => val !== 'allow-scripts').join(' ').trim();
                node.setAttribute('sandbox', sandbox);
            }
        } else {
            node.setAttribute('sandbox', 'allow-same-origin');
        }
    },
    downloadFile: jest.fn()
};


// Import the class under test
const ContentExporter = require('./exporter.js');

describe('ContentExporter', () => {
    let exporter;

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

        exporter = new ContentExporter();
    });

    describe('assembleExport', () => {
        test('wraps content in HTML template', () => {
            const content = '<div>Test Content</div>';

            // Mock the temp div creation
            const mockTempDiv = {
                innerHTML: '',
                appendChild: function(node) {
                    this.innerHTML += (node.innerHTML || "");
                    // Also merge querySelectorAll results
                    if (!this._children) this._children = [];
                    if (node.querySelectorAll) this._children.push(...node.querySelectorAll('iframe'));
                },
                querySelectorAll: jest.fn().mockReturnValue([])
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            const result = exporter.assembleExport(content);

            // Verify tempDiv was created and content set
            expect(global.document.createElement).toHaveBeenCalledWith('div');
            // The first time mockTempDiv is created, its innerHTML gets content.
            // The actual test verifies if result contains the content.
            expect(result).toContain('<div>Test Content</div>');

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
                appendChild: function(node) {
                    this.innerHTML += (node.innerHTML || "");
                    // Also merge querySelectorAll results
                    if (!this._children) this._children = [];
                    if (node.querySelectorAll) this._children.push(...node.querySelectorAll('iframe'));
                },
                querySelectorAll: jest.fn().mockImplementation((selector) => {
                    if (selector === 'iframe') return [mockIframe];
                    return [];
                })
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            const result = exporter.assembleExport(content);

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
                appendChild: function(node) {
                    this.innerHTML += (node.innerHTML || "");
                    // Also merge querySelectorAll results
                    if (!this._children) this._children = [];
                    if (node.querySelectorAll) this._children.push(...node.querySelectorAll('iframe'));
                },
                querySelectorAll: jest.fn().mockImplementation((selector) => {
                    if (selector === 'iframe') return [mockIframe];
                    return [];
                })
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            exporter.assembleExport(content);

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
                appendChild: function(node) {
                    this.innerHTML += (node.innerHTML || "");
                    // Also merge querySelectorAll results
                    if (!this._children) this._children = [];
                    if (node.querySelectorAll) this._children.push(...node.querySelectorAll('iframe'));
                },
                querySelectorAll: jest.fn().mockImplementation((selector) => {
                    if (selector === 'iframe') return [mockIframe1, mockIframe2];
                    return [];
                })
            };
            global.document.createElement.mockReturnValue(mockTempDiv);

            exporter.assembleExport(content);

            expect(mockIframe1.setAttribute).toHaveBeenCalled();
            expect(mockIframe2.setAttribute).toHaveBeenCalled();
        });
    });
});

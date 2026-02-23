// Mock Browser Globals manually
global.window = {
    innerHeight: 800,
    scrollY: 0,
    scrollBy: jest.fn(),
    getComputedStyle: jest.fn(() => ({ overflow: 'visible' })),
    requestAnimationFrame: jest.fn(cb => setTimeout(cb, 0)),
    cancelAnimationFrame: jest.fn(),
    location: { href: 'http://localhost' }
};

global.document = {
    body: {
        appendChild: jest.fn(),
        children: []
    },
    createElement: jest.fn(tag => ({
        tagName: tag.toUpperCase(),
        style: {},
        className: '',
        appendChild: jest.fn(),
        querySelectorAll: jest.fn(() => []),
        classList: {
            add: jest.fn(),
            remove: jest.fn(),
            contains: jest.fn()
        }
    })),
    children: [],
    querySelectorAll: jest.fn(() => [])
};

global.MutationObserver = class {
    observe() {}
    disconnect() {}
};

// Mock ScraperUtils global
global.ScraperUtils = {
    updateStatus: jest.fn(),
    generateHash: jest.fn(() => "hash"),
    freezeElement: jest.fn((el) => {
        // Simple mock return
        const div = global.document.createElement('div');
        div.innerHTML = "";
        return div;
    })
};
global.window.ScraperUtils = global.ScraperUtils;

// Mock chrome
global.chrome = {
    runtime: {
        sendMessage: jest.fn()
    }
};

// Load the file under test
require('./scraper.js');

describe('DomScraper', () => {
    let scraper;

    beforeEach(() => {
        jest.clearAllMocks();
        // Since we are mocking global.window, we need to access DomScraper from there if require('./scraper.js') attaches it there.
        // scraper.js ends with window.DomScraper = DomScraper;
        scraper = new global.window.DomScraper(new Map());

        // Mock internal methods to isolate tests
        scraper.captureLoop = jest.fn();
    });

    test('startAnimationLoop method should be removed', () => {
        expect(scraper.startAnimationLoop).toBeUndefined();
    });

    test('start() should initialize scraping and call startScanning', async () => {
        // Mock startScanning
        scraper.startScanning = jest.fn();

        // Mock target element
        const target = global.document.createElement('div');
        target.getBoundingClientRect = jest.fn(() => ({ top: 0, height: 100 }));

        await scraper.start(target, 500, 'down');

        expect(scraper.scraping).toBe(true);
        expect(scraper.direction).toBe('down');
        expect(scraper.scrapingSpeed).toBe(500);
        expect(scraper.startScanning).toHaveBeenCalled();
        expect(global.ScraperUtils.updateStatus).toHaveBeenCalledWith("Scraping started...", true);
    });

    test('stop() should stop scanning', () => {
        scraper.stopScanning = jest.fn();
        scraper.scraping = true;

        scraper.stop();

        expect(scraper.scraping).toBe(false);
        expect(scraper.stopScanning).toHaveBeenCalled();
    });
});

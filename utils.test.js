global.window = { location: { href: 'http://localhost' } };
global.document = {
    createElement: (tag) => {
        return {
            tagName: tag.toUpperCase(),
            style: {},
            className: '',
            appendChild: () => {},
            querySelectorAll: () => [],
            classList: {
                add: () => {},
                remove: () => {},
                contains: () => false
            }
        };
    }
};

require('./utils.js');
const ScraperUtils = global.window.ScraperUtils;

describe('ScraperUtils.generateHash', () => {

    // Helper to create a basic mock element
    const createMockElement = (overrides = {}) => {
        return {
            textContent: "",
            innerText: "", // Include innerText in case it gets changed
            id: "",
            classList: [],
            attributes: [],
            children: [],
            ...overrides
        };
    };

    it('should generate consistent hashes for identical elements', () => {
        const el1 = createMockElement({ textContent: "test", innerText: "test", id: "1" });
        const el2 = createMockElement({ textContent: "test", innerText: "test", id: "1" });
        expect(ScraperUtils.generateHash(el1)).toBe(ScraperUtils.generateHash(el2));
    });

    it('should generate different hashes for elements with different text', () => {
        const el1 = createMockElement({ textContent: "test1", innerText: "test1" });
        const el2 = createMockElement({ textContent: "test2", innerText: "test2" });
        expect(ScraperUtils.generateHash(el1)).not.toBe(ScraperUtils.generateHash(el2));
    });

    it('should generate different hashes for elements with different IDs', () => {
        const el1 = createMockElement({ id: "id1" });
        const el2 = createMockElement({ id: "id2" });
        expect(ScraperUtils.generateHash(el1)).not.toBe(ScraperUtils.generateHash(el2));
    });

    it('should ignore mb-captured and mb-highlight classes in hash', () => {
        const el1 = createMockElement({ classList: ["my-class"] });
        const el2 = createMockElement({ classList: ["my-class", "mb-captured", "mb-highlight"] });
        expect(ScraperUtils.generateHash(el1)).toBe(ScraperUtils.generateHash(el2));
    });

    it('should truncate text to 200 characters for hash generation', () => {
        const longText = "a".repeat(300);
        const truncatedText = "a".repeat(200);
        const el1 = createMockElement({ textContent: longText, innerText: longText });
        const el2 = createMockElement({ textContent: truncatedText, innerText: truncatedText });
        expect(ScraperUtils.generateHash(el1)).toBe(ScraperUtils.generateHash(el2));
    });

    it('should handle elements with missing properties gracefully', () => {
        const el = {
            classList: [],
            attributes: [],
            children: []
        };
        const hash = ScraperUtils.generateHash(el);
        expect(typeof hash).toBe('string');
        expect(hash.length).toBeGreaterThan(0);
    });

    it('should include attributes in hash', () => {
        const el1 = createMockElement({ attributes: [{name: "data-id", value: "1"}] });
        const el2 = createMockElement({ attributes: [{name: "data-id", value: "2"}] });
        expect(ScraperUtils.generateHash(el1)).not.toBe(ScraperUtils.generateHash(el2));
    });

    it('should include child tags in hash', () => {
        const el1 = createMockElement({ children: [{tagName: "DIV"}] });
        const el2 = createMockElement({ children: [{tagName: "SPAN"}] });
        expect(ScraperUtils.generateHash(el1)).not.toBe(ScraperUtils.generateHash(el2));
    });
});

// Test infrastructure for ScraperUtils.sanitizeIframe

// Mock DOM Node
class MockNode {
    constructor(tagName, attributes = {}) {
        this.tagName = tagName;
        this.attributes = attributes;
        this.style = {};
    }

    hasAttribute(name) {
        return this.attributes.hasOwnProperty(name);
    }

    getAttribute(name) {
        return this.attributes[name];
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }
}

global.window = {}; // mock window

// Load utils.js (since sanitizeIframe is static, we don't need to instantiate UniversalScraper)
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('./utils.js', 'utf8');
vm.runInThisContext(code);

// Helper to run tests
function runTest(name, fn) {
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
    } catch (e) {
        console.error(`❌ FAIL: ${name}`);
        console.error(e);
        process.exit(1);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || "Assertion failed"}: Expected "${expected}", got "${actual}"`);
    }
}

console.log("Starting tests for sanitizeIframe...");

// Test 1: Non-iframe element
runTest("Non-iframe element should be ignored", () => {
    const div = new MockNode("DIV");
    ScraperUtils.sanitizeIframe(div);
    assert(!div.hasAttribute('sandbox'), "DIV should not have sandbox attribute");
});

// Test 2: Iframe with no sandbox attribute
runTest("Iframe without sandbox should get allow-same-origin", () => {
    const iframe = new MockNode("IFRAME");
    ScraperUtils.sanitizeIframe(iframe);
    assertEqual(iframe.getAttribute('sandbox'), 'allow-same-origin', "Should have allow-same-origin");
});

// Test 3: Iframe with safe sandbox attribute
runTest("Iframe with safe sandbox should be unchanged", () => {
    const iframe = new MockNode("IFRAME", { sandbox: "allow-forms allow-popups" });
    ScraperUtils.sanitizeIframe(iframe);
    assertEqual(iframe.getAttribute('sandbox'), "allow-forms allow-popups", "Should be unchanged");
});

// Test 4: Iframe with dangerous combination (allow-scripts + allow-same-origin)
runTest("Iframe with dangerous combination should remove allow-scripts", () => {
    const iframe = new MockNode("IFRAME", { sandbox: "allow-scripts allow-same-origin allow-popups" });
    ScraperUtils.sanitizeIframe(iframe);
    const sandbox = iframe.getAttribute('sandbox');
    assert(!sandbox.includes('allow-scripts'), "Should remove allow-scripts");
    assert(sandbox.includes('allow-same-origin'), "Should keep allow-same-origin");
    assert(sandbox.includes('allow-popups'), "Should keep allow-popups");
    assertEqual(sandbox, "allow-same-origin allow-popups", "Should be strictly sanitized");
});

// Test 5: Iframe with allow-scripts but NO allow-same-origin (Safe)
runTest("Iframe with allow-scripts only should be unchanged", () => {
    const iframe = new MockNode("IFRAME", { sandbox: "allow-scripts allow-popups" });
    ScraperUtils.sanitizeIframe(iframe);
    assertEqual(iframe.getAttribute('sandbox'), "allow-scripts allow-popups", "Should be unchanged");
});

// Test 6: Iframe with allow-same-origin only (Safe)
runTest("Iframe with allow-same-origin only should be unchanged", () => {
    const iframe = new MockNode("IFRAME", { sandbox: "allow-same-origin allow-popups" });
    ScraperUtils.sanitizeIframe(iframe);
    assertEqual(iframe.getAttribute('sandbox'), "allow-same-origin allow-popups", "Should be unchanged");
});

// Test 7: Null node
runTest("Null node should be handled gracefully", () => {
    ScraperUtils.sanitizeIframe(null);
    // Should not throw
});

console.log("All tests passed!");

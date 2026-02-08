# Chrome Web Store & Edge Add-ons Submission Package

## Extension Information

**Name**: Universal Element Cloner  
**Version**: 1.0  
**Manifest**: V3  
**Category**: Developer Tools

## Short Description (132 chars max)
High-fidelity DOM element cloner with auto-scroll, style freezing, and interactive canvas editor. Built for developers and designers.

## Detailed Description

Universal Element Cloner is a powerful browser extension that lets you capture, edit, and export web page elements with pixel-perfect accuracy.

### Key Features:
- **Smart Element Picker**: Select single or multiple elements with visual feedback
- **Full Page Capture**: Automatically capture entire pages including lazy-loaded content
- **Auto-Scroll Detection**: Intelligently scrolls to capture dynamically loaded elements
- **Style Freezing**: Preserves all computed CSS styles for perfect reproduction
- **Interactive Canvas Editor**: Move, resize, and delete captured elements before export
- **Theme Support**: Built-in dark/light mode toggle
- **Zero Dependencies**: Built with vanilla JavaScript ES6+ for maximum performance

### Perfect For:
- Web developers creating component libraries
- Designers building mockups and prototypes
- QA teams documenting UI states
- Content creators capturing web layouts
- Anyone needing high-fidelity web captures

### Technical Details:
- Manifest V3 compliant
- No external dependencies
- Minimal permissions required
- Privacy-focused: No data collection

Built by Matthew Bubb - [GitHub](https://github.com/thebubbsy/universal-element-cloner)

## Screenshots Needed

1. **Main Interface** (1280x800) - Side panel with capture options
2. **Element Picker** (1280x800) - Highlighted elements being selected
3. **Canvas Editor** (1280x800) - Editing captured elements
4. **Light Mode** (1280x800) - Theme toggle demonstration
5. **Export Result** (1280x800) - Final exported HTML

## Promotional Images

### Small Tile (440x280)
- Extension icon with "Universal Element Cloner" text
- Tagline: "Capture. Edit. Export."

### Large Tile (920x680) - Chrome only
- Feature showcase grid layout
- Icon + 3 feature highlights with icons

### Marquee (1400x560) - Chrome only
- Hero banner with extension in action
- "Clone Any Element with Pixel-Perfect Accuracy"

## Privacy Policy

This extension does not collect, store, or transmit any user data. All operations are performed locally in your browser. No analytics, no tracking, no data collection.

## Support & Contact

- **GitHub Issues**: https://github.com/thebubbsy/universal-element-cloner/issues
- **Developer**: Matthew Bubb
- **Email**: [Your support email]

## Permissions Justification

- **activeTab**: Required to access page content for element capture
- **storage**: Saves user preferences (theme, scroll speed)
- **downloads**: Enables exporting captured elements as HTML files
- **scripting**: Injects content scripts for element selection
- **sidePanel**: Provides non-intrusive UI panel

## Package Checklist

- [x] manifest.json (V3 compliant)
- [x] Icons (16x16, 48x48, 128x128)
- [x] README.md
- [x] All source files
- [ ] Screenshots (5 required)
- [ ] Promotional images
- [ ] Privacy policy document
- [ ] Store descriptions ready

## Build Instructions

No build process required - this is pure vanilla JavaScript.

To package for upload:
1. Remove .git, .history, and any dev files
2. Create ZIP of extension directory
3. Upload to Chrome Web Store / Edge Add-ons dashboard

## Submission URLs

- **Chrome Web Store**: https://chrome.google.com/webstore/devconsole
- **Edge Add-ons**: https://partner.microsoft.com/dashboard/microsoftedge

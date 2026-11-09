# End-to-end tests

Playwright runs the built app in a browser against a stub of the Rust backend
(`stub.ts`). The tests use **WebKit**, the engine behind the macOS app.

## Rules for new UI

1. **Every new screen or state gets an e2e test** for its main path, in the same
   change as the feature.
2. **Use `test` from `./fixtures`**, not from `@playwright/test`. It adds a layout
   guard that fails any test during which the app moves or the page scrolls.

Run locally with `npm run test:e2e`. If WebKit isn't installed, try
`PW_BROWSER=chromium`.

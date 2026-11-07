# End-to-end and visual tests

Playwright runs the built app in a browser against a stub of the Rust backend
(`stub.ts`). The visual tests use **WebKit**, the engine behind the macOS app.

## Rules for new UI

1. **Every new screen or state gets a screenshot** in `visual.spec.ts`, in the
   same change as the feature. That includes anything temporary: notices, menus,
   tooltips, loading and error states.
2. **Use `test` from `./fixtures`**, not from `@playwright/test`. It adds a layout
   guard that fails any test during which the app moves or the page scrolls.
3. **Review baseline changes with your eyes.** Refresh them with the _Update visual
   baselines_ workflow. It pushes a `visual-baselines` branch (and a pull request
   when the repository allows it). Open the changed images in the diff and merge
   only if every change is intended.

Run locally with `npm run test:visual`. If WebKit isn't installed, try
`PW_BROWSER=chromium` (its screenshots won't match the committed baselines).

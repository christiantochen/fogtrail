import { expect, test as base } from "@playwright/test";

/**
 * Every test also watches the layout. On each animation frame it checks that the
 * app fills the window exactly and that the page itself never scrolls. Anything
 * that appears for a moment and pushes the app around (a notice, a menu) fails
 * the test even if the test never looks at layout.
 */
export const test = base.extend<{ layoutGuard: void }>({
  layoutGuard: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __layoutViolations: string[] };
        w.__layoutViolations = [];
        const check = () => {
          const app = document.querySelector(".app");
          if (app) {
            const r = app.getBoundingClientRect();
            const de = document.documentElement;
            const problem =
              r.top !== 0 || r.left !== 0
                ? `app moved to ${r.left},${r.top}`
                : de.scrollHeight > window.innerHeight
                  ? `page scrolls (${de.scrollHeight} > ${window.innerHeight})`
                  : de.scrollWidth > window.innerWidth
                    ? "page scrolls sideways"
                    : null;
            if (problem && w.__layoutViolations.length < 5) {
              w.__layoutViolations.push(problem);
            }
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      await use();
      const violations = await page
        .evaluate(
          () =>
            (window as unknown as { __layoutViolations?: string[] })
              .__layoutViolations ?? [],
        )
        .catch(() => []);
      expect(violations, "layout moved during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

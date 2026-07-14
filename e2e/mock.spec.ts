// End-to-end: the full engine loop in a real browser — transport connect,
// prompt intent, adapter events, reducer fold, rendered transcript — using the
// mock adapter (src/lib/adapters/mock/), so the suite needs no CLI or
// credentials. This is the regression net for "fork → change → go": if the
// seam breaks anywhere, sending a message here fails.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?agent=mock");
});

async function send(page: import("@playwright/test").Page, text: string) {
  const box = page.locator("textarea");
  await box.fill(text);
  await box.press("Enter");
}

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function pasteImage(page: import("@playwright/test").Page) {
  await page.locator("textarea").evaluate((textarea, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "pasted.png", {
        type: "image/png",
        lastModified: 1,
      }),
    );
    textarea.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, PNG_1PX);
  await expect(page.getByAltText("pasted.png")).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

async function boxesDuring(
  page: import("@playwright/test").Page,
  action: () => Promise<void>,
  duration: number,
): Promise<Box[]> {
  const samples = page.locator("[data-file-preview]").evaluate(
    (element, ms) =>
      new Promise<Box[]>((resolve) => {
        const boxes: Box[] = [];
        const start = performance.now();
        const sample = (now: number) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          boxes.push({ x, y, width, height });
          if (now - start < ms) requestAnimationFrame(sample);
          else resolve(boxes);
        };
        requestAnimationFrame(sample);
      }),
    duration,
  );
  await action();
  return samples;
}

function expectStableGeometry(boxes: Box[]) {
  expect(boxes.length).toBeGreaterThan(5);
  for (const field of ["x", "y", "width", "height"] as const) {
    const values = boxes.map((box) => box[field]);
    expect(Math.max(...values) - Math.min(...values), field).toBeLessThan(0.5);
  }
}

test("boots connected with capability-gated chrome", async ({ page }) => {
  // Mock adapter connects instantly — no disconnected banner.
  await expect(page.getByText("disconnected")).toHaveCount(0);
  // capabilities: no models/thinking/stats → no pills next to the composer.
  await expect(page.locator("main [role=combobox]")).toHaveCount(0);
});

test("prompt → streamed run: user msg, work trace, markdown answer", async ({
  page,
}) => {
  await send(page, "hello e2e");

  // User message renders immediately (optimistic @user).
  await expect(page.getByText("hello e2e").first()).toBeVisible();

  // The scripted answer streams in and settles.
  await expect(page.getByText("You said: hello e2e")).toBeVisible();
  await expect(
    page.getByText("This reply came from the mock adapter", { exact: false }),
  ).toBeVisible();

  // The tool step settles into a "Worked for …" trace; expanding shows the
  // step label + output.
  const trace = page.getByRole("button", { name: /Worked for/ });
  await expect(trace).toBeVisible();
  await trace.click();
  await expect(
    page.getByText("Ran echo hello-from-mock").first(),
  ).toBeVisible();
});

test("question flow: select card renders and resolves on answer", async ({
  page,
}) => {
  await send(page, "please ask me something");

  await expect(page.getByText("Mock question: pick an option")).toBeVisible();
  await page.getByRole("radio", { name: "Option A" }).first().click();
  // Submitting the answer removes the question card (@resolveQuestion).
  const submit = page.getByRole("button", { name: /submit|confirm|send/i });
  if (await submit.count()) await submit.first().click();
  await expect(page.getByText("Mock question: pick an option")).toHaveCount(0, {
    timeout: 10_000,
  });

  // The run continues to its answer afterwards.
  await expect(page.getByText("You said: please ask me something")).toBeVisible();
});

test("interleaved turn: time/copy meta only on the final output", async ({
  page,
}) => {
  await send(page, "interleave");
  await expect(
    page.getByText("This reply came from the mock adapter", { exact: false }),
  ).toBeVisible();
  // Three prose segments render (two narrations + answer), but only the final
  // one — plus the user message — carries a Copy control.
  await expect(page.getByText("I'll search the docs for that first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy message" })).toHaveCount(2);
});

test("second turn appends below the first", async ({ page }) => {
  await send(page, "turn one");
  await expect(page.getByText("You said: turn one")).toBeVisible();
  await send(page, "turn two");
  await expect(page.getByText("You said: turn two")).toBeVisible();
  // Both turns remain in the transcript.
  await expect(page.getByText("You said: turn one")).toBeVisible();
});

test("pasted image stays fixed while typing and while output streams", async ({
  page,
}) => {
  const box = page.locator("textarea");

  await pasteImage(page);
  // Let the one intentional attachment entrance finish before sampling.
  await page.waitForTimeout(350);
  expectStableGeometry(
    await boxesDuring(
      page,
      () => box.pressSequentially("steady preview", { delay: 30 }),
      750,
    ),
  );

  // Send a prompt, then paste a fresh image into the composer while the mock
  // response produces reducer/UI commits. Its tile must not move as thinking,
  // tool, and cumulative text events arrive.
  await box.fill("stream around this preview");
  await box.press("Enter");
  await expect(
    page
      .locator('[role="status"][aria-live="polite"]')
      .filter({ hasText: "Assistant is responding" }),
  ).toHaveText("Assistant is responding");
  await pasteImage(page);
  await page.waitForTimeout(350);
  expectStableGeometry(await boxesDuring(page, async () => {}, 900));
});

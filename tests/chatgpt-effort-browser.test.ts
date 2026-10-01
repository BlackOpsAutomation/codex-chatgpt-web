import { expect, test } from "bun:test";
import { chromium, type Locator, type Page } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { detectChatGptAccountCapabilities } from "../src/chatgpt-session";
import { assertChatGptModelFamily } from "../src/adapters/chatgpt-web/model-selection";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("attached navigation verifies the composer without waiting for deferred resources", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  let releaseResource: () => void = () => {};
  const resourceGate = new Promise<void>(resolve => { releaseResource = resolve; });
  try {
    const page = await browser.newPage();
    await page.route("https://chatgpt.com/**", async route => {
      if (new URL(route.request().url()).pathname === "/deferred.js") {
        await resourceGate;
        await route.fulfill({ contentType: "text/javascript", body: "" });
      } else {
        await route.fulfill({ contentType: "text/html", body: `<html><head>
          <script>document.addEventListener("DOMContentLoaded", () => document.body.dataset.loaded = "true");</script>
          <script defer src="/deferred.js"></script></head><body>
          <form><div id="prompt-textarea" contenteditable="true"></div></form></body></html>` });
      }
    });
    const worker = ChatGptBrowserWorker.forProvider({
      adapter: "chatgpt-web", baseUrl: "https://chatgpt.com",
      chatgptWeb: { browserHost: "attached-chrome", browserAttachEndpoint: "http://127.0.0.1:39222" },
    });
    const surfaceWorker = worker as unknown as { prepareChatSurface(page: Page): Promise<Locator> };
    const composer = await surfaceWorker.prepareChatSurface(page);
    expect(await composer.isEditable()).toBe(true);
    expect(page.url()).toBe("https://chatgpt.com/?temporary-chat=true");
    expect(await page.locator("body").getAttribute("data-loaded")).toBeNull();
    expect(await composer.innerText()).toBe("");
  } finally {
    releaseResource();
    await browser.close();
  }
}, 20_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("family gate accepts the checked Sol row with a versionless power announcement, but never ambiguous evidence", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    await page.setContent('<div id="picker" role="menu"></div>');
    const scenarios = [
      { name: "current Sol Instant", rows: ['<div role="menuitemradio" aria-checked="true">GPT-5.6 Sol</div>', '<div role="menuitemradio" aria-checked="false">GPT-5.5</div>'],
        description: "Instant, 1 of 1.", family: "5.6", effort: "low", index: 0, max: 0, valid: true },
      { name: "wrong checked family", rows: ['<div role="menuitemradio" aria-checked="false">GPT-5.6 Sol</div>', '<div role="menuitemradio" aria-checked="true">GPT-5.5</div>'],
        description: "Instant, 1 of 1.", family: "5.6", effort: "low", index: 0, max: 0, valid: false },
      { name: "missing family", rows: ['<div role="menuitemradio" aria-checked="true">GPT-5.5</div>'],
        description: "Instant, 1 of 1.", family: "5.6", effort: "low", index: 0, max: 0, valid: false },
      { name: "duplicate family rows", rows: Array(2).fill('<div role="menuitemradio" aria-checked="true">GPT-5.6 Sol</div>'),
        description: "Instant, 1 of 1.", family: "5.6", effort: "low", index: 0, max: 0, valid: false },
      { name: "wrong announced effort", rows: ['<div role="menuitemradio" aria-checked="true">GPT-5.6 Sol</div>'],
        description: "Pro, 1 of 1.", family: "5.6", effort: "low", index: 0, max: 0, valid: false },
      { name: "contradictory model description", rows: ['<div role="menuitemradio" aria-checked="true">GPT-5.6 Sol</div>'],
        description: "Instant, 1 of 1.", extra: "GPT-6 Astra Pro", family: "5.6", effort: "low", index: 0, max: 0, valid: false },
      { name: "Latest staging retains GPT-6 behavior", rows: ['<div role="menuitemradio" aria-checked="true">Latest</div>'],
        description: "5.6 Extra High, 4 of 4.", family: "6", effort: "xhigh", index: 3, max: 3, valid: true },
      { name: "GPT-6 Pro remains version-bound", rows: ['<div role="menuitemradio" aria-checked="true">GPT-6 Pro</div>'],
        description: "6 Pro, 5 of 5.", family: "6", effort: "max", index: 4, max: 4, valid: true },
      { name: "Sol Pro remains version-bound", rows: ['<div role="menuitemradio" aria-checked="true">GPT-5.6 Sol Pro</div>'],
        description: "GPT-5.6 Sol Pro, 5 of 5.", family: "5.6", effort: "max", index: 4, max: 4, valid: true },
      { name: "versionless Pro is not inferred", rows: ['<div role="menuitemradio" aria-checked="true">GPT-5.6 Sol Pro</div>'],
        description: "Pro, 5 of 5.", family: "5.6", effort: "max", index: 4, max: 4, valid: false },
    ] as const;
    for (const scenario of scenarios) {
      await page.locator("#picker").evaluate((menu, html) => { menu.innerHTML = html; }, `${scenario.rows.join("")}
        <span id="announcement">${scenario.description}</span>
        <span id="help">Use Left and Right arrow keys to adjust power.</span>
        ${"extra" in scenario ? `<span id="extra">${scenario.extra}</span>` : ""}
        <div role="menuitem" aria-describedby="announcement help ${"extra" in scenario ? "extra" : ""}">
          <div data-model-picker-power-slider><span data-orientation="horizontal" aria-disabled="false">
            ${Array(scenario.max + 1).fill('<span data-selected="true"></span>').join("")}
            <span role="slider" aria-hidden="true"
              aria-valuemin="0" aria-valuemax="${scenario.max}" aria-valuenow="${scenario.index}"></span>
          </span></div>
        </div>`);
      const menu = {
        menu: page.locator("#picker"), slider: page.locator('[role="slider"]'),
        sliderContainer: page.locator("[data-model-picker-power-slider]"),
      } as unknown as Parameters<typeof assertChatGptModelFamily>[0];
      try {
        await (scenario.valid
          ? expect(assertChatGptModelFamily(menu, scenario.family, scenario.effort, scenario.index)).resolves.toBeUndefined()
          : expect(assertChatGptModelFamily(menu, scenario.family, scenario.effort, scenario.index))
            .rejects.toMatchObject({ code: "model_version_unavailable" }));
      } catch (error) {
        throw new Error(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  } finally { await browser.close(); }
}, 180_000);

for (const modern of [false, true])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`model selection reuses the ${modern ? "power" : "classic"} picker without racing Escape cleanup`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(2_000);
    await page.setContent(`<form><div id="prompt-textarea" contenteditable="true">Draft</div>
      <button type="button" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="false">Extra High</button></form>
      <div id="picker" role="menu" hidden><div ${modern ? 'data-model-picker-view="simple"' : ''}>
        <div id="toggle" role="menuitem" aria-hidden="false" aria-expanded="false" data-model-picker-view-toggle="true">Select model</div>
        <div id="models" hidden><div role="menuitemradio" aria-checked="true">Latest</div>
          <div role="menuitemradio" aria-checked="false">GPT-5.6 Sol</div></div>
        <span id="announcement">5.6 Extra High, 4 of 4.</span>
        <div role="menuitem" tabindex="0" aria-describedby="announcement">
          <div data-model-picker-power-slider style="height:30px;width:250px"><span data-orientation="horizontal" aria-disabled="false">
            ${Array(4).fill('<span data-selected="true"></span>').join('')}
            <span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="3" aria-valuenow="3"></span>
          </span></div></div>
      </div></div>
      <script>
        const control=document.querySelector('button'),menu=document.querySelector('#picker'),toggle=document.querySelector('#toggle');
        let selected=false;
        window.pickerOpens=0;
        function close(){menu.hidden=true;control.setAttribute('aria-expanded','false');control.textContent=selected?'5.6 Sol Extra High':'Extra High';}
        control.onclick=()=>{window.pickerOpens++;menu.hidden=false;control.setAttribute('aria-expanded','true');};
        toggle.onclick=()=>{document.querySelector('#models').hidden=false;toggle.setAttribute('aria-expanded','true');};
        document.querySelectorAll('[role=menuitemradio]')[1].onclick=()=>{
          selected=true;
          document.querySelectorAll('[role=menuitemradio]').forEach((e,i)=>e.setAttribute('aria-checked',String(i===1)));
          document.querySelector('#models').hidden=true;
        };
        document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();setTimeout(close,150);}});
      </script>`);
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const result = await worker.selectModelAndEffort(page, "gpt-5.6-sol", "xhigh", {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    }, undefined, false, "5.6");
    expect(result.selection.label).toBe("5.6 Sol Extra High");
    expect(await page.evaluate(() => (window as any).pickerOpens)).toBe(2);
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Draft");
  } finally { await browser.close(); }
}, 30_000);

for (const scenario of ["hydrate", "shrink", "locked", "pro-disappears"])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`real slider ${scenario} keeps the requested available effort`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><div id="prompt-textarea" contenteditable="true">Draft</div>
      <button type="button" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="false">Instant</button></form>
      <div id="picker" role="menu" hidden><div role="menuitem" tabindex="0"><div data-model-picker-power-slider style="height:30px;width:250px"></div></div></div>
      <script>
        let value=0, max=4, opens=0;
        const scenario=${JSON.stringify(scenario)}, control=document.querySelector('button'), menu=document.querySelector('#picker');
        function render(ticks=max+1) {
          document.querySelector('[data-model-picker-power-slider]').innerHTML='<span data-orientation="horizontal" aria-disabled="false">'
            +Array.from({length:ticks},(_,i)=>'<span data-selected="'+(i<=value)+'"'+(scenario==='locked'&&opens>1&&i===2?' data-locked="true"':'')+'></span>').join('')
            +'<span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="'+max+'" aria-valuenow="'+value+'"></span></span>';
        }
        control.onclick=()=>{
          opens++; control.dataset.opens=String(opens); menu.hidden=false; control.setAttribute('aria-expanded','true');
          if(opens>1&&(scenario==='shrink'||scenario==='pro-disappears'))max=3;
          value=Math.min(value,max); render(scenario==='hydrate'&&opens===1?4:max+1);
          if(scenario==='hydrate'&&opens===1)setTimeout(()=>{max=3;render()},100);
        };
        document.addEventListener('keydown',e=>{
          if(e.key==='Escape'){menu.hidden=true;control.setAttribute('aria-expanded','false');control.textContent=['Instant','Medium','High','Extra High','Pro'][value];}
          else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){value+=e.key==='ArrowRight'?1:-1;render();e.preventDefault();}
        });
        render();
      </script>`);
    if (scenario === "hydrate") {
      expect(await detectChatGptAccountCapabilities(page)).toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: false });
    } else {
      const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
      const effort = scenario === "pro-disappears" ? "max" : scenario === "locked" ? "high" : "xhigh";
      // These cases test the second slider reading, not Chrome's physical-click
      // navigation waiter. On this synthetic control the click event can run
      // while Playwright still times out awaiting a navigation that never occurs.
      const prototype = Object.getPrototypeOf(page.locator("button")) as { click: Locator["click"] };
      const physicalClick = prototype.click;
      if (scenario === "locked" || scenario === "pro-disappears") {
        prototype.click = function (this: Locator, options) {
          return this.page() === page && this.toString().includes('button[aria-haspopup="menu"][data-tone="neutral"]')
            ? this.dispatchEvent("click")
            : physicalClick.call(this, options);
        };
      }
      try {
        const result = worker.selectModelAndEffort(page, "gpt-5.6-sol", effort, {
          localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
        });
        if (scenario === "shrink") expect((await result).selection.label).toBe("Extra High");
        else {
          await expect(result).rejects.toMatchObject({
            code: scenario === "locked" ? "chatgpt_effort_locked" : "upstream_server_error",
            retryable: false,
          });
          expect(await page.locator("button").getAttribute("data-opens")).toBe("2");
          if (scenario === "locked") expect(await page.locator('[data-locked="true"]').count()).toBe(1);
          else expect(await page.locator('[role="slider"]').getAttribute("aria-valuemax")).toBe("3");
        }
      } finally {
        prototype.click = physicalClick;
      }
    }
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Draft");
    await page.close();
  } finally { await browser.close(); }
}, 120_000);

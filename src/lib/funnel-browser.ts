import type { Browser, HTTPRequest, JSHandle, Page } from "puppeteer";
import { createLimiter } from "./bounded-work.cjs";
import { fetchPublicPage, publicUrl } from "./prospect-research.cjs";
import type { FunnelScreenshot } from "./funnel-analyzer-types";

const httpLane = createLimiter(3, 96);
const readTypes = new Set(["document", "script", "stylesheet", "image", "font", "xhr", "fetch"]);
const redirectStatuses = [301, 302, 303, 307, 308];
const unsafeAction = /(?:^|[/?&=_.-])(?:logout|log-out|unsubscribe|cancel-booking|reschedule|checkout|purchase|delete|confirm-booking)(?:$|[/?&=_.-])/i;

export function funnelUrl(value: string): URL {
  if (value.length > 2_048) throw new Error("The public destination URL exceeds the scan length limit.");
  const url = publicUrl(value);
  if (/(^|\.)(?:linkedin\.com|licdn\.com)\.?$/i.test(url.hostname)) {
    throw new Error("Only public funnel websites can be scanned.");
  }
  if (unsafeAction.test(decodeURIComponent(url.pathname + url.search))) {
    throw new Error("This destination appears to perform a transaction or change account state.");
  }
  return url;
}

type Resource = { url: string; status: number; headers: Record<string, string>; body: Buffer };
export type ReadResource = (url: string, signal: AbortSignal, userAgent?: string) => Promise<Resource>;

export class PublicDocumentError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`The page returned HTTP ${status}.`);
  }
}

export const readFunnelResource: ReadResource = (url, signal, userAgent) => httpLane(() =>
  fetchPublicPage(funnelUrl(url).href, { resource: true, followRedirects: false, signal, userAgent }),
);

export async function readFunnelDocument(value: string, read: ReadResource) {
  const signal = AbortSignal.timeout(12_000);
  let url = funnelUrl(value).href;
  for (let hop = 0; hop <= 4; hop++) {
    const response = await read(url, signal);
    const finalUrl = funnelUrl(response.url).href;
    if (redirectStatuses.includes(response.status)) {
      if (!response.headers.location) throw new Error("The page returned an invalid redirect.");
      url = funnelUrl(new URL(response.headers.location, finalUrl).href).href;
      continue;
    }
    assertHtmlResponse(finalUrl, response.status, response.headers["content-type"]);
    return { url: finalUrl, html: response.body.toString("utf8") };
  }
  throw new Error("The page redirected too many times.");
}

function assertHtmlResponse(url: string, status: number, contentType?: string) {
  if (status >= 400) throw new PublicDocumentError(url, status);
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType ?? "")) {
    throw new Error("The destination did not return a public HTML page.");
  }
}

export type RenderedPage = {
  url: string;
  html: string;
  screenshots: FunnelScreenshot[];
  unavailable: Array<FunnelScreenshot["device"]>;
  incompleteAssets: boolean;
  elementCaptures: Record<string, string>;
};

type CaptureTarget = { index: number; top: number; section: NonNullable<FunnelScreenshot["section"]>; priority: number };

async function visibleElements(page: Page, nodes: JSHandle<NodeListOf<Element>>, indices: number[], scrollTop?: number) {
  return page.evaluate(async (elements, candidates, y) => {
    if (y !== undefined) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    return candidates.filter((index) => {
      const node = elements[index];
      if (!node?.isConnected) return false;
      const style = getComputedStyle(node);
      if (style.opacity === "0" || style.visibility !== "visible") return false;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < 0 || rect.bottom > innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      const hit = document.elementFromPoint(x, (rect.top + rect.bottom) / 2);
      return Boolean(hit && (node.contains(hit) || hit.contains(node)));
    });
  }, nodes, indices, scrollTop);
}

export function createFunnelBrowser(read: ReadResource = readFunnelResource, scanSignal?: AbortSignal) {
  let browser: Promise<Browser> | undefined;
  // Leave response space for the original desktop and mobile screenshots.
  let sectionBytesRemaining = 900_000;
  const launch = async () => {
    const { default: puppeteer } = await import("puppeteer");
    scanSignal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    scanSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await puppeteer.launch({
        headless: true,
        timeout: 8_000,
        protocolTimeout: 8_000,
        signal: controller.signal,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        // Chrome cannot contact origins directly. The Node public reader fulfills
        // intercepted GETs. The deny proxy also covers unhandled targets and sockets.
        args: [
          "--proxy-server=http://127.0.0.1:1", "--proxy-bypass-list=<-loopback>",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
          "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      });
    } finally {
      scanSignal?.removeEventListener("abort", abort);
    }
  };

  async function capture(instance: Browser, url: string, id: string, device: FunnelScreenshot["device"]) {
    const context = await instance.createBrowserContext();
    const timeout = AbortSignal.timeout(8_000);
    const signal = scanSignal ? AbortSignal.any([scanSignal, timeout]) : timeout;
    const close = () => { void context.close().catch(() => {}); };
    signal.addEventListener("abort", close, { once: true });
    try {
      signal.throwIfAborted();
      const page = await context.newPage();
      const mobile = device === "mobile";
      const width = mobile ? 390 : 1366;
      const height = mobile ? 844 : 800;
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
      if (mobile) {
        const chrome = (await instance.userAgent()).match(/Chrome\/[\d.]+/)?.[0] ?? "Chrome";
        await page.setUserAgent(`Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Mobile Safari/537.36`);
      }
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const navigations = new Set([url]);
      let requests = 0;
      let bytes = 0;
      let documentFailure: Error | undefined;
      let incompleteAssets = false;

      async function fulfill(request: HTTPRequest) {
        const mainDocument = request.isNavigationRequest() && request.frame() === page.mainFrame();
        try {
          const target = funnelUrl(request.url()).href;
          if (
            request.method() !== "GET" || !readTypes.has(request.resourceType()) || ++requests > 72 ||
            (mainDocument && !navigations.delete(target))
          ) throw new Error("The browser blocked an unsupported public request.");
          signal.throwIfAborted();
          const response = await read(target, signal, userAgent);
          const headers: Record<string, string> = {};
          for (const key of ["content-type", "access-control-allow-origin"]) {
            if (response.headers[key]) headers[key] = response.headers[key];
          }
          if (response.url !== target || redirectStatuses.includes(response.status)) {
            const location = response.url !== target ? response.url : response.headers.location;
            if (!location) throw new Error("The page returned an invalid redirect.");
            const destination = funnelUrl(new URL(location, target).href).href;
            if (mainDocument) {
              if (request.redirectChain().length >= 4) throw new Error("The page redirected too many times.");
              navigations.add(destination);
            }
            await request.respond({ status: 302, headers: { location: destination } });
            return;
          }
          if (mainDocument) assertHtmlResponse(target, response.status, headers["content-type"]);
          if (response.status >= 400 && ["stylesheet", "image", "font"].includes(request.resourceType())) incompleteAssets = true;
          bytes += response.body.byteLength;
          if (bytes > 12 * 1024 * 1024) throw new Error("The page exceeded the rendering resource limit.");
          await request.respond({ status: response.status, headers, body: response.body });
        } catch (error) {
          if (mainDocument && error instanceof Error) documentFailure = error;
          if (["stylesheet", "image", "font"].includes(request.resourceType())) incompleteAssets = true;
          await request.abort("blockedbyclient").catch(() => {});
        }
      }
      page.on("request", (request) => { void fulfill(request); });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5_000 });
      } catch (error) {
        if (documentFailure || !(error instanceof Error && error.name === "TimeoutError") || page.url() === "about:blank") {
          throw documentFailure ?? error;
        }
        incompleteAssets = true;
      }
      await page.waitForNetworkIdle({ idleTime: 350, timeout: 2_000 }).catch(() => {});
      signal.throwIfAborted();
      const markup = await readVisibleMarkup(page);
      const [nodes, snapshot] = await Promise.all([markup.getProperty("nodes"), markup.getProperty("snapshot")]);
      const { html, indices, targets } = await snapshot.jsonValue();
      const documentUrl = page.url();
      const finalUrl = funnelUrl(documentUrl).href;
      const screenshots: FunnelScreenshot[] = [];
      const elementCaptures: Record<string, string> = {};
      async function save(captureId: string, visible: number[], section?: FunnelScreenshot["section"]) {
        const data = await page.screenshot({ type: "jpeg", quality: 70, encoding: "base64", captureBeyondViewport: false });
        if (data.length > 400_000 || page.url() !== documentUrl || (section && data.length > sectionBytesRemaining)) return;
        if (section) sectionBytesRemaining -= data.length;
        screenshots.push({ id: captureId, url: finalUrl, device, width, height, dataUrl: `data:image/jpeg;base64,${data}`, analyzed: false, section });
        for (const index of visible) elementCaptures[index] ??= captureId;
      }
      await save(id, mobile ? [] : await visibleElements(page, nodes, indices).catch(() => []));

      if (!mobile) {
        const ranked = targets.sort((a, b) => b.priority - a.priority || a.top - b.top);
        const sampled: number[] = [];
        for (const target of ranked) {
          if (sampled.length >= 2 || signal.aborted) break;
          if (elementCaptures[target.index] || sampled.some((top) => Math.abs(top - target.top) < height / 2)) continue;
          sampled.push(target.top);
          try {
            const visible = await visibleElements(page, nodes, indices, Math.max(0, Math.floor(target.top - 120)));
            if (visible.includes(target.index)) await save(`${id}-section-${sampled.length}`, visible, target.section);
          } catch {
            // The original viewport is still usable if a scroll or detail capture failed.
          }
        }
      }
      return { url: finalUrl, html, screenshots, elementCaptures, incompleteAssets };
    } finally {
      signal.removeEventListener("abort", close);
      await context.close().catch(() => {});
    }
  }

  return {
    async render(url: string, pageId: string): Promise<RenderedPage> {
      const instance = await (browser ??= launch());
      const attempts = await Promise.allSettled((["desktop", "mobile"] as const).map((device) =>
        capture(instance, funnelUrl(url).href, `${pageId}-${device}`, device),
      ));
      const views = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
      if (!views.length) throw new Error("The page could not be rendered at either viewport.");
      const [page] = views;
      const screenshots = views.flatMap((view) => view.url === page.url ? view.screenshots : []);
      return {
        url: page.url, html: page.html, screenshots,
        elementCaptures: page.elementCaptures,
        unavailable: (["desktop", "mobile"] as const).filter((device) => !screenshots.some((shot) => shot.device === device && !shot.section)),
        incompleteAssets: views.some((view) => view.incompleteAssets),
      };
    },
    async close() {
      await browser?.then((instance) => instance.close()).catch(() => {});
    },
  };
}

async function readVisibleMarkup(page: Page) {
  return page.evaluateHandle(() => {
    const root = document.body;
    const indices: number[] = [];
    const targets: CaptureTarget[] = [];
    const nodes = document.querySelectorAll("body *");
    if (!root) return { nodes, snapshot: { html: "", indices, targets } };
    const clone = root.cloneNode(true) as HTMLElement;
    const copies = clone.querySelectorAll("*");
    if (nodes.length > 20_000) throw new Error("The rendered page is too large to inspect.");
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const copy = copies[index];
      if (!clone.contains(copy)) continue;
      const css = getComputedStyle(node);
      if (node.matches("script,style,noscript,template,svg,[hidden],[aria-hidden=true]") ||
          css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse" || css.opacity === "0") {
        copy.remove();
        continue;
      }
      // Remove page-authored markers before supplying measured placement.
      copy.removeAttribute("data-compel-fold");
      copy.removeAttribute("data-compel-element");
      if (node.matches("h1,h2,h3,h4,p,li,blockquote,legend,summary,img[alt],main > section,section > div,a[href],iframe[src],button,[role=button],form,[data-url],[data-cal-link]")) {
        const rect = node.getBoundingClientRect();
        if (rect.width && rect.height && rect.height <= innerHeight && rect.right > 0 && rect.left < innerWidth) {
          copy.setAttribute("data-compel-element", String(index));
          indices.push(index);
          if (rect.bottom > innerHeight && !node.closest("nav,footer,header,[role=navigation]")) {
            const label = (node.textContent || node.getAttribute("aria-label") || "").trim().slice(0, 160);
            const form = node.matches("form");
            const action = node.matches("a,button,[role=button]") && /\b(book|schedul\w*|apply|consultation|download|get started)\b/i.test(label);
            const proof = node.matches("blockquote") || /\b(testimonials?|case stud(?:y|ies)|results|proof|reviews?|what you get)\b/i.test(label);
            if (form || action || proof || node.matches("h2,h3")) {
              targets.push({
                index, top: rect.top + scrollY, priority: form ? 4 : action ? 3 : proof ? 2 : 1,
                section: form ? "Form" : action ? "Call to action" : "Page section",
              });
            }
          }
        }
      }
      if (node.matches("a[href],button,[role=button],iframe")) {
        const rect = node.getBoundingClientRect();
        if (rect.width && rect.height && rect.top < innerHeight && rect.bottom > 0 && rect.right > 0 && rect.left < innerWidth) {
          copy.setAttribute("data-compel-fold", "true");
        }
        for (const attribute of ["href", "src", "data-url", "data-cal-link"]) {
          const raw = node.getAttribute(attribute);
          if (raw && attribute !== "data-cal-link") {
            try { copy.setAttribute(attribute, new URL(raw, document.baseURI).href); } catch { /* keep the authored value */ }
          }
        }
      }
    }
    const title = document.createElement("title");
    title.textContent = document.title;
    const html = `<html><head>${title.outerHTML}</head>${clone.outerHTML}</html>`;
    if (html.length > 2_000_000) throw new Error("The rendered page exceeds the markup limit.");
    return { nodes, snapshot: { html, indices, targets } };
  });
}

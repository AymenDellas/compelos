"use strict";
const store = require("./coach-prospecting-store.cjs");
const { researchProspect } = require("./prospect-research.cjs");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function restriction(status, url, text = "") {
  if (status === 429)
    return "LinkedIn reported a rate limit. Resolve it before manually resuming this run.";
  if (
    [401, 403, 999].includes(status) ||
    /\/(?:checkpoint|challenge|login|authwall)(?:\/|\?|$)/i.test(url) ||
    /verify (?:you are human|your identity)|security verification|unusual activity|temporarily restricted|you.ve reached.*(?:limit|search)/i.test(
      text,
    )
  )
    return "LinkedIn requires attention. Resolve the account check before manually resuming this run.";
  return "";
}
async function discover(page, run, { pool, owner, log = () => {} }) {
  let blocked = "";
  const watch = (response) => {
    try {
      if (/^(?:.*\.)?linkedin\.com$/.test(new URL(response.url()).hostname))
        blocked ||= restriction(response.status(), response.url());
    } catch {}
  };
  page.on("response", watch);
  try {
    const response = await page.goto(
      store.sourceUrl(run.source, run.data.sourceUrl),
      { waitUntil: "domcontentloaded", timeout: 45000 },
    );
    await page.waitForSelector("main", { timeout: 12000 }).catch(() => {});
    let stagnant = 0,
      previous = run.data.seen?.length || 0;
    // A bounded visible-list scan. No private pagination calls, hidden-page enumeration or auto-invites.
    for (let pass = 0; pass < 12; pass++) {
      const state = await page.evaluate(() => ({
        url: location.href,
        text: document.body?.innerText.slice(0, 6000) || "",
        urls: [...document.querySelectorAll('main a[href*="/in/"]')]
          .filter((a) => a.getClientRects().length)
          .map((a) => a.href),
      }));
      if (!/^(?:.*\.)?linkedin\.com$/.test(new URL(state.url).hostname))
        throw Error(
          "The discovery page left LinkedIn; no profiles were collected from that page.",
        );
      blocked ||= restriction(response?.status(), state.url, state.text);
      if (blocked) {
        await store.pauseAccount(pool, run.account_id, blocked);
        return { paused: blocked };
      }
      const updated = await store.sourceProgress(
        pool,
        run.id,
        owner,
        state.urls,
        {
          pages: (run.data.pages || 0) + 1,
          message:
            "Discovering visible profiles. Exact job titles are not used to discard candidates.",
        },
      );
      if (!updated) return { stopped: true };
      run = updated;
      log(
        `Prospecting: ${run.data.queued}/${run.data.limit} profiles queued; ${run.data.skipped} existing or excluded profiles skipped.`,
      );
      if (run.status !== "RUNNING") return { done: true };
      stagnant = run.data.seen.length === previous ? stagnant + 1 : 0;
      previous = run.data.seen.length;
      if (stagnant >= 3) break;
      await page.evaluate(() => {
        const nodes = [
          ...document.querySelectorAll("main,main section,main ul,main div"),
        ].filter(
          (e) =>
            e.scrollHeight > e.clientHeight + 100 &&
            e.querySelectorAll('a[href*="/in/"]').length > 2,
        );
        nodes.sort(
          (a, b) =>
            b.querySelectorAll('a[href*="/in/"]').length -
            a.querySelectorAll('a[href*="/in/"]').length,
        );
        const list = nodes.find((e) =>
          ["auto", "scroll"].includes(getComputedStyle(e).overflowY),
        );
        if (list) list.scrollBy(0, list.clientHeight * 0.85);
        else window.scrollBy(0, innerHeight * 0.85);
      });
      await wait(1400);
    }
    await store.sourceProgress(
      pool,
      run.id,
      owner,
      [],
      {
        discoveryFinished: true,
        message: `Visible-list scan finished with ${run.data.queued} queued. The source stopped loading or reached this run’s page budget; this is not a claim that every profile was inspected.`,
      },
      true,
    );
    return { done: true };
  } catch (error) {
    if (blocked) {
      await store.pauseAccount(pool, run.account_id, blocked);
      return { paused: blocked };
    }
    await store.sourceProgress(
      pool,
      run.id,
      owner,
      [],
      {
        discoveryFinished: true,
        message:
          "Discovery stopped: " +
          String(error.message).slice(0, 250) +
          ". Collected profiles remain saved.",
      },
      true,
    );
    return { error: true };
  } finally {
    page.off("response", watch);
  }
}
async function finish(pool, owner, job, result) {
  if (!(await store.runIsActive(pool, job.prospecting.runId)))
    return { status: "CANCELLED" };
  if (result.status === "ERROR")
    return { status: "ERROR", failure: result.failure, logs: result.logs };
  // Reuse captured profile evidence. Website research runs without holding or revisiting LinkedIn.
  let research = result.prospectQualification?.research;
  if (!research)
    research = await researchProspect(
      { ...result, linkedinUrl: result.url },
      { ai: false, maxPages: 8, maxTimeMs: 30000 },
    );
  const saved = await store.finishProfile(
    pool,
    { ...job, owner },
    result,
    research,
  );
  return {
    ...result,
    ...saved,
    firstName: result.firstName || "",
    url: result.url,
    headline: result.headline,
    about: result.about,
    profileIdentityConfirmed: result.profileIdentityConfirmed,
    linkedinContact: result.linkedinContact,
    emails: result.emails || [],
    website: research.website,
    prospectQualification: { research },
    logs: result.logs || [],
  };
}
module.exports = { discover, finish, restriction };

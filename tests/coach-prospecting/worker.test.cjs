"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const store = require("../../src/lib/coach-prospecting-store.cjs"),
  worker = require("../../src/lib/coach-prospecting-worker.cjs");
const run = {
  id: "fixture-run",
  account_id: "fixture-account",
  source: "CONNECTION",
  data: { sourceUrl: "", pages: 0, seen: [], limit: 1, queued: 0, skipped: 0 },
};
function page(status, text = "") {
  const calls = { reads: 0, scrolls: 0 };
  return {
    calls,
    on() {},
    off() {},
    goto: async () => ({ status: () => status }),
    waitForSelector: async () => {},
    evaluate: async () => {
      calls.reads++;
      return {
        url: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
        text,
        urls: ["https://www.linkedin.com/in/unconventional-headline/"],
      };
    },
  };
}
test("a LinkedIn limit or security check pauses discovery before profiles are queued or another list pass occurs", async () => {
  const oldPause = store.pauseAccount,
    oldProgress = store.sourceProgress;
  let paused = 0;
  try {
    store.pauseAccount = async () => {
      paused++;
    };
    store.sourceProgress = async () =>
      assert.fail("No new work after a LinkedIn restriction");
    for (const [status, text] of [
      [429, ""],
      [200, "Verify your identity"],
    ]) {
      const p = page(status, text);
      const result = await worker.discover(p, run, {
        pool: {},
        owner: "fixture",
      });
      assert.ok(result.paused);
      assert.equal(p.calls.reads, 1);
    }
    assert.equal(paused, 2);
  } finally {
    store.pauseAccount = oldPause;
    store.sourceProgress = oldProgress;
  }
});
test("discovery passes all visible candidates to evidence research and stops immediately on cancellation or target completion", async () => {
  const original = store.sourceProgress;
  try {
    for (const cancelled of [false, true]) {
      let seen;
      store.sourceProgress = async (_pool, _id, _owner, urls) => {
        seen = urls;
        return cancelled
          ? null
          : { ...run, status: "QUEUED", data: { ...run.data, queued: 1 } };
      };
      const p = page(200);
      const result = await worker.discover(p, run, {
        pool: {},
        owner: "fixture",
      });
      assert.equal(p.calls.reads, 1);
      assert.deepEqual(seen, [
        "https://www.linkedin.com/in/unconventional-headline/",
      ]);
      assert.ok(cancelled ? result.stopped : result.done);
    }
  } finally {
    store.sourceProgress = original;
  }
});
test("the actual worker browser-fetch guard is sticky after a rate limit; no further request is made", async () => {
  const source = fs.readFileSync(require.resolve("../../worker.cjs"), "utf8");
  const start = source.indexOf("async function voyagerFetch("),
    end = source.indexOf("function requireLinkedInResponse(", start);
  const context = vm.createContext({
    prospectingContext: true,
    prospectingFailure: null,
    AbortSignal,
  });
  const fetch = vm.runInContext(
    source.slice(start, end) + ";voyagerFetch",
    context,
  );
  let calls = 0;
  const p = {
    evaluate: async () => {
      calls++;
      return { status: 429 };
    },
  };
  await assert.rejects(
    fetch(p, "/fixture"),
    (e) => e.failure.code === "LINKEDIN_RATE_LIMIT",
  );
  await assert.rejects(
    fetch(p, "/another-fixture"),
    (e) => e.failure.code === "LINKEDIN_RATE_LIMIT",
  );
  assert.equal(calls, 1);
});

test("history normalization preserves LinkedIn prospecting outcomes without applying the email qualification gate", () => {
  const source = fs.readFileSync(
    require.resolve("../../src/lib/linkedin-workers.cjs"),
    "utf8",
  );
  const start = source.indexOf("function normalizeResult("),
    end = source.indexOf("async function importResult(", start);
  const normalize = vm.runInNewContext(
    source.slice(start, end) + ";normalizeResult",
    {
      require: () =>
        assert.fail(
          "The email pipeline must not process a LinkedIn shortlist result.",
        ),
    },
  );
  const result = {
    status: "PROSPECTED",
    emails: [],
    assessment: { status: "MATCH" },
    prospectQualification: { research: { facts: {} } },
  };
  assert.equal(normalize(result), result);
});

test("a forbidden optional profile request still stops the profile job instead of being swallowed by a fallback", async () => {
  const source = fs.readFileSync(require.resolve("../../worker.cjs"), "utf8");
  const fetchStart = source.indexOf("async function voyagerFetch("),
    fetchEnd = source.indexOf("function requireLinkedInResponse(", fetchStart);
  const scrapeStart = source.indexOf("async function scrapeProfile("),
    scrapeEnd = source.indexOf(
      "async function enrichAndFinalize(",
      scrapeStart,
    );
  const context = vm.createContext({
    prospectingContext: true,
    prospectingFailure: null,
    ACCOUNT_ID: "fixture-account",
    AbortSignal,
    requireLinkedInResponse: () => {},
    extractProfileContactInfo: () => ({}),
    extractMatchingProfile: () => ({
      firstName: "Fixture",
      headline: "Career coach",
    }),
    extractProfileLocation: () => "",
    profileContactEvidence: () => ({}),
    publishedProfileWebsites: () => [],
    jitter: async () => {},
    sleep: async () => {},
    failureOf: () => assert.fail("Keep the structured restriction reason."),
  });
  const scrape = vm.runInContext(
    source.slice(fetchStart, fetchEnd) +
      source.slice(scrapeStart, scrapeEnd) +
      ";scrapeProfile",
    context,
  );
  let calls = 0;
  const p = {
    evaluate: async () => ({ status: ++calls === 3 ? 403 : 200, data: {} }),
  };
  const result = await scrape(p, "https://www.linkedin.com/in/fixture/", null);
  assert.equal(result.status, "ERROR");
  assert.equal(result.failure.code, "LINKEDIN_AUTH");
  assert.equal(calls, 3);
});
test("source URLs reject unrelated hosts, credentials, non-HTTPS and non-people search pages", () => {
  assert.equal(
    store.sourceUrl(
      "SEARCH",
      "https://www.linkedin.com/search/results/people/?keywords=career%20coach",
    ),
    "https://www.linkedin.com/search/results/people/?keywords=career%20coach",
  );
  for (const url of [
    "https://evil.test/search/results/people/",
    "http://www.linkedin.com/search/results/people/",
    "https://name:secret@www.linkedin.com/search/results/people/",
    "https://www.linkedin.com/messaging/",
  ])
    assert.throws(() => store.sourceUrl("SEARCH", url));
});

import { z } from 'zod';
import { domain } from './policy';
import { documentUrl, PublicFailure } from './public-web';

const feedRecord = z.object({ title: z.string().trim().min(1).max(90), url: z.string().url(), permission: z.string().url(),
  publisher: z.string().trim().min(1).max(100).optional() }).strict();
export type PublisherFeed = z.infer<typeof feedRecord>;

export function parseFeeds(value: unknown): PublisherFeed[] {
  try {
    const feeds = z.array(feedRecord).max(6).parse(value).map(feed => ({ ...feed, publisher: feed.publisher?.toLowerCase(),
      url: documentUrl(feed.url).href, permission: documentUrl(feed.permission).href }));
    if (new Set(feeds.map(feed => feed.url)).size !== feeds.length || new Set(feeds.map(feed => feed.title)).size !== feeds.length) throw new Error();
    return feeds;
  } catch { throw new PublicFailure('INVALID_FEED_CONFIGURATION'); }
}

export function approvedFeeds(saved?: unknown): PublisherFeed[] {
  if (saved != null) return parseFeeds(saved);
  try { return parseFeeds(JSON.parse(process.env.ORIGIN_APPROVED_FEEDS || '[]')); }
  catch { throw new PublicFailure('INVALID_FEED_CONFIGURATION'); }
}

export function independentFeedCount(feeds: PublisherFeed[]) {
  const owners = new Set<string>();
  const hosts = new Set<string>();
  for (const feed of feeds) {
    const host = domain(feed.url);
    const owner = feed.publisher ?? host;
    if (hosts.has(host) || owners.has(owner)) continue;
    hosts.add(host);
    owners.add(owner);
  }
  return owners.size;
}

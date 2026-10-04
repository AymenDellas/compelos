import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import * as cheerio from 'cheerio';
import type { Source } from '../shared/contracts';
import { AppError } from './errors';

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

export function validateSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, 'Enter a complete URL starting with https://.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new AppError(
      400,
      'Use a public HTTP or HTTPS page without credentials or a custom port.',
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (ipaddr.isValid(host) && !isPublicAddress(host))
  ) {
    throw new AppError(
      400,
      'Only public websites can be imported. Local and private network addresses are not allowed.',
    );
  }
  return url;
}

async function fetchPage(
  url: URL,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ html: string; url: URL }> {
  signal.throwIfAborted();
  if (redirects > 4)
    throw new AppError(422, 'This page redirected too many times. Paste its visible copy instead.');
  validateSourceUrl(url.href);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new AppError(400, 'This URL resolves to a private or unsupported network address.');
  const address = addresses[0];
  // Pin the connection to the address we validated, preventing a second DNS lookup/rebinding.
  const fetched = await new Promise<{ html: string; redirect?: string }>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(
      url,
      {
        signal,
        agent: false,
        family: address.family,
        lookup: ((_host: string, _options: unknown, callback: (...args: unknown[]) => void) =>
          callback(null, address.address, address.family)) as never,
        headers: {
          'User-Agent': 'CopyStudio/2.0 (public-page import)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity',
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          const redirect = response.headers.location;
          response.destroy();
          if (!redirect) return reject(new AppError(422, 'The page returned an invalid redirect.'));
          return resolve({ html: '', redirect });
        }
        if ((response.statusCode ?? 500) >= 400) {
          response.destroy();
          return reject(
            new AppError(
              422,
              `The website returned ${response.statusCode}. It may block automated access. Paste its visible copy instead.`,
            ),
          );
        }
        if (!/text\/html|application\/xhtml\+xml/i.test(String(response.headers['content-type']))) {
          response.destroy();
          return reject(
            new AppError(422, 'This URL is not an HTML page. Paste the relevant text instead.'),
          );
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2_000_000) {
            response.destroy();
            reject(
              new AppError(
                422,
                'This page is too large to import. Paste the relevant copy instead.',
              ),
            );
          } else chunks.push(chunk);
        });
        response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
        response.on('aborted', () =>
          reject(
            new AppError(422, 'The website closed the connection. Please retry or paste its copy.'),
          ),
        );
      },
    );
    request.on('error', reject);
  });
  if (fetched.redirect) return fetchPage(new URL(fetched.redirect, url), signal, redirects + 1);
  return { html: fetched.html, url };
}

export function parsePage(html: string, url: string): Source {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim().slice(0, 300);
  const description = $('meta[name="description"]').attr('content') ?? '';
  $(
    'script,style,noscript,svg,iframe,nav,footer,[hidden],[aria-hidden="true"],input[type="hidden"]',
  ).remove();
  const headings = $('h1,h2,h3')
    .map((_, e) => $(e).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 60);
  $('br').replaceWith('\n');
  $('p,div,section,article,li,h1,h2,h3,h4,button,a,label').each((_, e) => {
    $(e).append('\n');
  });
  const body = $('body')
    .text()
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: title || new URL(url).hostname,
    url,
    headings,
    text: [title, description, body].filter(Boolean).join('\n\n').slice(0, 24000),
  };
}

export async function readSource(value: string, parentSignal: AbortSignal): Promise<Source> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(20000)]);
  try {
    const fetched = await fetchPage(validateSourceUrl(value), signal);
    const source = parsePage(fetched.html, fetched.url.href);
    if (source.text.length < 180)
      throw new AppError(
        422,
        'This page exposes very little readable copy. It may require JavaScript or a login. Copy the visible page text into “Paste text” instead.',
      );
    return source;
  } catch (error) {
    if (error instanceof AppError || signal.aborted) throw error;
    throw new AppError(
      422,
      'The website could not be read. Check the URL or paste the visible page copy instead.',
    );
  }
}

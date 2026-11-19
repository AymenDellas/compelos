import { z } from 'zod';
import { relevantCoach } from './discovery';
import { hash } from './policy';
import type { Seed } from './policy';
import { documentUrl, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';

const tender = 'www.find-tender.service.gov.uk';
const contractsFinder = 'www.contractsfinder.service.gov.uk';
const licence = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
const credit = 'Contains public sector information licensed under the Open Government Licence v3.0';
export const procurementAdapter = 'Contracts Finder · UK coaching awards';
export const tenderAdapter = 'Find a Tender · UK coaching awards';
export const procurementCredit = `${credit} · ${licence}`;
const party = z.object({ id: z.string(), name: z.string(), roles: z.array(z.string()).optional(),
  details: z.object({ url: z.string().optional() }).optional(), contactPoint: z.object({ url: z.string().optional() }).optional() });
const award = z.object({ status: z.string().optional(), title: z.string().optional(), date: z.string().optional(),
  suppliers: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
  value: z.object({ amount: z.number().optional(), currency: z.string().optional() }).optional() });
const packageSchema = z.object({ license: z.string(), releases: z.array(z.object({ id: z.string(), date: z.string(), ocid: z.string(),
  tender: z.object({ title: z.string().optional(), description: z.string().optional() }).optional(), buyer: z.object({ name: z.string().optional() }).optional(),
  awards: z.array(award).optional(), parties: z.array(party).optional(),
})).max(100) });

function releaseSeeds(contents: unknown, from: string) {
  const parsed = packageSchema.safeParse(contents);
  if (!parsed.success || !/^https?:\/\/www\.nationalarchives\.gov\.uk\/doc\/open-government-licence\/version\/3\/?$/i.test(parsed.data.license)) {
    throw new PublicFailure('OPEN_DATA_UNVERIFIED');
  }
  return parsed.data.releases.flatMap(release => {
    const published = Date.parse(release.date);
    if (!Number.isFinite(published) || published > Date.now() || published < Date.now() - 365 * 86_400_000) return [];
    return (release.awards ?? []).flatMap(item => {
      if (item.status !== 'active' || !relevantCoach.test(`${item.title ?? ''} ${release.tender?.title ?? ''} ${release.tender?.description?.slice(0, 5000) ?? ''}`) ||
        item.suppliers?.length !== 1) return [];
      const supplier = release.parties?.find(record => record.id === item.suppliers![0].id && record.roles?.includes('supplier'));
      if (!supplier || supplier.name.length > 120 || !/\b(?:ltd|limited|llp|plc|llc|inc|cic)\.?$/i.test(supplier.name.trim())) return [];
      let website: URL;
      try { website = documentUrl(supplier.details?.url || supplier.contactPoint?.url || ''); }
      catch { return []; }
      if (/\.(?:gov\.uk|gov|mil)$/.test(website.hostname) || website.hostname.endsWith('.service.gov.uk')) return [];
      const source = from === tender && /^\d{6}-\d{4}$/.test(release.id)
        ? `https://${tender}/api/1.0/ocdsReleasePackages/${release.id}`
        : from === contractsFinder && /^ocds-[a-z\d-]+$/i.test(release.ocid) ? `https://${from}/Published/Notice/Releases/${release.ocid}.json` : null;
      if (!source) return [];
      const awardTitle = item.title || release.tender?.title || '';
      const value = item.value?.currency === 'GBP' && typeof item.value.amount === 'number' && item.value.amount >= 3_000 &&
        relevantCoach.test(awardTitle) && !/\b(?:framework|dynamic market)\b/i.test(awardTitle) && release.buyer?.name?.trim() ? item.value.amount : undefined;
      const seed: Seed = { method: 'PROCUREMENT', name: supplier.name.trim(), website: website.href, source, permission: licence,
        sourceKey: `uk-award:${hash(`${from}:${release.id}:${supplier.id}`)}`, discoveryPriority: 18,
        excerpt: `The public award identifies ${supplier.name.trim()} as supplier of a coaching engagement.${value === undefined ? '' : ` Award value GBP ${value}.`} ${credit}.`,
        ...(value === undefined || from !== contractsFinder ? {} : { contract: { amountGbp: value, awardedOn: new Date(published).toISOString(), buyer: release.buyer?.name?.slice(0, 120) } }),
      };
      return [seed];
    });
  });
}

export async function coachingContracts(web: PublicWeb, index: 'contracts' | 'tender', windowDays: number, limit: number, signal: AbortSignal) {
  const to = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const host = index === 'contracts' ? contractsFinder : tender;
  const path = index === 'contracts' ? '/Published/Notices/OCDS/Search' : '/api/1.0/ocdsReleasePackages';
  const parameters = new URLSearchParams(index === 'contracts' ? { stages: 'award', limit: '28', publishedTo: `${to}T23:59:59Z` }
    : { limit: '40', updatedTo: `${to}T23:59:59` });
  return releaseSeeds(await web.api(`https://${host}${path}?${parameters}`, host, signal), host).slice(0, limit);
}

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),clock=require('../../src/lib/clock-reference.cjs'),policy=require('../../src/lib/account-session-policy.cjs');

test('the pinned IANA reference covers the 2026 Casablanca change and its earlier Ramadan transitions',()=>{
 assert.equal(clock.VERSION,'IANA_TZDB_2026f');
 // IANA africa: the September change takes effect at 02:00 local UTC+1.
 for(const [at,offset]of [
  ['2026-02-15T01:59:59.999Z',-60],['2026-02-15T02:00:00Z',0],
  ['2026-03-22T01:59:59.999Z',0],['2026-03-22T02:00:00Z',-60],
  ['2026-09-20T00:59:59.999Z',-60],['2026-09-20T01:00:00Z',0],['2026-10-29T12:00:00Z',0],
 ]){assert.equal(clock.offsetMinutes('Africa/Casablanca',at),offset,at);assert.equal(policy.clockVerdict({timezone:'Africa/Casablanca',timezoneOffsetMinutes:offset,timezoneIntlOffsetMinutes:offset},'Africa/Casablanca',Date.parse(at)).verdict,'PASS',at);}
});

test('the reference is general timezone data, including DST boundaries, fractional offsets and recent Canadian changes',()=>{
 for(const [zone,at,offset]of [
  ['America/New_York','2026-03-08T06:59:59Z',300],['America/New_York','2026-03-08T07:00:00Z',240],
  ['America/New_York','2026-11-01T05:59:59Z',240],['America/New_York','2026-11-01T06:00:00Z',300],
  ['Europe/London','2026-10-25T00:59:59Z',-60],['Europe/London','2026-10-25T01:00:00Z',0],
  ['Asia/Kathmandu','2026-10-29T12:00:00Z',-345],['UTC','2026-10-29T12:00:00Z',0],
  ['America/Winnipeg','2026-11-02T12:00:00Z',300],['America/Havana','2026-11-02T12:00:00Z',240],
 ])assert.equal(clock.offsetMinutes(zone,at),offset,zone+' '+at);
});

test('unknown zones and invalid instants do not create a passing clock result',()=>{
 for(const zone of [undefined,'','Definitely/Not_A_Zone'])assert.equal(clock.offsetMinutes(zone,Date.now()),null);
 assert.equal(clock.offsetMinutes('UTC','invalid date'),null);
 assert.equal(policy.clockVerdict({timezone:'Definitely/Not_A_Zone',timezoneOffsetMinutes:0,timezoneIntlOffsetMinutes:0},'Definitely/Not_A_Zone').verdict,'UNKNOWN');
});

'use strict';
// Use packaged IANA rules instead of the host's potentially stale ICU rules.
// Node 22.14.0 ships tzdb 2024b: it incorrectly expects UTC+1 for Casablanca
// after the 2026-09-20 move to UTC+0. Never change the browser to match that.
const timezone=require('moment-timezone');
const VERSION='IANA_TZDB_'+timezone.tz.dataVersion;
function offsetMinutes(zone,at=Date.now()){
 if(typeof zone!=='string'||!zone)return null;
 const timestamp=new Date(at).getTime(),rules=timezone.tz.zone(zone);
 if(!Number.isFinite(timestamp)||!rules)return null;
 const offset=rules.utcOffset(timestamp);
 return Number.isFinite(offset)?offset: null;
}
module.exports={VERSION,offsetMinutes};

'use strict';
// Explicit anonymous diagnostic only. No mapped profile or account processing.
require('./engine-worker-target-comparison.cjs').main({variant:'contexts'}).catch(error=>{
 console.error(error.code||error.name,error.failure?.reason||error.message);process.exitCode=1;
});

'use strict';

require('@next/env').loadEnvConfig(__dirname);
require('tsx/cjs/api').require('./scripts/origin.ts', __filename);

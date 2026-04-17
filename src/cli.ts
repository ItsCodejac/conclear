#!/usr/bin/env node

import { startServer, PORT } from './server/index.js';
import open from 'open';

const url = `http://localhost:${PORT}`;

process.env.NODE_ENV = 'production';

console.log('Starting ConClear...');

startServer().then(() => {
  console.log(`Opening ${url} in your browser...`);
  open(url);
});

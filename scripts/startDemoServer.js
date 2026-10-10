if (process.env.NODE_ENV === 'production' && process.env.TURFCAST_DEMO_ALLOW_PRODUCTION !== 'true') {
  throw new Error('The exhibition demo launcher refuses production mode.');
}

process.env.TURFCAST_DEMO_MODE = 'true';
process.env.PORT = '4174';

await import('../server.js');

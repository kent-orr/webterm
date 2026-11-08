'use strict';
// Serves the repo over http so pages can load the bundled fonts.
//   npm run serve [port]
const { startServer } = require('../test/lib/server');

const want = Number(process.argv[2] || process.env.PORT || 8080);
startServer(want).then(({ origin }) => {
  // The index links the rest, so one URL is all this needs to print.
  process.stdout.write(`webterm: ${origin}/test/\n`);
});

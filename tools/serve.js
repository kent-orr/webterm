'use strict';
// Serves the repo over http so pages can load the bundled fonts.
//   npm run serve [port]
const { startServer } = require('../test/lib/server');

const want = Number(process.argv[2] || process.env.PORT || 8080);
startServer(want).then(({ origin }) => {
  process.stdout.write(`webterm: ${origin}/test/components.html\n`);
});

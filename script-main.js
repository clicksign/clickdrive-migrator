#!/usr/bin/env node

const { main } = require('./src/cli');

main(process.argv)
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((err) => {
    console.error(`Erro inesperado: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });

#!/usr/bin/env node
'use strict';

const _ = require('lodash');
const B = require('bluebird');
const csv = require('fast-csv');
const fs = require('fs-extra');
const licenseChecker = require('license-checker');
const licenseCheck = B.promisify(licenseChecker.init);
const path = require('path');
const program = require('commander');

program
  .description('Check licenses for each repo')
  .usage('cloneInstall.js --token xxx123 [--repos "gangstead/repo1, gangstead/repo2"]|[--file repos.json|repos.csv]')
  .option('--repos [repos]', 'comma separated list of repos')
  .option('--file [repos]', '.json (json array) or .csv extension (must contain column "repo")', /^(.+\.(json|csv))$/i)
  .option('--dest [PWD]', 'Target folder to clone into', __dirname)
  .parse(process.argv);

if (!(program.repos || program.file)) {
  program.help();
}

const stats = {
  _stats: {},
  inc: (stat) => {
    if (stats._stats[stat]) {
      stats._stats[stat]++;
    } else {
      stats._stats[stat] = 1;
    }
  },
  set: (stat, val) => {
    stats._stats[stat] = val;
  }
};

new B((resolve, reject) => {
  const rows = [];
  if (program.repos) {
    console.info('Adding repos from param ');
    return resolve(_.map(_.split(program.repos, ','), (r) => ({ repo: r.trim() })));
  } else if (program.file.match(/\.json$/i)) {
    console.info('Reading json file');
    const readFile = B.promisify(require('fs').readFile);
    return readFile(program.file)
      .then((contents) => JSON.parse(contents))
      .then((repoArray) => _.map(repoArray, (repo) => ({ repo })))
      .then((repos) => resolve(repos));
  } else if (program.file.match(/\.csv$/i)) {
    console.info('Reading csv file');
    csv.fromPath(program.file, { headers: true })
      .on('data', (data) => {
        stats.inc('csvRows');
        rows.push(data);
      })
      .on('end', () => {
        console.info('CSV parse done', rows.length);
        resolve(rows);
      });
  } else {
    return reject('Unable to read input from file or parameter');
  }
})
.map((row) => {
  // Check to see if the destination folder already exists
  const repoName = row.repo.substring(row.repo.lastIndexOf(path.sep));
  const repoPath = path.join(program.dest, repoName);
  return fs.pathExists(repoPath)
    .then((exists) => _.merge(row, {
      alreadyExists: exists,
      repoPath
    }));
})
.mapSeries((row) => {
  // Check licenses
  if (!row.alreadyExists) {
    console.info(`${row.repo} skipped, folder not found`);
    stats.inc('doesNotExist');
    return row;
  }
  console.info(`${row.repo} checking licenses`);
  return licenseCheck({
    start: row.repoPath
  })
  .catch(() => _.merge(row, { licenses: 'UNKNOWN' }))
  .tap(() => console.info(`${row.repo} license check complete`))
  .then((licenses) => _.merge(row, { licenses }));
})
.then((results) => {
  // console.info(results, stats._stats)
  _.map(results, (r) => {
    console.log(r.repo,",,");
    console.log(licenseChecker.asCSV(r.licenses))
  })
});

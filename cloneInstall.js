#!/usr/bin/env node
'use strict';

const _ = require('lodash');
const B = require('bluebird');
const csv = require('fast-csv');
const exec = require('child_process').exec;
const fs = require('fs-extra');
const path = require('path');
const program = require('commander');

program
  .description('Clone a list of github repos and run npm install on each one')
  .usage('cloneInstall.js --token xxx123 [--repos "gangstead/repo1, gangstead/repo2"]|[--file repos.json|repos.csv]')
  .option('--repos [repos]', 'comma separated list of repos')
  .option('--file [repos]', '.json (json array) or .csv extension (must contain column "repo")', /^(.+\.(json|csv))$/i)
  .option('--dest [PWD]', 'Target folder to clone into', __dirname)
  .option('--token [token]', 'github oauth or personal access token REQUIRED')
  .parse(process.argv);

if (!program.token) {
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
  // Clone if necessary
  if (row.alreadyExists) {
    console.info(`${row.repo} already exists, not cloning`);
    stats.inc('alreadyExistsLocally');
    return row;
  }
  console.info(`${row.repo} cloning`);
  return new B((resolve) => {
    const child = exec(`git clone https://github.com/${row.repo}.git`, {
      cwd: program.dest
    });
    child.stdout.on('data', console.info);
    child.on('close', (code) => {
      console.info(code);
      stats.inc('gitClone');
      return resolve(_.set(row, 'git', 'cloned'));
    });
  });
})
.mapSeries((row) => {
  // Npm install
  return B.join(
    fs.pathExists(path.join(row.repoPath, 'package.json')),
    fs.pathExists(path.join(row.repoPath, 'node_modules')),
    fs.pathExists(path.join(row.repoPath, 'server', 'package.json')),
    fs.pathExists(path.join(row.repoPath, 'server', 'node_modules'))
  )
  .spread((isNode, isReady, isNodeServer, isReadyServer) => {
    _.merge(row, {
      isNode,
      isReady,
      isNodeServer,
      isReadyServer
    });
    if ((isNode && !isReady) || (isNodeServer && !isReadyServer)) {
      console.info(`NPM install for ${row.repo}`);
      return new B((resolve) => {
        const child = exec('npm install', {
          cwd: path.join(row.repoPath, isNodeServer ? 'server' : '')
        });
        child.stdout.on('data', console.info);
        child.on('close', (code) => {
          console.info(code);
          stats.inc('npmInstall');
          return resolve(_.set(row, 'npm', 'installed'));
        });
      });
    }
    return _.set(row, 'npm', 'skipped');
  });
})
.then((results) => console.info(results, stats._stats));

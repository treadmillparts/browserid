#!/usr/bin/env node

const
spawn = require('child_process').spawn,
path = require('path'),
config = require('../lib/configuration.js'),
temp = require('temp'),
secrets = require('../lib/secrets.js');

exports.daemons = daemons = {};

const HOST = process.env['IP_ADDRESS'] || process.env['HOST'] || "127.0.0.1";

var daemonsToRun = {
  verifier: {
    PORT: 10000,
    HOST: HOST
  },
  keysigner: {
    PORT: 10003,
    HOST: HOST
  },
  dbwriter: {
    PORT: 10004,
    HOST: HOST
  },
  example: {
    path: path.join(__dirname, "..", "scripts", "serve_example.js"),
    PORT: 10001,
    HOST: HOST
  },
  example_primary: {
    SHIMMED_DOMAIN: "example.domain",
    path: path.join(__dirname, "..", "scripts", "serve_example_primary.js"),
    PORT: 10005,
    HOST: HOST
  },
  browserid: {
    PORT: 10002,
    HOST: HOST
  }
};

// all spawned process that use handle primaries should know about "shimmed"
// primaries
process.env['SHIMMED_PRIMARIES'] = "example.domain|http://" + HOST + ":10005|" + path.join(__dirname, "..", "example", "primary", ".well-known", "vep");

// all spawned processes should log to console
process.env['LOG_TO_CONSOLE'] = 1;

// all spawned processes will communicate with the local browserid
process.env['DBWRITER_URL'] = 'http://' + HOST + ":10004";
process.env['BROWSERID_URL'] = 'http://' + HOST + ":10002";
process.env['VERIFIER_URL'] = 'http://' + HOST + ":10000/verify";
process.env['KEYSIGNER_URL'] = 'http://' + HOST + ":10003";

// if the environment is a 'test_' environment, then we'll use an
// ephemeral database
if (config.get('env').substr(0,5) === 'test_') {
  if (config.get('database').driver === 'mysql') {
    process.env['MYSQL_DATABASE_NAME'] =
      process.env['MYSQL_DATABASE_NAME'] ||"browserid_tmp_" + secrets.generate(6);
    console.log("temp mysql database:", process.env['MYSQL_DATABASE_NAME']);
  } else if (config.get('database').driver === 'json') {
    process.env['JSON_DATABASE_PATH'] =  process.env['JSON_DATABASE_PATH'] || temp.path({suffix: '.db'});
    console.log("temp json database:", process.env['JSON_DATABASE_PATH']);
  }
}

function runDaemon(daemon, cb) {
  Object.keys(daemonsToRun[daemon]).forEach(function(ek) {
    process.env[ek] = daemonsToRun[daemon][ek];
  });
  var pathToScript = daemonsToRun[daemon].path || path.join(__dirname, "..", "bin", daemon);
  var p = spawn('node', [ pathToScript ]);

  function dump(d) {
    d.toString().split('\n').forEach(function(d) {
      if (d.length === 0) return;
      console.log(daemon, '(' + p.pid + '):', d);

      // when we find a line that looks like 'running on <url>' then we've
      // fully started up and can run the next daemon.  see issue #556
      if (cb && /^.*running on http:\/\/.*:[0-9]+$/.test(d)) {
        cb();
        cb = undefined;
      }
    });
  }

  p.stdout.on('data', dump);
  p.stderr.on('data', dump);

  console.log("spawned", daemon, "("+pathToScript+") with pid", p.pid);
  Object.keys(daemonsToRun[daemon]).forEach(function(ek) {
    delete process.env[ek];
  });

  daemons[daemon] = p;

  p.on('exit', function (code, signal) {
    console.log(daemon, 'exited(' + code + ') ', (signal ? 'on signal ' + signal : ""));
    delete daemons[daemon];
    Object.keys(daemons).forEach(function (daemon) { daemons[daemon].kill(); });
    if (Object.keys(daemons).length === 0) {
      console.log("all daemons torn down, exiting...");
    }
  });
};

var daemonNames = Object.keys(daemonsToRun);
function runNextDaemon() {
  if (daemonNames.length) runDaemon(daemonNames.shift(), runNextDaemon);
}
runNextDaemon();

process.on('SIGINT', function () {
  console.log('\nSIGINT recieved! trying to shut down gracefully...');
  Object.keys(daemons).forEach(function (k) { daemons[k].kill('SIGINT'); });
});

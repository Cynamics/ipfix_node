const { parentPort, workerData } = require('node:worker_threads');
const scenarios = require('./scenarios');

// The deserializer does not log: what it leaves undecoded is listed on the packet. A scenario in which it writes a
// warning or an error fails.
const logs = [];
for (const level of ['warn', 'error']) {
    console[level] = (...args) => logs.push(`console.${level}: ${args.map(String).join(' ').split('\n')[0]}`);
}

scenarios[workerData]().then(
    result => parentPort.postMessage(logs.length ? { error: `the deserializer logged: ${logs.join(' | ')}` } : { result }),
    error => parentPort.postMessage({ error: error.message }),
);

const { parentPort, workerData } = require('node:worker_threads');
const scenarios = require('./scenarios');

scenarios[workerData]().then(
    result => parentPort.postMessage({ result }),
    error => parentPort.postMessage({ error: error.message }),
);

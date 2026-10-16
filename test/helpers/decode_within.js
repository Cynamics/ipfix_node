const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Runs a scenario in a worker thread with a small heap and a deadline: a decoder that never returns, or that
// fills memory, fails the test instead of hanging the runner
module.exports = (scenario, milliseconds = 3000) => new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'run_scenario.js'), {
        workerData: scenario,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        stderr: true,
    });
    const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`decoding did not finish within ${milliseconds} ms`));
    }, milliseconds);
    worker.once('message', ({ result, error }) => {
        clearTimeout(timer);
        worker.terminate();
        if (error) {
            reject(new Error(error));
        } else {
            resolve(result);
        }
    });
    worker.once('error', error => {
        clearTimeout(timer);
        reject(error);
    });
});

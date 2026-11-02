const inspector = require('node:inspector');

// How many exceptions a run raises, those the code catches itself included: through the debugger, because a caught
// exception leaves no other trace and costs far more than the record it was raised for
module.exports = async run => {
    const session = new inspector.Session();
    session.connect();
    let raised = 0;
    session.on('Debugger.paused', () => {
        raised += 1;
        session.post('Debugger.resume');
    });
    session.post('Debugger.enable');
    session.post('Debugger.setPauseOnExceptions', { state: 'all' });
    try {
        await run();
    } finally {
        session.post('Debugger.setPauseOnExceptions', { state: 'none' });
        session.disconnect();
    }

    return raised;
};

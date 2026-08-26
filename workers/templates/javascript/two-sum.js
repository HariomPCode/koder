const readline = require('readline');

/***USER_CODE***/

function runTestCase(rawInput) {
    const lines = rawInput.trim().split('\n');
    if (lines.length < 3) return "";
    const n = +lines[0];
    const nums = lines[1].split(' ').map(Number);
    const target = +lines[2];

    const ans = twoSum(nums, target);
    return Array.isArray(ans) ? ans.join(' ') : String(ans);
}

function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed === 'EXIT') {
            rl.close();
            process.exit(0);
        }

        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) return;

        const caseId = trimmed.substring(0, spaceIdx);
        const b64Input = trimmed.substring(spaceIdx + 1);
        let rawInput = '';
        try {
            rawInput = Buffer.from(b64Input, 'base64').toString('utf8');
        } catch (_) {
            rawInput = b64Input;
        }

        // Intercept user console output to protect judge protocol channel
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        const originalInfo = console.info;
        let userDebugOutput = '';

        console.log = (...args) => { userDebugOutput += args.map(String).join(' ') + '\n'; };
        console.error = (...args) => { userDebugOutput += args.map(String).join(' ') + '\n'; };
        console.warn = (...args) => { userDebugOutput += args.map(String).join(' ') + '\n'; };
        console.info = (...args) => { userDebugOutput += args.map(String).join(' ') + '\n'; };

        try {
            const output = runTestCase(rawInput);
            const b64Output = Buffer.from(String(output), 'utf8').toString('base64');
            process.stdout.write(`${caseId} OK ${b64Output}\n`);
        } catch (err) {
            const errMsg = err && err.stack ? err.stack : (err ? err.message : 'Runtime Error');
            const b64Err = Buffer.from(String(errMsg), 'utf8').toString('base64');
            process.stdout.write(`${caseId} ERROR ${b64Err}\n`);
        } finally {
            // Restore console methods
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
            console.info = originalInfo;
        }
    });
}

main();

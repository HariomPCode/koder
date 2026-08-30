
        const add = const add = (a,b) => a + b;;
        const input = require('fs').readFileSync(0, 'utf8').trim();
        const [a, b] = input.split(/\s+/).map(Number);
        process.stdout.write(String(add(a, b)));
      
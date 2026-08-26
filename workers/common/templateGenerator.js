/**
 * Generic Template Generator
 *
 * Dynamically generates protocol-safe runner harnesses for JavaScript and Java,
 * and standard starter code for user-facing editors.
 */

function toJavaType(type) {
  if (!type) return "Object";
  const t = type.trim();
  const lower = t.toLowerCase();

  if (lower === "int" || lower === "integer" || lower === "number") return "int";
  if (lower === "int[]" || lower === "integer[]" || lower === "number[]") return "int[]";
  if (lower === "long") return "long";
  if (lower === "long[]") return "long[]";
  if (lower === "double" || lower === "float") return "double";
  if (lower === "double[]" || lower === "float[]") return "double[]";
  if (lower === "string") return "String";
  if (lower === "string[]") return "String[]";
  if (lower === "boolean" || lower === "bool") return "boolean";
  if (lower === "boolean[]" || lower === "bool[]") return "boolean[]";
  if (lower === "char" || lower === "character") return "char";
  if (lower === "void") return "void";
  return t;
}

function toPythonType(type) {
  if (!type) return "Any";
  const lower = type.trim().toLowerCase();

  if (lower === "int" || lower === "integer" || lower === "number") return "int";
  if (lower === "int[]" || lower === "integer[]" || lower === "number[]") return "List[int]";
  if (lower === "long") return "int";
  if (lower === "long[]") return "List[int]";
  if (lower === "double" || lower === "float") return "float";
  if (lower === "double[]" || lower === "float[]") return "List[float]";
  if (lower === "string") return "str";
  if (lower === "string[]") return "List[str]";
  if (lower === "boolean" || lower === "bool") return "bool";
  if (lower === "boolean[]") return "List[bool]";
  return "Any";
}

/**
 * Generate starter code for different languages.
 */
function generateStarterCode(questionMeta) {
  const { functionName, parameters = [], returnType = "void" } = questionMeta;
  const paramNames = parameters.map((p) => p.name);

  // JavaScript starter code
  const jsStarter = `function ${functionName}(${paramNames.join(", ")}) {\n    // Write your code here\n    \n}`;

  // Java starter code
  const javaParams = parameters
    .map((p) => `${toJavaType(p.type)} ${p.name}`)
    .join(", ");
  const javaReturn = toJavaType(returnType);
  const javaStarter = `class Solution {\n    public ${javaReturn} ${functionName}(${javaParams}) {\n        // Write your code here\n        \n    }\n}`;

  // Python starter code
  const pyParams = parameters
    .map((p) => `${p.name}: ${toPythonType(p.type)}`)
    .join(", ");
  const pyReturn = toPythonType(returnType);
  const pyStarter = `class Solution:\n    def ${functionName}(self, ${pyParams}) -> ${pyReturn}:\n        pass\n`;

  return [
    { language: "javascript", code: jsStarter },
    { language: "java", code: javaStarter },
    { language: "python", code: pyStarter },
  ];
}

/**
 * Generates the full JavaScript runner source code for the submission.
 */
function generateJavaScriptRunner(questionMeta, userCode) {
  const { functionName, parameters = [] } = questionMeta;
  const paramDefsJson = JSON.stringify(parameters);

  return `const readline = require('readline');

// ==========================================
// USER SOLUTION
// ==========================================
${userCode}

// ==========================================
// RUNNER HARNESS & PROTOCOL DRIVER
// ==========================================
function parseInputValue(tokenOrLine, type) {
  const normType = (type || 'string').toLowerCase().trim();
  const trimmed = (tokenOrLine || '').trim();
  
  if (normType === 'int' || normType === 'integer' || normType === 'number') {
    return parseInt(trimmed, 10);
  }
  if (normType === 'double' || normType === 'float') {
    return parseFloat(trimmed);
  }
  if (normType === 'boolean' || normType === 'bool') {
    return trimmed.toLowerCase() === 'true' || trimmed === '1';
  }
  if (normType === 'string') {
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
  if (normType.includes('[]') || normType.startsWith('list') || normType.startsWith('array')) {
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (_) {}
    }
    const clean = trimmed.replace(/^[\[\]]/g, '').trim();
    if (!clean) return [];
    const items = clean.split(/[,\\s]+/).filter(Boolean);
    if (normType.includes('int') || normType.includes('number') || normType.includes('double') || normType.includes('float')) {
      return items.map(Number);
    }
    return items;
  }
  return trimmed;
}

function parseTestInput(rawInput, paramDefs) {
  const lines = rawInput.trim().split('\\n').map(l => l.trim()).filter(l => l.length > 0);
  if (paramDefs.length === 0) return [];
  
  const args = [];
  let lineIdx = 0;
  const allTokens = rawInput.trim().split(/\\s+/).filter(Boolean);
  let tokenIdx = 0;
  
  for (let i = 0; i < paramDefs.length; i++) {
    const pType = (paramDefs[i].type || 'string').toLowerCase();
    const isArray = pType.includes('[]') || pType.startsWith('list') || pType.startsWith('array');
    
    if (isArray) {
      if (lineIdx < lines.length && lines[lineIdx].startsWith('[')) {
        args.push(parseInputValue(lines[lineIdx], pType));
        lineIdx++;
      } else if (lineIdx < lines.length && /^\\d+$/.test(lines[lineIdx]) && (lineIdx + 1) < lines.length) {
        const len = parseInt(lines[lineIdx], 10);
        lineIdx++;
        const arrElements = lines[lineIdx].split(/\\s+/).filter(Boolean).map(Number);
        args.push(arrElements.slice(0, len));
        lineIdx++;
      } else if (lineIdx < lines.length && lines.length === paramDefs.length) {
        args.push(parseInputValue(lines[lineIdx], pType));
        lineIdx++;
      } else if (tokenIdx < allTokens.length && /^\\d+$/.test(allTokens[tokenIdx])) {
        const len = parseInt(allTokens[tokenIdx], 10);
        tokenIdx++;
        const arr = [];
        for (let k = 0; k < len && tokenIdx < allTokens.length; k++) {
          arr.push(Number(allTokens[tokenIdx++]));
        }
        args.push(arr);
      } else if (lineIdx < lines.length) {
        args.push(parseInputValue(lines[lineIdx], pType));
        lineIdx++;
      } else {
        args.push([]);
      }
    } else {
      if (lineIdx < lines.length) {
        args.push(parseInputValue(lines[lineIdx], pType));
        lineIdx++;
      } else if (tokenIdx < allTokens.length) {
        args.push(parseInputValue(allTokens[tokenIdx++], pType));
      } else {
        args.push(null);
      }
    }
  }
  return args;
}

function runTestCase(rawInput) {
  const paramDefs = ${paramDefsJson};
  const args = parseTestInput(rawInput, paramDefs);
  
  let targetFn = null;
  if (typeof ${functionName} === 'function') {
    targetFn = ${functionName};
  } else if (typeof Solution !== 'undefined' && typeof Solution.prototype?.${functionName} === 'function') {
    const s = new Solution();
    targetFn = s.${functionName}.bind(s);
  } else if (typeof Solution !== 'undefined' && typeof Solution.${functionName} === 'function') {
    targetFn = Solution.${functionName};
  } else {
    throw new Error('Function ${functionName} is not defined');
  }

  const ans = targetFn(...args);
  if (Array.isArray(ans)) {
    return ans.join(' ');
  }
  return ans !== undefined && ans !== null ? String(ans) : '';
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

    console.log = (...args) => { userDebugOutput += args.map(String).join(' ') + '\\n'; };
    console.error = (...args) => { userDebugOutput += args.map(String).join(' ') + '\\n'; };
    console.warn = (...args) => { userDebugOutput += args.map(String).join(' ') + '\\n'; };
    console.info = (...args) => { userDebugOutput += args.map(String).join(' ') + '\\n'; };

    try {
      const output = runTestCase(rawInput);
      const b64Output = Buffer.from(String(output), 'utf8').toString('base64');
      process.stdout.write(\`\${caseId} OK \${b64Output}\\n\`);
    } catch (err) {
      const errMsg = err && err.stack ? err.stack : (err ? err.message : 'Runtime Error');
      const b64Err = Buffer.from(String(errMsg), 'utf8').toString('base64');
      process.stdout.write(\`\${caseId} ERROR \${b64Err}\\n\`);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
    }
  });
}

main();
`;
}

/**
 * Wrap user Java code cleanly into class Solution and separate imports.
 */
function wrapJavaUserCode(userCode) {
  const lines = userCode.split("\n");
  const importLines = [];
  const bodyLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ") && trimmed.endsWith(";")) {
      importLines.push(trimmed);
    } else if (trimmed.startsWith("package ")) {
      // Ignore package declarations
    } else {
      bodyLines.push(line);
    }
  }

  const body = bodyLines.join("\n").trim();
  const imports = importLines.join("\n");

  let wrappedBody;
  if (body.includes("class Solution")) {
    wrappedBody = body;
  } else {
    wrappedBody = `class Solution {\n${body}\n}`;
  }

  return {
    imports,
    wrappedBody,
  };
}

/**
 * Generate Java parsing statements for parameters.
 */
function generateJavaArgParsing(parameters = []) {
  const statements = [];

  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i];
    const pType = toJavaType(p.type);
    const pName = p.name;

    if (pType === "int") {
      statements.push(`int ${pName} = sc.nextInt();`);
    } else if (pType === "long") {
      statements.push(`long ${pName} = sc.nextLong();`);
    } else if (pType === "double") {
      statements.push(`double ${pName} = sc.nextDouble();`);
    } else if (pType === "boolean") {
      statements.push(`boolean ${pName} = sc.nextBoolean();`);
    } else if (pType === "String") {
      statements.push(`String ${pName} = sc.nextString();`);
    } else if (pType === "char") {
      statements.push(`char ${pName} = sc.nextChar();`);
    } else if (pType === "int[]") {
      statements.push(`int[] ${pName} = sc.nextIntArray();`);
    } else if (pType === "long[]") {
      statements.push(`long[] ${pName} = sc.nextLongArray();`);
    } else if (pType === "double[]") {
      statements.push(`double[] ${pName} = sc.nextDoubleArray();`);
    } else if (pType === "String[]") {
      statements.push(`String[] ${pName} = sc.nextStringArray();`);
    } else {
      statements.push(`String ${pName} = sc.nextString();`);
    }
  }

  return statements.join("\n        ");
}

/**
 * Generate Java output formatting logic.
 */
function generateJavaOutputFormatting(returnType) {
  const javaType = toJavaType(returnType);

  if (
    javaType === "int[]" ||
    javaType === "long[]" ||
    javaType === "double[]" ||
    javaType === "String[]"
  ) {
    return `if (ans == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ans.length; i++) {
            if (i > 0) sb.append(" ");
            sb.append(ans[i]);
        }
        return sb.toString();`;
  }

  if (javaType === "boolean") {
    return `return String.valueOf(ans);`;
  }

  if (javaType === "String") {
    return `return ans == null ? "" : ans;`;
  }

  return `return String.valueOf(ans);`;
}

/**
 * Generates the full Java runner source code (Main.java) for the submission.
 */
function generateJavaRunner(questionMeta, userCode) {
  const { functionName, parameters = [], returnType = "void" } = questionMeta;
  const { imports, wrappedBody } = wrapJavaUserCode(userCode);
  const argParsingCode = generateJavaArgParsing(parameters);
  const paramNames = parameters.map((p) => p.name).join(", ");
  const outputFormattingCode = generateJavaOutputFormatting(returnType);
  const javaReturnType = toJavaType(returnType);

  return `import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
${imports}

// ==========================================
// USER SOLUTION
// ==========================================
${wrappedBody}

// ==========================================
// RUNNER HARNESS & PROTOCOL DRIVER
// ==========================================
public class Main {

    public static String runTestCase(String rawInput) throws Exception {
        FastScanner sc = new FastScanner(rawInput);
        if (!sc.hasNext()) return "";

        ${argParsingCode}

        Solution solver = new Solution();
        ${javaReturnType} ans = solver.${functionName}(${paramNames});

        ${outputFormattingCode}
    }

    public static void main(String[] args) {
        PrintStream protocolOut = System.out;
        PrintStream protocolErr = System.err;
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));

        ByteArrayOutputStream userOutSink = new ByteArrayOutputStream();
        PrintStream userOutCapture = new PrintStream(userOutSink, true, StandardCharsets.UTF_8);

        try {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) continue;
                if ("EXIT".equals(trimmed)) {
                    break;
                }

                int spaceIdx = trimmed.indexOf(' ');
                if (spaceIdx == -1) continue;

                String caseId = trimmed.substring(0, spaceIdx);
                String b64Input = trimmed.substring(spaceIdx + 1);

                String rawInput;
                try {
                    byte[] decodedBytes = Base64.getDecoder().decode(b64Input);
                    rawInput = new String(decodedBytes, StandardCharsets.UTF_8);
                } catch (Exception e) {
                    rawInput = b64Input;
                }

                // Redirect user stdout/stderr so user prints cannot corrupt the protocol stream
                userOutSink.reset();
                System.setOut(userOutCapture);
                System.setErr(userOutCapture);

                try {
                    String result = runTestCase(rawInput);
                    System.setOut(protocolOut);
                    System.setErr(protocolErr);

                    String b64Result = Base64.getEncoder().encodeToString(result.getBytes(StandardCharsets.UTF_8));
                    protocolOut.println(caseId + " OK " + b64Result);
                    protocolOut.flush();
                } catch (VirtualMachineError vme) {
                    System.setOut(protocolOut);
                    System.setErr(protocolErr);

                    String errMsg = vme.getClass().getName() + ": " + vme.getMessage();
                    String b64Err = Base64.getEncoder().encodeToString(errMsg.getBytes(StandardCharsets.UTF_8));
                    protocolOut.println(caseId + " FATAL_ERROR " + b64Err);
                    protocolOut.flush();
                    System.exit(137);
                } catch (Throwable t) {
                    System.setOut(protocolOut);
                    System.setErr(protocolErr);

                    String errMsg = t.getClass().getName() + ": " + t.getMessage();
                    String b64Err = Base64.getEncoder().encodeToString(errMsg.getBytes(StandardCharsets.UTF_8));
                    protocolOut.println(caseId + " ERROR " + b64Err);
                    protocolOut.flush();
                } finally {
                    System.setOut(protocolOut);
                    System.setErr(protocolErr);
                }
            }
        } catch (Exception e) {
            protocolErr.println("Runner driver fatal: " + e.getMessage());
        }
    }

    static class FastScanner {
        private final List<String> tokens = new ArrayList<>();
        private int ptr = 0;

        public FastScanner(String input) {
            if (input != null) {
                StringTokenizer st = new StringTokenizer(input);
                while (st.hasMoreTokens()) {
                    tokens.add(st.nextToken());
                }
            }
        }

        public boolean hasNext() {
            return ptr < tokens.size();
        }

        public String next() {
            return ptr < tokens.size() ? tokens.get(ptr++) : "";
        }

        public String nextString() {
            String s = next();
            if ((s.startsWith("\\\"") && s.endsWith("\\\"")) || (s.startsWith("'") && s.endsWith("'"))) {
                return s.substring(1, s.length() - 1);
            }
            return s;
        }

        public char nextChar() {
            String s = nextString();
            return s.isEmpty() ? ' ' : s.charAt(0);
        }

        public int nextInt() {
            return Integer.parseInt(next());
        }

        public long nextLong() {
            return Long.parseLong(next());
        }

        public double nextDouble() {
            return Double.parseDouble(next());
        }

        public boolean nextBoolean() {
            String s = next().toLowerCase();
            return s.equals("true") || s.equals("1");
        }

        public int[] nextIntArray() {
            if (!hasNext()) return new int[0];
            String first = tokens.get(ptr);
            if (first.startsWith("[")) {
                StringBuilder sb = new StringBuilder();
                while (hasNext()) {
                    String t = next();
                    sb.append(t).append(" ");
                    if (t.endsWith("]")) break;
                }
                String clean = sb.toString().replace("[", "").replace("]", "").trim();
                if (clean.isEmpty()) return new int[0];
                String[] parts = clean.split("[,\\\\s]+");
                int[] arr = new int[parts.length];
                for (int i = 0; i < parts.length; i++) {
                    arr[i] = Integer.parseInt(parts[i].trim());
                }
                return arr;
            }

            int countOrFirst = Integer.parseInt(next());
            int remaining = tokens.size() - ptr;
            if (remaining >= countOrFirst && countOrFirst >= 0) {
                int[] arr = new int[countOrFirst];
                for (int i = 0; i < countOrFirst; i++) {
                    arr[i] = Integer.parseInt(next());
                }
                return arr;
            }

            int[] arr = new int[remaining + 1];
            arr[0] = countOrFirst;
            for (int i = 1; i < arr.length; i++) {
                arr[i] = Integer.parseInt(next());
            }
            return arr;
        }

        public long[] nextLongArray() {
            if (!hasNext()) return new long[0];
            int countOrFirst = (int) nextLong();
            int remaining = tokens.size() - ptr;
            if (remaining >= countOrFirst && countOrFirst >= 0) {
                long[] arr = new long[countOrFirst];
                for (int i = 0; i < countOrFirst; i++) {
                    arr[i] = nextLong();
                }
                return arr;
            }
            long[] arr = new long[remaining + 1];
            arr[0] = countOrFirst;
            for (int i = 1; i < arr.length; i++) {
                arr[i] = nextLong();
            }
            return arr;
        }

        public double[] nextDoubleArray() {
            if (!hasNext()) return new double[0];
            int countOrFirst = (int) nextDouble();
            int remaining = tokens.size() - ptr;
            if (remaining >= countOrFirst && countOrFirst >= 0) {
                double[] arr = new double[countOrFirst];
                for (int i = 0; i < countOrFirst; i++) {
                    arr[i] = nextDouble();
                }
                return arr;
            }
            double[] arr = new double[remaining + 1];
            arr[0] = countOrFirst;
            for (int i = 1; i < arr.length; i++) {
                arr[i] = nextDouble();
            }
            return arr;
        }

        public String[] nextStringArray() {
            if (!hasNext()) return new String[0];
            String first = tokens.get(ptr);
            if (first.startsWith("[")) {
                StringBuilder sb = new StringBuilder();
                while (hasNext()) {
                    String t = next();
                    sb.append(t).append(" ");
                    if (t.endsWith("]")) break;
                }
                String clean = sb.toString().replace("[", "").replace("]", "").trim();
                if (clean.isEmpty()) return new String[0];
                String[] parts = clean.split("[,\\\\s]+");
                for (int i = 0; i < parts.length; i++) {
                    if ((parts[i].startsWith("\\\"") && parts[i].endsWith("\\\"")) || (parts[i].startsWith("'") && parts[i].endsWith("'"))) {
                        parts[i] = parts[i].substring(1, parts[i].length() - 1);
                    }
                }
                return parts;
            }
            int countOrFirst = Integer.parseInt(next());
            String[] arr = new String[countOrFirst];
            for (int i = 0; i < countOrFirst; i++) {
                arr[i] = nextString();
            }
            return arr;
        }
    }
}
`;
}

module.exports = {
  toJavaType,
  toPythonType,
  generateStarterCode,
  generateJavaScriptRunner,
  generateJavaRunner,
};

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class Main {

    /***USER_CODE***/

    public static String runTestCase(String rawInput) throws Exception {
        FastScanner sc = new FastScanner(rawInput);
        if (!sc.hasNext()) return "";

        int n = sc.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) {
            nums[i] = sc.nextInt();
        }
        int target = sc.nextInt();

        int[] ans = twoSum(nums, target);

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ans.length; i++) {
            if (i > 0) sb.append(" ");
            sb.append(ans[i]);
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        // Retain direct reference to original standard streams for judge protocol communication
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
                    // Restore protocol streams before writing judge response
                    System.setOut(protocolOut);
                    System.setErr(protocolErr);

                    String b64Result = Base64.getEncoder().encodeToString(result.getBytes(StandardCharsets.UTF_8));
                    protocolOut.println(caseId + " OK " + b64Result);
                    protocolOut.flush();
                } catch (VirtualMachineError vme) {
                    // Fatal JVM Error (OutOfMemoryError, StackOverflowError, etc.)
                    System.setOut(protocolOut);
                    System.setErr(protocolErr);

                    String errMsg = vme.getClass().getName() + ": " + vme.getMessage();
                    String b64Err = Base64.getEncoder().encodeToString(errMsg.getBytes(StandardCharsets.UTF_8));
                    protocolOut.println(caseId + " FATAL_ERROR " + b64Err);
                    protocolOut.flush();
                    // Terminate compromised JVM immediately
                    System.exit(137);
                } catch (Throwable t) {
                    // Normal user runtime exception (NullPointerException, ArrayIndexOutOfBounds, etc.)
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
        private final StringTokenizer st;
        public FastScanner(String input) {
            this.st = new StringTokenizer(input);
        }
        public boolean hasNext() {
            return st.hasMoreTokens();
        }
        public String next() {
            return st.nextToken();
        }
        public int nextInt() {
            return Integer.parseInt(st.nextToken());
        }
        public long nextLong() {
            return Long.parseLong(st.nextToken());
        }
        public double nextDouble() {
            return Double.parseDouble(st.nextToken());
        }
    }
}
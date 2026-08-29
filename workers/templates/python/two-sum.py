import sys
from io import StringIO
import base64

/***USER_CODE***/

def parse_input(raw_input):
    tokens = raw_input.strip().split()
    if len(tokens) < 2:
        return [], 0
    n = int(tokens[0])
    nums = [int(tokens[i+1]) for i in range(n)]
    target = int(tokens[n+1])
    return nums, target

def run_test_case(raw_input):
    nums, target = parse_input(raw_input)
    result = Solution().twoSum(nums, target)
    return ' '.join(str(x) for x in result) if isinstance(result, (list, tuple)) else str(result)

def main():
    for line in sys.stdin:
        trimmed = line.strip()
        if not trimmed:
            continue
        if trimmed == 'EXIT':
            sys.exit(0)

        space_idx = trimmed.find(' ')
        if space_idx == -1:
            continue

        case_id = trimmed[:space_idx]
        b64_input = trimmed[space_idx + 1:]

        try:
            raw_input = base64.b64decode(b64_input).decode('utf-8')
        except:
            raw_input = b64_input

        try:
            output = run_test_case(raw_input)
            b64_output = base64.b64encode(output.encode('utf-8')).decode('utf-8')
            sys.stdout.write(f'{case_id} OK {b64_output}\n')
            sys.stdout.flush()
        except Exception as err:
            err_msg = str(err) if str(err) else 'Runtime Error'
            b64_err = base64.b64encode(err_msg.encode('utf-8')).decode('utf-8')
            sys.stdout.write(f'{case_id} ERROR {b64_err}\n')
            sys.stdout.flush()

if __name__ == '__main__':
    main()

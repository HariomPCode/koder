import java.util.*;

class Main {

    public static void main(String[] args) {

        Scanner sc = new Scanner(System.in);

        int n = sc.nextInt();

        int[] nums = new int[n];

        for (int i = 0; i < n; i++) {
            nums[i] = sc.nextInt();
        }

        int target = sc.nextInt();

        int[] ans = twoSum(nums, target);

        for (int i = 0; i < ans.length; i++) {
            if (i > 0) {
                System.out.print(" ");
            }

            System.out.print(ans[i]);
        }

        System.out.println();
    }

    /***USER_CODE***/

}
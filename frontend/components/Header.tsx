import Link from "next/link";
import { Button } from "./ui/button";

export default function Header() {
  return (
    <div className=" w-screen h-fit flex items-center justify-between bg-black p-4">
      <Link href="/" className="text-2xl text-white">
        Koder
      </Link>

      <Link href={"/problems"} className="text-md text-white">
        Problems
      </Link>

      <Link href={"/signin"}>
        <Button variant={"outline"} size={"lg"} className={"text-md  mr-2"}>
          Login
        </Button>
      </Link>
    </div>
  );
}

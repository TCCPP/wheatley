import { assert, beforeAll, describe, expect, it } from "vitest";

import { Man7Index } from "../src/modules/tccpp/components/man7.js";

type TestCase = {
    query: string | string[];
    path: string;
};

const cases: TestCase[] = [
    {
        query: ["fprintf"],
        path: "man3/fprintf.3p.html", // TODO: re-evaluate....?
    },
    {
        query: ["man"],
        path: "man1/man.1.html",
    },
    {
        query: ["accept"],
        path: "man2/accept.2.html",
    },
    {
        query: ["hexdump"],
        path: "man1/hexdump.1.html",
    },
    {
        query: ["strtol"],
        path: "man3/strtol.3.html",
    },
    {
        query: "socket",
        path: "man2/socket.2.html",
    },
    {
        query: "pipe",
        path: "man2/pipe.2.html",
    },
    {
        query: "open",
        path: "man2/open.2.html",
    },
    {
        query: "mmap",
        path: "man2/mmap.2.html",
    },
    {
        query: "readdir",
        path: "man3/readdir.3.html",
    },
    {
        query: "getline",
        path: "man3/getline.3.html",
    },
    {
        query: "memset",
        path: "man3/memset.3.html",
    },
    {
        query: "strcpy",
        path: "man3/strcpy.3.html",
    },
    {
        query: "atexit",
        path: "man3/atexit.3.html",
    },
    {
        query: "fabs",
        path: "man3/fabs.3.html",
    },
    {
        query: "make",
        path: "man1/make.1.html",
    },
    {
        query: ["printf"],
        path: "man3/printf.3.html",
    },
    {
        query: "printf(3)",
        path: "man3/printf.3.html",
    },
    {
        query: "getopt(3)",
        path: "man3/getopt.3.html",
    },
    {
        query: "scandir(3)",
        path: "man3/scandir.3.html",
    },
    {
        query: "scanf(3)",
        path: "man3/scanf.3.html",
    },
    {
        query: "pthread_create(3)",
        path: "man3/pthread_create.3.html",
    },
    {
        query: "console_codes(4)",
        path: "man4/console_codes.4.html",
    },
    {
        query: "syscall(2)",
        path: "man2/syscall.2.html",
    },
    {
        query: "socket(2)",
        path: "man2/socket.2.html",
    },
    {
        query: "pipe(2)",
        path: "man2/pipe.2.html",
    },
    {
        query: "open(2)",
        path: "man2/open.2.html",
    },
    {
        query: "strcpy(3)",
        path: "man3/strcpy.3.html",
    },
    {
        query: "memset(3)",
        path: "man3/memset.3.html",
    },
    {
        query: "readdir(3)",
        path: "man3/readdir.3.html",
    },
    {
        query: "getline(3)",
        path: "man3/getline.3.html",
    },
    {
        query: "pow(3)",
        path: "man3/pow.3.html",
    },
    {
        query: "sqrt(3)",
        path: "man3/sqrt.3.html",
    },
    {
        query: "yes(1)",
        path: "man1/yes.1.html",
    },
    {
        query: "touch(1)",
        path: "man1/touch.1.html",
    },
    {
        query: "less(1)",
        path: "man1/less.1.html",
    },
    {
        query: "make(1)",
        path: "man1/make.1.html",
    },
    {
        query: "man(1)",
        path: "man1/man.1.html",
    },
    {
        query: "pinky(1)",
        path: "man1/pinky.1.html",
    },
    {
        query: "elf(5)",
        path: "man5/elf.5.html",
    },
    {
        query: "sprintf",
        path: "man3/sprintf.3p.html", // only exists as POSIX page
    },
    {
        query: "fscanf",
        path: "man3/fscanf.3p.html", // only exists as POSIX page
    },
    {
        query: "setvbuf",
        path: "man3/setvbuf.3p.html", // only exists as POSIX page
    },
    {
        query: "fgets",
        path: "man3/fgets.3p.html", // only exists as POSIX page
    },
    {
        query: "printf",
        path: "man3/printf.3.html",
    },
    {
        query: "unistd.h(0p) (POSIX)",
        path: "man0/unistd.h.0p.html",
    },
    {
        query: "tolower(3p) (POSIX)",
        path: "man3/tolower.3p.html",
    },
    {
        query: "time.h(0p) (POSIX)",
        path: "man0/time.h.0p.html",
    },
    {
        query: "inttypes.h(0p) (POSIX)",
        path: "man0/inttypes.h.0p.html",
    },
    {
        query: "fdopen(3p) (POSIX)",
        path: "man3/fdopen.3p.html",
    },
    {
        query: "fork",
        path: "man2/fork.2.html",
    },
    {
        query: "execve",
        path: "man2/execve.2.html",
    },
    {
        query: "kill(2)",
        path: "man2/kill.2.html",
    },
    {
        query: "signal",
        path: "man2/signal.2.html",
    },
    {
        query: "clone",
        path: "man2/clone.2.html",
    },
    {
        query: "connect",
        path: "man2/connect.2.html",
    },
    {
        query: "bind",
        path: "man2/bind.2.html",
    },
    {
        query: "listen",
        path: "man2/listen.2.html",
    },
    {
        query: "send",
        path: "man2/send.2.html",
    },
    {
        query: "recv",
        path: "man2/recv.2.html",
    },
    {
        query: "malloc",
        path: "man3/malloc.3.html",
    },
    {
        query: "mprotect",
        path: "man2/mprotect.2.html",
    },
    {
        query: "pthread_join",
        path: "man3/pthread_join.3.html",
    },
    {
        query: "pthread_exit",
        path: "man3/pthread_exit.3.html",
    },
    {
        query: "fopen",
        path: "man3/fopen.3.html",
    },
    {
        query: "fclose",
        path: "man3/fclose.3.html",
    },
    {
        query: "fread",
        path: "man3/fread.3.html",
    },
    {
        query: "grep",
        path: "man1/grep.1.html",
    },
    {
        query: "gcc",
        path: "man1/gcc.1.html",
    },
    {
        query: "valgrind",
        path: "man1/valgrind.1.html",
    },
    {
        query: "strace",
        path: "man1/strace.1.html",
    },
    {
        query: "epoll(7)",
        path: "man7/epoll.7.html",
    },
    {
        query: "signal(7)",
        path: "man7/signal.7.html",
    },
    {
        query: "tcp(7)",
        path: "man7/tcp.7.html",
    },
    {
        query: "phtread_create",
        path: "man3/pthread_create.3.html",
    },
];

let index: Man7Index;

beforeAll(async () => {
    index = new Man7Index();
    await index.load_data();
}, 120_000);

describe("man cases", () => {
    for (const test_case of cases) {
        const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
        for (const query of queries) {
            it(`!man should find ${query}`, async () => {
                const result = await index.lookup_async(query);
                assert(result, "search did not find a result when it should have");
                expect(result.path).to.equal(test_case.path);
            });
        }
    }
});

# Debugging with GDB
Compile your program with `-g` flag and run your program using gdb: `gdb yourprogname`.
From there, you can debug using GDB commands. Use `help` to list commands and their options.

## [Break]
Set a breakpoint to pause execution at a certain line or a function:
- `break main`
- `b 42`

## [Run]
Run your program inside gdb after setting breakpoints:
- `run`
- `r`

## [Print]
Print value of expression:
- `print my_var`
- `p (char) ch`

## [Walk & Step]
Execute next line of code, where `next` stays in the function and `step` enters functions:
- `n`
- `s`

## [Continue]
Continue execution until (Nth) next breakpoint
- `continue`
- `c 3`

## [Backtrace]
Print backtrace of all or N stack frames:
- `backtrace -full`
- `bt 3`

## Learn More:
- [TCCPPCon#1: Debugging with GDB](https://www.youtube.com/watch?v=bSEW0BvMiGc)
- [How to Debug Using GDB](https://cs.baylor.edu/~donahoo/tools/gdb/tutorial.html)
- [GDB Step By Step Instruction](https://www.geeksforgeeks.org/gdb-step-by-step-introduction/)
- [GDB Cheatsheet](https://gist.githubusercontent.com/rkubik/b96c23bd8ed58333de37f2b8cd052c30/raw/ead6be96ed4dd4a9fc0bd318adcfa9d3a3afb109/cheat_sheet.txt)

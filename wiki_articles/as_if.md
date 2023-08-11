# What Is the As-If Rule, and How Does the Compiler Optimize Code?

The compiler can transform code however it thinks is best, as long as this
doesn't change the *observable behavior* of the program.
People call this the *[as-if rule][as-if]*.
Observable behavior includes, but is not limited to:
- access of **[volatile][volatile]** objects
- writing output to the terminal (**[printf][printf]**, **[std::cout][cout]**, etc.)
- aborting the program (**[exit][exit]**, **[std::terminate][term]**, etc.)

<!-- inline -->
## Example
```cpp
int main() {
  if (false)
    return 5;
  int x = 10;
  return x + 10;
}
```
The *observable behavior* is that the program returns the exit code `20`.

<!-- inline -->
## Assembly Output
```x86asm
main:
; 'if (false)' removed by
; dead-code elimination.
; 'x' is constant-folded.
  mov eax, 20
  ret
```
*See [live example at Compiler Explorer][ce]*

[as-if]: https://en.cppreference.com/w/cpp/language/as_if
[volatile]: https://en.cppreference.com/w/cpp/language/cv
[printf]: https://en.cppreference.com/w/c/io/fprintf
[cout]: https://en.cppreference.com/w/cpp/io/cout
[exit]: https://en.cppreference.com/w/c/program/exit
[term]: https://en.cppreference.com/w/cpp/error/terminate
[ce]: https://godbolt.org/z/aY7zvMvT4

[[[alias vla]]]

# What Is a VLA And Why Is It 'Bad'?

A [Variable Length Array (VLA)](https://en.cppreference.com/w/c/language/array#Variable-length_arrays)
is an array where the size is not constant and depends on a variable.

VLAs have poor compiler support and can lead to inefficient code.
The core issue with VLAs is that the compiler doesn't know the size of the stack frame.
Without warning flags like `-Wvla` (Note: `-Wvla` is **not** turned on by `-Wall` nor any other warning
flag) it can be easy to create a VLA by accident, even in C++ with some compilers.

## [Compiler Support]
✅ available since C99
⛔ not available in C++ at all
⛔ was never supported by MSVC
⚠ optional feature since C11
⚠ supported as non-standard extension by GCC, clang

## [See Also]
<:stackoverflow:874353689031233606> [What technical disadvantages do C99-style VLAs have?](https://stackoverflow.com/q/12407754/5740428)
<:stackoverflow:874353689031233606> [What's the point of VLA anyway?](https://stackoverflow.com/q/22530363/5740428)

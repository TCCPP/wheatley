# How to configure VSCode for C and C++
This guide assumes that you have installed clangd, clang-format, a C compiler 
and they are in PATH. If not, please check our article on how to do so with msys2 and gcc.

## Language Server
Microsoft has their own intellisense extension for C and C++. However, from the personal
experience of the author of this article, `clangd` is just much better.
1. Open up Marketplace and install `clangd` by LLVM
2. It should automatically detect clangd and should work as-is.

## CMake
1. Have cmake installed on your system. If using msys2, then `pacman -S mingw-w64-ucrt-x86_64-cmake`
2. Install the extension pack from Microsoft called `CMake Tools`

This should be enough to get you started with a basic, proper IDE-like environment for C and C++.
Make sure to read documentation for each of the tools on how to properly use them, or configure
as per your needs.

## Additional Information
- `Ctrl+,` means Control and Comma i.e two key combo, not Control Plus Comma - a three key combo.
- If you need help, please visit <#331913460080181258>.

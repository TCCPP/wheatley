# Getting Started with CMake

CMake is a build system for C, C++ and more, which works on any major operating system and has integration in most IDEs.
It is the most common cross-platform build system for C and C++ projects.

## Basic CMake C++ 17 Project
```cmake
cmake_minimum_required(VERSION 3.5)
project(stuff)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
add_executable(my_exe main.cpp util.cpp util.h)
```
## Building CMake Projects
```sh
cmake -E make_directory build # or use mkdir
cmake -B build # -G for custom generator
cmake --build build # output is now in build/
build/my_exe # run (file suffix may vary)
```

## See Also
- [Installing CMake](https://cmake.org/install/)
- [Latest CMake Documentation](https://cmake.org/cmake/help/latest/)
- [Introduction to modern CMake](https://cliutils.gitlab.io/modern-cmake/)
- <:stackoverflow:1074747016644661258> [Difference between using Makefile and CMake [...]](https://stackoverflow.com/q/25789644/5740428)

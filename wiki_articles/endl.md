# About `std::endl`, Buffers, And Flushing

I/O in C++ (`std::cout`, i.e.`std::ostream`) is *buffered*,
which means that not every byte you write to the stream is instantly written through to the terminal/disk.
Doing so would be very slow.

Instead, there is a buffer of e.g. 8192 bytes and when it's full,
all data is written through to the OS (flushed) in one syscall.
This is much more efficient.

## [What is *flushing*?]
*Flushing* means that all bytes currently in the buffer are written through, and the buffer is cleared.

Use `<< std::flush` to flush, or use `std::cerr`, which is unbuffered.

## [`std::endl`]
This [I/O manipulator](https://en.cppreference.com/w/cpp/io/manip) writes a newline character to the stream,
but also flushes it.

Use `<< '\n'` instead, if you don't need to flush.

## See Also
<:stackoverflow:874353689031233606>
["std::endl" vs "\n"](https://stackoverflow.com/q/213907/5740428)
<:cppreference:875716540929015908>
**[std::endl](https://en.cppreference.com/w/cpp/io/manip/endl)**
<:cppreference:875716540929015908>
**[std::flush](https://en.cppreference.com/w/cpp/io/manip/flush)**
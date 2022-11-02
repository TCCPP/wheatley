# C vs. C++: Which Is Better, Faster, ...?

Neither language is better, neither language is faster.
There are good reasons for using both languages:

## [Reasons To Use C]
✅ relatively low-level language
✅ much simpler language (no classes, templates, ...)
✅ portable to a wide variety of systems

## [Reasons To Use C++]
✅ lots of helpful abstractions (classes, templates, ...)
✅ feature-rich language (function overloads, `constexpr`, ...)
✅ extensive standard library

## Which Is Faster?
Neither language is inherently faster than the other.
In modern compilers, the exact same optimizer is used for both languages.
Certain high-level C++ features can make it easy to inadvertently write inefficient code (e.g.
innocent looking code performing large copies).

One notable difference between the two languages is their standard libraries' string representation:
C strings, while simple, are highly inefficient because they are terminated by a null character, therefore needing
to walk the whole string to find out its length.

## Conclusion
Both languages can be equally fast, choose the right language for your job, and the language you
enjoy working in.

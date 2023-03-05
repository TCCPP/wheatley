# Why Is `using namespace std` Considered Bad Practice?

`using namespace std` will import **all** of the symbols from `std` into the enclosing namespace.
This can easily lead to name collisions, as the standard library is filled with common names:
`get`, `count`, `map`, `array`, etc.

A **key concern** with
`using namespace std;` is not what is imported now but rather what may suddenly be imported in the
future.

While `using namespace std;` is alright for tiny projects, it is important to move away from it as
soon as possible. Consider less intrusive options, if you insist on not using scope resolution:
```cpp
// OK: *only* import std::vector
using std::vector;
// OK: namespace alias
namespace chr = std::chrono;
chr::duration x;
```

## See Also

- <:tccpp:865354975629279232>
[Why is "using namespace std;" considered bad practice?](https://64.github.io/cpp-faq/using-namespace-std/)
- <:stackoverflow:874353689031233606>
_[Example of error caused by "using namespace std"](https://stackoverflow.com/a/2712125/5740428)_
- <:stackoverflow:874353689031233606>
_[Yet another example of an error](https://stackoverflow.com/a/13402851/5740428)_

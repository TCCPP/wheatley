# What are the different casts in C++

**[static_cast](https://en.cppreference.com/w/cpp/language/static_cast)**
Converts using implicit and user-defined conversions.
```cpp
static_cast<int>(123.45f); // 123
```
**[reinterpret_cast](https://en.cppreference.com/w/cpp/language/reinterpret_cast)**
Converts by reinterpreting the bits of an object.
```cpp
reinterpret_cast<std::uintptr_t>(&x);
```
**[const_cast](https://en.cppreference.com/w/cpp/language/const_cast)**
Adds or removes `const`/`volatile` qualifications.
```c++
const_cast<const int&>(integer);
```
**[dynamic_cast](https://en.cppreference.com/w/cpp/language/dynamic_cast)**
Safely up/down/sideways-casts virtual classes in an inheritance hierarchy.
```c++
dynamic_cast<derived*>(base_ptr); // downcast
```
**[C-style cast](https://en.cppreference.com/w/cpp/language/explicit_cast#Explanation)**
Uses a combination of the casts above.
```c++
(int) 3.14159 // 3
```
⚠️ can be very unpredictable, especially in templates, where types are not known ⇒ **avoid in C++**

### See Also
<:stackoverflow:874353689031233606>
[When should static_cast, ... be used?](https://stackoverflow.com/a/332086/5740428)
<:stackoverflow:874353689031233606>
[Is it possible to completely avoid C-style casts in C++?](https://stackoverflow.com/a/4219366/5740428)
• [Microsoft: Type conversions and type safety](https://docs.microsoft.com/en-us/cpp/cpp/type-conversions-and-type-safety-modern-cpp)

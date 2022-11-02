# Pointer Arithmetic Cheatsheet

## [Address-Of]
`&x`
**⇒** pointer to `x`

## [Indirection]
`*p`
**⇒** what `p` points to

## [Comparison]
`p0 < p1`
**⇒** `true` iff `p0` comes before `p1` in array

## [Difference]
`p0 - p1`
**⇒** distance, in elements, `ptrdiff_t`

## [Offset]
`p + offset`
**⇒** Nth pointer after/before `p`

## [Subscript]
`p[offset]`
**⇒** Nth object after/before `p[0]`

## [Equivalences]
```c
  &*p == p
 p[i] == *(p + i)
&p[i] == p + i
   *p == p[0]
```

## [General Advice]
To better understand, you can think of pointers as memory addresses.
At a hardware level, they are indices in a huge byte array that makes up your computer's memory.

## [Footer]
Note: Using the indirection operator * is called "dereferencing"
Note: p + 1 will offset p by one element, which can be an offset of multiple bytes

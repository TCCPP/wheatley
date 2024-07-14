# How to install msys2 and gcc on windows
In this guide, we install msys2 and gcc. There are some optional tools that we recommend
installing, such as `clangd` and `clang-format`. Having an alternative compiler, `clang`
is also recommended. Install location is assumed to be the default.

<!-- inline -->
## Msys2 and GCC Toolchain
1. Visit [msys2.org](https://msys2.org) and follow their installation guide upto step 4.
2. After installing, open the MSYS2 UCRT64 terminal environment on windows. It is an app.
3. Type `pacman -Syu` and press Enter to update.
4. Reopen MSYS2 UCRT64, and now we install the entire toolchain group.
5. Type `pacman -S mingw-w64-ucrt-x86_64-toolchain make cmake`. This will install all the necessary tools.

<!-- inline -->
## Clang (Optional)
1. Type `pacman -S mingw-w64-ucrt-x86_64-clang mingw-w64-ucrt-x86_64-clang-tools-extra` and press enter.

## Add to path
1. Click on Search and type "Edit the system environment variables". Click Environment Variables at the bottom. Select `Path` in the System section, and click Edit.
2. In the new window, click on New and then type `C:\msys64\ucrt64\bin` and click Ok.
3. Move up that variable to the top of the list.
4. Click on New and then type `C:\msys64\usr\bin` and click Ok.
5. Open powershell and type `gcc -v` to check for correct output. If not, try logging back in.

## Notes
- `clangd` is a language server, it provides code-completion, compiler errors and warnings etc.
- `clang-format` as the name suggests is a C and C++ code formatter.
- These are recommended because a user installs msys2 with vscode, and these tools work well with it.
- The `Msys ucrt64` app is the default msys2 environment for tools using `ucrt`.
- `ucrt` is the C runtime provided by default on windows 10 and later. Read [this](https://www.msys2.org/docs/environments/).
- If you need help, please visit #tooling.
- [Alternative Tutorial](https://github.com/HolyBlackCat/cpp-tutorials/blob/master/index.md)

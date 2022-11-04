import os

sensitive_tag = "/** sensitive */"

redacted_message = \
f"""
{sensitive_tag}
/****************************************************
 * This file's contents have been stripped from the *
 * public mirror due to its sensitive nature. In    *
 * this repository files are considered sensitive   *
 * if they contain logic related to detection and   *
 * handling of scammers, spammers, and bots.        *
 ***************************************************/
""".strip().split("\n") + [""]

def emplace_over(a, b):
    return a + b[len(a):]

def cleanse(path):
    if os.path.exists(path):
        with open(path, "r") as f:
            lines = ["/**/" for _ in f]
        lines = emplace_over(redacted_message, lines)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"    cleansed {path}")
    else:
        print(f"    Error: Couldn't find {path}")

def main():
    for path, directories, files in os.walk("src"):
        for file_name in files:
            file_path = os.path.join(path, file_name)
            print(f"checking {file_path}")
            with open(file_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
                if len(lines) > 0 and lines[0].strip() == sensitive_tag:
                    cleanse(file_path)
                else:
                    changed_anything = False
                    for i, line in enumerate(lines):
                        new_line = line.replace(
                            "https://github.com/jeremy-rifkin/wheatly/",
                            "https://github.com/jeremy-rifkin/wheatly-mirror/"
                        )
                        if new_line != line:
                            lines[i] = new_line
                            changed_anything = True
                    if changed_anything:
                        with open(file_path, "w", encoding="utf-8") as f:
                            f.write("\n".join(lines))

main()

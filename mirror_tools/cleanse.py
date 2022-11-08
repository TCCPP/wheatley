import os

redacted_message = """
/** sensitive */
/****************************************************
 * This file's contents have been stripped from the *
 * public mirror due to its sensitive nature. In    *
 * this repository files are considered sensitive   *
 * if they contain logic related to detection and   *
 * handling of scammers, spammers, and bots.        *
 ***************************************************/
""".strip().split("\n") + [""]


def cleanse(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            content = [line.strip() for line in f]
            assert(content[0].strip() == "/** sensitive */" or content[0].strip() == "/** sensitive")
            other_junk_start = 1
            skeleton = [x for x in redacted_message]
            if content[0].strip() == "/** sensitive":
                other_junk_start = content.index("*/")
                skeleton.extend(content[1:other_junk_start] + [""])
            lines = skeleton + ["/**/" for _ in range(len(content) - len(skeleton))]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"    cleansed {path}")
    else:
        print(f"    Error: Couldn't find {path}")

def main():
    exclude = set([".git", "node_modules"])
    for path, directories, files in os.walk("."):
        directories[:] = [d for d in directories if d not in exclude] # https://stackoverflow.com/a/19859907/15675011
        for file_name in files:
            if not file_name.endswith(".ts"):
                continue
            file_path = os.path.join(path, file_name)
            print(f"checking {file_path}")
            with open(file_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
                if len(lines) > 0 and (lines[0].strip() == "/** sensitive */" or lines[0].strip() == "/** sensitive"):
                    cleanse(file_path)
                else:
                    changed_anything = False
                    for i, line in enumerate(lines):
                        new_line = line.replace(
                            "https://github.com/jeremy-rifkin/wheatley/",
                            "https://github.com/jeremy-rifkin/wheatley-mirror/"
                        )
                        if new_line != line:
                            lines[i] = new_line
                            changed_anything = True
                    if changed_anything:
                        print(f"rewriting links in {file_path}")
                        with open(file_path, "w", encoding="utf-8") as f:
                            f.write("".join(lines))

main()

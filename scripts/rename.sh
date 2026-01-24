#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob

# Rename old log files log.MM.DD.YYYY::HH:MM:SS.txt.gz -> log-YYYYMMDD-HHMMSS.txt.gz

for path in log_archive/log.*.txt.gz; do
  dir=$(dirname "$path")
  file=$(basename "$path")

  if [[ $file =~ ^log\.([0-9]{2})\.([0-9]{2})\.([0-9]{4})::([0-9]{2}):([0-9]{2}):([0-9]{2})\.txt\.gz$ ]]; then
    mm=${BASH_REMATCH[1]}
    dd=${BASH_REMATCH[2]}
    yyyy=${BASH_REMATCH[3]}
    hh=${BASH_REMATCH[4]}
    min=${BASH_REMATCH[5]}
    ss=${BASH_REMATCH[6]}

    new="log-${yyyy}${mm}${dd}-${hh}${min}${ss}.txt.gz"

    # echo mv -v -- "$path" "$dir/$new"
    mv -v -- "$path" "$dir/$new"
  fi
done

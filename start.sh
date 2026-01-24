#!/bin/bash

if [ -f log.txt ]; then
    echo "Previous log file detected"
    [ ! -d log_archive ] && mkdir log_archive
    # t=$(date -r log.txt "+%Y%m%d-%H%M%S")
    t=$(date -d "$(stat -c '%w' log.txt)" '+%Y%m%d-%H%M%S')
    gzip log.txt
    mv -v log.txt.gz log_archive/log.$t.txt.gz
fi

npm i

screen -dmLS _Wheatley ./run-persist.sh

echo "Wheatley started in screen"

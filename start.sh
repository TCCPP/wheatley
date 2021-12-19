#!/bin/bash

if [ -f log.txt ]; then
	echo "Previous log file detected"
	[ ! -d log_archive ] && mkdir log_archive
	t=$(date -r log.txt "+%m.%d.%Y::%H:%M:%S")
	gzip log.txt
	mv -v log.txt.gz log_archive/log.$t.txt.gz
fi

screen -dmLS _Wheatley npm start

echo "Wheatley started in screen"

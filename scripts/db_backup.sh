#!/bin/bash

# Add to crontab:
# 0 1 * * * /path/to/db_backup.sh

if [ -f bot.json ]; then
    echo "Backing up"
    if [ -f db_backups.tar.gz ]; then
        tar -xf db_backups.tar.gz && rm db_backups.tar.gz
    else
        mkdir db_backups
    fi
    cp -v bot.json db_backups/bot.$(date -r log.txt "+%m.%d.%Y::%H:%M:%S").json
    tar -czf db_backups.tar.gz db_backups && rm -rf db_backups
fi
